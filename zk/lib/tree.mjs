import { buildPoseidon } from 'circomlibjs';

/** Poseidon Merkle tree over grant leaves, mirroring circuits/grant_membership.circom.
 *  Leaf = Poseidon(secret, grantee, permissions, expiresAt); parents are
 *  Poseidon(left, right) in tree order; empty slots are the field element 0. */
export const LEVELS = 4;
export const CAPACITY = 2 ** LEVELS;

let poseidon, F;
export async function initPoseidon() {
  if (!poseidon) { poseidon = await buildPoseidon(); F = poseidon.F; }
  return poseidon;
}
const H = inputs => F.toString(poseidon(inputs));

export function grantLeaf({ secret, grantee, permissions, expiresAt }) {
  return H([BigInt(secret), BigInt(grantee), BigInt(permissions), BigInt(expiresAt)]);
}
export function nullifierFor({ secret, scope }) {
  return H([BigInt(secret), BigInt(scope)]);
}

export class GrantTree {
  constructor(grants) {
    if (grants.length > CAPACITY) throw new Error(`tree capacity ${CAPACITY}, got ${grants.length} grants`);
    this.leaves = grants.map(grantLeaf);
    while (this.leaves.length < CAPACITY) this.leaves.push('0');
    this.levels = [this.leaves];
    for (let n = CAPACITY; n > 1; n /= 2) {
      const below = this.levels[this.levels.length - 1], level = [];
      for (let i = 0; i < n; i += 2) level.push(H([BigInt(below[i]), BigInt(below[i + 1])]));
      this.levels.push(level);
    }
    this.root = this.levels[LEVELS][0];
  }
  /** Witness inputs for the grant at `index`, ready for snarkjs. */
  witness(index, { now, scope }) {
    const pathElements = [], pathIndices = [];
    let at = index;
    for (let level = 0; level < LEVELS; level++) {
      const sibling = at % 2 === 0 ? at + 1 : at - 1;
      pathElements.push(this.levels[level][sibling]);
      pathIndices.push(at % 2);
      at = Math.floor(at / 2);
    }
    return { pathElements, pathIndices };
  }
}
