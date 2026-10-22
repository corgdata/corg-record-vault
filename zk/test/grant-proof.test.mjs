import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as snarkjs from 'snarkjs';
import { initPoseidon, GrantTree, nullifierFor } from '../lib/tree.mjs';

const ZK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WASM = path.join(ZK, 'build', 'grant_membership_js', 'grant_membership.wasm');
const ZKEY = path.join(ZK, 'build', 'grant_final.zkey');
const VK = JSON.parse(fs.readFileSync(path.join(ZK, 'build', 'verification_key.json'), 'utf8'));

const NOW = 1790000000; // fixed synthetic "now" so the test never ages out
const SCOPE = 777001;   // synthetic verifier/record scope
const grants = [
  { secret: 1101, grantee: 2001, permissions: 1, expiresAt: NOW + 86400 },
  { secret: 1102, grantee: 2002, permissions: 3, expiresAt: NOW + 3600 },
  { secret: 1103, grantee: 2003, permissions: 2, expiresAt: NOW - 60 }, // expired
  { secret: 1104, grantee: 2004, permissions: 1, expiresAt: NOW + 31536000 },
];

async function prove(tree, index, now = NOW, scope = SCOPE) {
  const grant = grants[index];
  const input = {
    secret: String(grant.secret), grantee: String(grant.grantee),
    permissions: String(grant.permissions), expiresAt: String(grant.expiresAt),
    ...tree.witness(index, { now, scope }),
    root: tree.root, now: String(now), scope: String(scope),
  };
  return snarkjs.groth16.fullProve(input, WASM, ZKEY);
}

test('ZK consent proof: valid grant proves; expiry, wrong root and tampered signals fail', async () => {
  await initPoseidon();
  const tree = new GrantTree(grants);
  assert.ok(tree.root && tree.root !== '0');

  // Happy path: grant 1 (read/write, unexpired) proves and verifies.
  const { proof, publicSignals } = await prove(tree, 1);
  assert.equal(publicSignals[1], tree.root, 'public signals carry the tree root');
  assert.equal(publicSignals[0], nullifierFor({ secret: grants[1].secret, scope: SCOPE }), 'public nullifier matches Poseidon(secret, scope)');
  assert.equal(await snarkjs.groth16.verify(VK, publicSignals, proof), true);

  // The expired grant cannot produce a proof at all (constraint unsatisfiable).
  await assert.rejects(() => prove(tree, 2), 'expired grant must fail witness generation');

  // A proof made against one tree does not verify against another tree's root.
  const other = new GrantTree([grants[0]]);
  const tamperedRoot = [...publicSignals]; tamperedRoot[1] = other.root;
  assert.equal(await snarkjs.groth16.verify(VK, tamperedRoot, proof), false);

  // Nor with a swapped scope/nullifier pairing.
  const tamperedNow = [...publicSignals]; tamperedNow[2] = String(NOW + 999999);
  assert.equal(await snarkjs.groth16.verify(VK, tamperedNow, proof), false);

  // A different scope yields a different nullifier for the same grant.
  const scoped = await prove(tree, 1, NOW, 4242);
  assert.notEqual(scoped.publicSignals[0], publicSignals[0]);
  assert.equal(await snarkjs.groth16.verify(VK, scoped.publicSignals, scoped.proof), true);
});
