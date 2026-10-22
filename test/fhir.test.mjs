import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:net';
import { Wallet } from 'ethers';
import { createApp } from '../server/app.mjs';

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

test('FHIR export: bundle shape, Consent mirrors the chain grant, access is gated', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'corg-vault-fhir-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const probe = createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port; await new Promise(r => probe.close(r));
  const base = `http://127.0.0.1:${port}`;
  const service = await createApp({ dataDir: directory, origin: base, seed: false, blockTime: 0 });
  const server = service.app.listen(port, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(async () => { await new Promise(r => server.close(r)); await service.close(); });
  const [patient, clinician, outsider] = service.identities.map(i => new Wallet(i.privateKey));
  const pt = await login(base, patient), ct = await login(base, clinician), ot = await login(base, outsider);

  const fhirContent = JSON.stringify({ resourceType: 'DiagnosticReport', status: 'final', code: { text: 'SYNTHETIC panel' }, conclusion: 'Synthetic only.' });
  const record = success(await http(base, 'POST', '/api/records', { token: pt, body: { title: 'Synthetic panel', category: 'Laboratory', content: fhirContent } }));
  const note = success(await http(base, 'POST', '/api/records', { token: pt, body: { title: 'Plain note', category: 'Clinical note', content: 'SYNTHETIC free text note' } }));

  // No grant yet: Consent must read inactive/deny; outsiders get nothing.
  assert.equal((await http(base, 'GET', `/api/records/${record.id}/fhir`, { token: ot })).status, 403);
  let bundle = success(await http(base, 'GET', `/api/records/${record.id}/fhir`, { token: pt }));
  assert.equal(bundle.resourceType, 'Bundle');
  const byType = t => bundle.entry.map(e => e.resource).filter(r => r.resourceType === t);
  assert.equal(byType('Patient')[0].identifier[0].value, patient.address);
  assert.equal(byType('Consent')[0].status, 'inactive');
  assert.equal(byType('Consent')[0].provision.type, 'deny');
  assert.equal(byType('DiagnosticReport').length, 1, 'FHIR-shaped content is embedded as its own resource');
  assert.equal(byType('DiagnosticReport')[0].conclusion, 'Synthetic only.');

  // Grant READ for a fixed expiry: Consent flips to active/permit with the same period end and the "access" action.
  const expiresAt = Math.floor(Date.now() / 1000) + 86400;
  success(await http(base, 'POST', `/api/records/${record.id}/grants`, { token: pt, body: { delegate: clinician.address, permissions: 1, expiresAt } }));
  bundle = success(await http(base, 'GET', `/api/records/${record.id}/fhir`, { token: ct }));
  const consent = byType('Consent')[0];
  assert.equal(consent.status, 'active');
  assert.equal(consent.provision.type, 'permit');
  assert.equal(consent.provision.period.end, new Date(expiresAt * 1000).toISOString());
  assert.deepEqual(consent.provision.action.map(a => a.coding[0].code), ['access']);
  assert.equal(consent.provision.actor[0].reference.reference, `Practitioner/${clinician.address}`);

  // Plain-text content is wrapped as a DocumentReference with the text intact.
  const noteBundle = success(await http(base, 'GET', `/api/records/${note.id}/fhir`, { token: pt }));
  const doc = noteBundle.entry.map(e => e.resource).find(r => r.resourceType === 'DocumentReference');
  assert.ok(doc, 'plain content wrapped as DocumentReference');
  assert.equal(Buffer.from(doc.content[0].attachment.data, 'base64').toString('utf8'), 'SYNTHETIC free text note');

  // Revocation returns the Consent to inactive/deny.
  success(await http(base, 'DELETE', `/api/records/${record.id}/grants/${clinician.address}`, { token: pt, body: {} }));
  bundle = success(await http(base, 'GET', `/api/records/${record.id}/fhir`, { token: pt }));
  assert.equal(byType('Consent')[0].status, 'inactive');
});
