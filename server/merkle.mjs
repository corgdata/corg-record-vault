import { keccak256, toUtf8Bytes, concat } from 'ethers';

/**
 * Merkle tree over gateway audit events.
 *
 * Leaf: keccak256 of the event's canonical JSON tuple
 * [id, record_id, actor, action, outcome, timestamp, tx_hash], so any edit to
 * any stored field changes the leaf. Parents are keccak256(left || right) in
 * tree order (not sorted); an odd trailing node is promoted unchanged. The
 * root over an empty set is null, never a fabricated hash.
 */
export function leafHash(row) {
  const tuple = [row.id, row.record_id ?? null, row.actor, row.action, row.outcome, row.timestamp, row.tx_hash ?? null];
  return keccak256(toUtf8Bytes(JSON.stringify(tuple)));
}

export function merkleRoot(leaves) {
  if (!leaves.length) return null;
  let level = [...leaves];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? keccak256(concat([level[i], level[i + 1]])) : level[i]);
    }
    level = next;
  }
  return level[0];
}

/** Sibling path for leaves[index]; each step records the sibling and its side. */
export function merkleProof(leaves, index) {
  const proof = [];
  let level = [...leaves], at = index;
  while (level.length > 1) {
    const sibling = at % 2 === 0 ? at + 1 : at - 1;
    if (sibling < level.length) proof.push({ hash: level[sibling], left: sibling < at });
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? keccak256(concat([level[i], level[i + 1]])) : level[i]);
    }
    at = Math.floor(at / 2); level = next;
  }
  return proof;
}

export function verifyMerkleProof(leaf, proof, root) {
  let current = leaf;
  for (const step of proof) current = step.left ? keccak256(concat([step.hash, current])) : keccak256(concat([current, step.hash]));
  return current === root;
}
