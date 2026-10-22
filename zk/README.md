# ZK consent proof — prototype

A zero-knowledge proof that a valid, unexpired access grant exists, without
revealing which grant, which grantee, or which record it names.

## What the proof states

The prover convinces a verifier of exactly this statement:

> I know a grant leaf `Poseidon(secret, grantee, permissions, expiresAt)`
> contained in the grants Merkle tree whose root is the public `root`, with
> `permissions` in {1, 2, 3} and `expiresAt >= now`.

Public inputs: `root` (the grants-tree root), `now` (the verifier's time),
and `scope` (an application-chosen context, e.g. a record or verifier id).
Public output: `nullifier = Poseidon(secret, scope)`. The nullifier is stable
for the same (grant secret, scope) pair, so a verifier can reject a replayed
presentation inside one scope without learning anything about the grant.
Presenting the same grant under a different scope yields a different
nullifier and reveals nothing linkable.

What it deliberately does **not** prove: the identity of the grantee or the
patient, which record the grant concerns (beyond what `scope` encodes), or
that the presenter is the grantee rather than someone the grantee shared the
grant secret with. Possession of the secret is the credential — the same
trust shape as a bearer token, with the grant contents kept private.

## Layout

- `circuits/grant_membership.circom` — Groth16 circuit (circom 2.1.9,
  circomlib Poseidon + comparators). Depth-4 tree, 16 grant slots, 1,575
  constraints as compiled in this repository.
- `lib/tree.mjs` — JavaScript mirror of the tree (circomlibjs Poseidon) that
  builds leaves and witness inputs.
- `build.mjs` — compiles the circuit and runs a **development** setup.
- `test/grant-proof.test.mjs` — proves a valid grant, verifies it, and shows
  the failure modes: an expired grant cannot produce a proof, a proof does
  not verify against another tree's root, and tampered public signals fail.

## Build and test

```sh
# one-time: place the circom 2.1.9 binary at tools/circom
# (https://github.com/iden3/circom/releases, v2.1.9) — not committed.
npm install
npm run build   # circuit -> build/ (r1cs, wasm, zkey, verification key)
npm test
```

## Honest limits

- **Development trusted setup.** `build.mjs` runs a single-contributor
  powers-of-tau and zkey ceremony with local randomness. That is fine for a
  prototype and unacceptable for production: a real deployment needs a
  multi-party ceremony (or a universal/updatable setup) so no single party
  knows the toxic waste.
- **Prototype scale.** Depth 4 (16 grants) keeps the circuit small and the
  tests fast. Scaling is a parameter change plus a bigger ceremony, not a
  redesign.
- **Not yet integrated.** The vault gateway does not consume these proofs
  today. The integration path is: snapshot the registry's live grants into
  the tree shape in `lib/tree.mjs`, publish the tree root (the AuditAnchor
  pattern from Phase 1 is the natural home for it), and let a clinician
  present a proof instead of an address the chain can correlate. Field
  encoding of addresses and record ids into Poseidon inputs must be fixed
  and documented before that integration is meaningful.
- **Synthetic values only**, in the tests as everywhere in this repository.
