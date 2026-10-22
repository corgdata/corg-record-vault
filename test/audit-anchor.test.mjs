import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:net';
import { Wallet } from 'ethers';
import { leafHash, merkleRoot, merkleProof, verifyMerkleProof } from '../server/merkle.mjs';
import { createApp } from '../server/app.mjs';

const row = (id, action, outcome = 'success') => ({ id: `evt-${id}`, record_id: 'rec-1', actor: '0xActor', action, outcome, timestamp: `2026-10-21T00:00:0${id}Z`, tx_hash: null });

test('merkle: roots are deterministic, proofs verify, edits change the root', () => {
  const rows = [row(1, 'record.created'), row(2, 'access.granted'), row(3, 'record.read'), row(4, 'version.signed'), row(5, 'access.revoked')];
  const leaves = rows.map(leafHash);
  const root = merkleRoot(leaves);
  assert.ok(root && root.startsWith('0x'));
  assert.equal(merkleRoot(rows.map(leafHash)), root, 'same rows, same root');
  for (let i = 0; i < leaves.length; i++) assert.ok(verifyMerkleProof(leaves[i], merkleProof(leaves, i), root), `proof for leaf ${i}`);
  const edited = rows.map(r => ({ ...r }));
  edited[2] = { ...edited[2], outcome: 'forged' };
  assert.notEqual(merkleRoot(edited.map(leafHash)), root, 'an edited field must change the root');
  assert.equal(merkleRoot([]), null, 'empty set has no root');
});

async function http(base, method, route, { token, body } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}
function success(result) { assert.ok(result.status >= 200 && result.status < 300, `HTTP ${result.status}: ${JSON.stringify(result.data)}`); return result.data; }
async function login(base, wallet) {
  const challenge = success(await http(base, 'POST', '/api/auth/challenge', { body: { address: wallet.address } }));
  const signature = await wallet.signMessage(challenge.message);
  return success(await http(base, 'POST', '/api/auth/verify', { body: { nonce: challenge.nonce, signature } })).token;
}

test('audit anchoring: anchor, verify, tamper detection, range isolation', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'corg-vault-anchor-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const probe = createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port; await new Promise(r => probe.close(r));
  const base = `http://127.0.0.1:${port}`;
  const service = await createApp({ dataDir: directory, origin: base, seed: false, blockTime: 0 });
  const server = service.app.listen(port, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(async () => { await new Promise(r => server.close(r)); await service.close(); });
  assert.ok(service.anchorAddress, 'anchor contract deployed');
  const [patient, clinician] = service.identities.map(i => new Wallet(i.privateKey));
  const pt = await login(base, patient);

  const record = success(await http(base, 'POST', '/api/records', { token: pt, body: { title: 'Synthetic anchor record', category: 'Laboratory', content: 'SYNTHETIC' } }));
  success(await http(base, 'POST', `/api/records/${record.id}/grants`, { token: pt, body: { delegate: clinician.address, permissions: 1, expiresAt: Math.floor(Date.now() / 1000) + 86400 } }));

  const first = success(await http(base, 'POST', '/api/audit/anchor', { token: pt, body: {} }));
  assert.ok(first.events >= 2, `expected the create + grant events, got ${first.events}`);
  assert.ok(first.root.startsWith('0x'));
  const verified = success(await http(base, 'GET', `/api/audit/verify?anchorId=${first.anchorId}`, { token: pt }));
  assert.equal(verified.ok, true, JSON.stringify(verified));
  assert.equal(verified.onChainRoot, first.root);
  assert.equal(verified.eventsChecked, first.events);

  const listed = success(await http(base, 'GET', '/api/audit/anchors', { token: pt }));
  assert.equal(listed.anchors.length, 1);
  assert.equal(listed.anchors[0].onChainRoot, first.root);

  // The anchoring action itself is an audit event, so the next anchor covers exactly it.
  const second = success(await http(base, 'POST', '/api/audit/anchor', { token: pt, body: {} }));
  assert.equal(second.events, 1);
  assert.equal(success(await http(base, 'GET', `/api/audit/verify?anchorId=${second.anchorId}`, { token: pt })).ok, true);

  // Tamper with a row inside the FIRST anchored range: verification must fail.
  service.db.prepare('UPDATE audit SET outcome = ? WHERE rowid = ?').run('forged', first.fromSeq);
  const afterEdit = success(await http(base, 'GET', `/api/audit/verify?anchorId=${first.anchorId}`, { token: pt }));
  assert.equal(afterEdit.ok, false);
  assert.ok(afterEdit.problems.some(p => p.includes('recomputed root')), JSON.stringify(afterEdit.problems));
  // The second range does not cover the edited row and still verifies.
  assert.equal(success(await http(base, 'GET', `/api/audit/verify?anchorId=${second.anchorId}`, { token: pt })).ok, true);

  // Deleting a row inside the range is detected as well.
  service.db.prepare('DELETE FROM audit WHERE rowid = ?').run(first.fromSeq + 1);
  const afterDelete = success(await http(base, 'GET', `/api/audit/verify?anchorId=${first.anchorId}`, { token: pt }));
  assert.equal(afterDelete.ok, false);
});
