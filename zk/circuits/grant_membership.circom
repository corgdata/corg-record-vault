pragma circom 2.1.9;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

// Merkle root over Poseidon(2) parents. pathIndices[i] is 0 when the running
// node is the LEFT child at level i, 1 when it is the RIGHT child.
template MerkleRoot(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal output root;

    component hashers[levels];
    signal cur[levels + 1];
    signal left[levels];
    signal right[levels];
    signal dl[levels];
    signal dr[levels];
    cur[0] <== leaf;
    for (var i = 0; i < levels; i++) {
        pathIndices[i] * (1 - pathIndices[i]) === 0;
        // Selector built from single-product constraints (R1CS form):
        // idx 0 -> left = cur, right = sibling; idx 1 -> swapped.
        dl[i] <== pathIndices[i] * (pathElements[i] - cur[i]);
        left[i] <== cur[i] + dl[i];
        dr[i] <== pathIndices[i] * (cur[i] - pathElements[i]);
        right[i] <== pathElements[i] + dr[i];
        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== left[i];
        hashers[i].inputs[1] <== right[i];
        cur[i + 1] <== hashers[i].out;
    }
    root <== cur[levels];
}

// Proves, in zero knowledge: "I know a grant recorded in the grants tree at
// `root` — a leaf Poseidon(secret, grantee, permissions, expiresAt) — whose
// permission level is 1, 2 or 3 and whose expiry has not passed at `now`."
// The verifier learns the tree root, the time, the scope, and a nullifier
// Poseidon(secret, scope) that is stable per (grant secret, scope) so a
// verifier can reject replays within a scope without learning which grant
// was presented. It does NOT prove which grantee or record the grant names.
template GrantMembership(levels) {
    // private inputs
    signal input secret;
    signal input grantee;
    signal input permissions;
    signal input expiresAt;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    // public inputs
    signal input root;
    signal input now;
    signal input scope;
    // public output
    signal output nullifier;

    component leafHash = Poseidon(4);
    leafHash.inputs[0] <== secret;
    leafHash.inputs[1] <== grantee;
    leafHash.inputs[2] <== permissions;
    leafHash.inputs[3] <== expiresAt;

    component tree = MerkleRoot(levels);
    tree.leaf <== leafHash.out;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }
    tree.root === root;

    // permissions in {1, 2, 3}, factored into single-product constraints.
    signal pm1 <== permissions - 1;
    signal p12;
    p12 <== pm1 * (permissions - 2);
    p12 * (permissions - 3) === 0;

    component unexpired = GreaterEqThan(64);
    unexpired.in[0] <== expiresAt;
    unexpired.in[1] <== now;
    unexpired.out === 1;

    component nf = Poseidon(2);
    nf.inputs[0] <== secret;
    nf.inputs[1] <== scope;
    nullifier <== nf.out;
}

component main {public [root, now, scope]} = GrantMembership(4);
