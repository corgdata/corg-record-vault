import { gcm } from '@noble/ciphers/aes';
import { Wallet, verifyMessage, verifyTypedData, keccak256, toUtf8Bytes } from 'ethers';

/** Synthetic browser sandbox. This is NOT a blockchain or a production key vault.
 * Envelopes are AES-GCM encrypted, but demo keys share this browser's trust boundary.
 * The downloadable local service is the separate real-Solidity execution path.
 */
const STORAGE_KEY = 'corg-record-vault-browser-v1';
const DOMAIN = Object.freeze({ name: 'CORG Medical Record Attestation', version: '1', chainId: 31337, verifyingContract: '0x0000000000000000000000000000000000000001' });
const TYPES = Object.freeze({ RecordVersion: [
  { name: 'recordId', type: 'bytes32' }, { name: 'version', type: 'uint64' },
  { name: 'ciphertextHash', type: 'bytes32' }, { name: 'locatorCommitment', type: 'bytes32' },
] });
const challenges = new Map(), sessions = new Map(), pending = new Map();
let serial = Promise.resolve();
const now = () => Math.floor(Date.now() / 1000);
const iso = () => new Date().toISOString();
const randomHex = (bytes = 32) => '0x' + Array.from(crypto.getRandomValues(new Uint8Array(bytes)), b => b.toString(16).padStart(2, '0')).join('');
const b64 = bytes => { let s=''; for(const b of new Uint8Array(bytes)) s+=String.fromCharCode(b); return btoa(s); };
const unb64 = value => Uint8Array.from(atob(value), ch => ch.charCodeAt(0));
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
function failure(message, status = 400) { const error = new Error(message); error.status = status; return error; }
function assert(condition, message, status) { if (!condition) throw failure(message, status); }
function save(state) { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function audit(state, actor, action, recordId, outcome = 'allowed', detail = '') {
  state.events.unshift({ id: randomHex(12), timestamp: iso(), at: iso(), actor, address: actor, action, recordId: recordId || null, outcome, detail });
  state.events = state.events.slice(0, 500);
}
function policy(record, address, permission) {
  if (record.archived) return false;
  if (same(record.owner, address)) return true;
  const grant = record.grants.find(item => same(item.delegate, address));
  return Boolean(grant && grant.expiresAt > now() && (grant.permissions & permission));
}
function publicRecord(record, address) {
  const grant = same(record.owner, address) ? record.grants[0] : record.grants.find(item => same(item.delegate, address));
  return { id: record.id, title: (same(record.owner,address) || policy(record,address,1)) ? record.title : 'Restricted record', type: record.type, category: record.type, createdAt: record.createdAt, updatedAt: record.updatedAt,
    versionCount: record.versions.length, archived: record.archived, owner: record.owner, patient: record.owner,
    canRead: policy(record, address, 1), canWrite: policy(record, address, 2),
    grant: grant ? { ...grant } : null, grants: same(record.owner, address) ? record.grants.map(g => ({ ...g })) : undefined };
}
function publicVersion(version) {
  return { version: version.version, author: version.author, createdAt: version.createdAt,
    ciphertextHash: version.ciphertextHash, locatorCommitment: version.locatorCommitment,
    signature: version.signature, verified: true, attestation: version.attestation, size: version.size };
}
async function encrypt(content, recordId, version) {
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(JSON.stringify({ chainId: DOMAIN.chainId, registry: DOMAIN.verifyingContract, recordId, version }));
  const plaintext = new TextEncoder().encode(content);
  const ciphertext = crypto.subtle ? new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']), plaintext)) : gcm(rawKey, iv, aad).encrypt(plaintext);
  const envelope = new Uint8Array(1 + iv.length + ciphertext.length); envelope[0] = 1; envelope.set(iv, 1); envelope.set(ciphertext, 13);
  return { envelope: b64(envelope), key: b64(rawKey), ciphertextHash: keccak256(envelope), locatorCommitment: keccak256(toUtf8Bytes(randomHex())), aad: b64(aad), size: new TextEncoder().encode(content).length };
}
async function decrypt(version) {
  const envelope = unb64(version.envelope);
  assert(keccak256(envelope) === version.ciphertextHash, 'Encrypted record failed its integrity check.', 409);
  const rawKey = unb64(version.key), iv = envelope.slice(1,13), aad = unb64(version.aad);
  const plaintext = crypto.subtle ? await crypto.subtle.decrypt({ name:'AES-GCM', iv, additionalData:aad }, await crypto.subtle.importKey('raw',rawKey,'AES-GCM',false,['decrypt']),envelope.slice(13)) : gcm(rawKey,iv,aad).decrypt(envelope.slice(13));
  return new TextDecoder().decode(plaintext);
}
function valueFor(id, version, payload) { return { recordId: id, version, ciphertextHash: payload.ciphertextHash, locatorCommitment: payload.locatorCommitment }; }
async function create(state, identity, { title, type, content }) {
  assert(typeof title === 'string' && title.trim().length > 0 && title.length <= 120, 'Enter a title of 1–120 characters.');
  assert(typeof content === 'string' && content.length > 0 && content.length <= 500000, 'Record content must contain 1–500,000 characters.');
  assert(typeof type === 'string' && type.length > 0 && type.length <= 60, 'Choose a record category.');
  assert(identity.role === 'patient', 'Only the demo patient can create a record.', 403);
  const id = randomHex(), timestamp = iso();
  const payload = await encrypt(content, id, 1), value = valueFor(id, 1, payload);
  const signature = await new Wallet(identity.privateKey).signTypedData(DOMAIN, TYPES, value);
  const record = { id, title: title.trim(), type, owner: identity.address, createdAt: timestamp, updatedAt: timestamp, archived: false, grants: [],
    versions: [{ ...payload, version: 1, author: identity.address, createdAt: timestamp, signature, attestation: { domain: DOMAIN, types: TYPES, value } }] };
  state.records.push(record); audit(state, identity.address, 'record.created', id);
  return record;
}
async function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    let parsed; try { parsed = JSON.parse(raw); } catch { throw failure('Saved demo data could not be read. Clear this site’s browser storage to restart.', 409); }
    assert(parsed.schema === 1 && Array.isArray(parsed.records), 'Unsupported demo storage format. Clear site storage to restart.', 409);
    return parsed;
  }
  const patientWallet = Wallet.createRandom(), clinicianWallet = Wallet.createRandom();
  const state = { schema: 1, identities: [
    { role: 'patient', name: 'Alex Morgan', address: patientWallet.address, privateKey: patientWallet.privateKey },
    { role: 'clinician', name: 'Dr. Jordan Lee', address: clinicianWallet.address, privateKey: clinicianWallet.privateKey },
  ], records: [], events: [] };
  const samples = [
    { title: 'Annual wellness · blood panel', type: 'Laboratory', content: JSON.stringify({ resourceType: 'DiagnosticReport', status: 'final', subject: { display: 'Alex Morgan — synthetic patient' }, code: { text: 'Annual wellness blood panel' }, conclusion: 'Synthetic demonstration only. No clinical interpretation.', results: [{ test: 'Hemoglobin', value: 14.5, unit: 'g/dL' }, { test: 'Glucose', value: 92, unit: 'mg/dL' }, { test: 'Total cholesterol', value: 174, unit: 'mg/dL' }] }, null, 2) },
    { title: 'Primary care · visit summary', type: 'Clinical note', content: JSON.stringify({ resourceType: 'Composition', status: 'final', title: 'Synthetic preventive visit', subject: { display: 'Alex Morgan — synthetic patient' }, section: [{ title: 'Visit note', text: 'Demonstration encounter. Discussed routine wellness and follow-up. This is not a real patient record.' }] }, null, 2) },
    { title: 'Imaging · report summary', type: 'Imaging', content: JSON.stringify({ resourceType: 'DiagnosticReport', status: 'final', subject: { display: 'Alex Morgan — synthetic patient' }, code: { text: 'Synthetic imaging summary' }, conclusion: 'Illustrative report placeholder. No real scan, diagnosis, or clinical finding.' }, null, 2) },
  ];
  for (const sample of samples) await create(state, state.identities[0], sample);
  save(state); return state;
}
function getIdentity(state, token) {
  const session = sessions.get(token);
  assert(session && session.expiresAt > now(), 'Your demo session expired. Switch role or reload to sign in again.', 401);
  const identity = state.identities.find(item => same(item.address, session.address));
  assert(identity, 'Unknown demo identity.', 401); return identity;
}
function findRecord(state, id) { const record = state.records.find(r => r.id === id); assert(record, 'Record not found.', 404); return record; }
function requireOwner(record, identity) { assert(same(record.owner, identity.address), 'Only the patient can change consent.', 403); }
function prune() { for (const map of [challenges, sessions, pending]) for (const [key, entry] of map) if (entry.expiresAt <= now()) map.delete(key); }
async function handle(method, path, body, token) {
  prune();
  const state = await load();
  if (method === 'GET' && path === '/api/config') return { mode: 'browser-demo', chainId: DOMAIN.chainId, registryAddress: DOMAIN.verifyingContract, identities: state.identities, syntheticOnly: true, warning: 'Local browser simulation. No blockchain transaction is sent. Encryption keys share browser storage with ciphertext.' };
  if (method === 'POST' && path === '/api/auth/challenge') {
    const identity = state.identities.find(item => same(item.address, body.address)); assert(identity, 'Unknown demo wallet.', 403);
    assert(challenges.size < 100, 'Too many sign-in requests; retry shortly.', 429);
    const nonce = randomHex(), expiresAt = now() + 120;
    const message = ['CORG Record Vault — synthetic browser sign-in', `Origin: ${location.origin}`, `Chain: ${DOMAIN.chainId}`, `Registry: ${DOMAIN.verifyingContract}`, `Wallet: ${identity.address}`, `Nonce: ${nonce}`, `Expires: ${expiresAt}`].join('\n');
    challenges.set(nonce, { address: identity.address, message, expiresAt }); return { nonce, message, expiresAt };
  }
  if (method === 'POST' && path === '/api/auth/verify') {
    const challenge = challenges.get(body.nonce); challenges.delete(body.nonce);
    assert(challenge && challenge.expiresAt > now(), 'Sign-in challenge expired or already used.', 401);
    let recovered; try { recovered = verifyMessage(challenge.message, body.signature); } catch { throw failure('Invalid wallet signature.', 401); }
    assert(same(recovered, challenge.address), 'Wallet signature does not match.', 401);
    const accessToken = randomHex(), expiresAt = now() + 3600; sessions.set(accessToken, { address: recovered, expiresAt });
    return { token: accessToken, address: recovered, expiresAt };
  }
  const identity = getIdentity(state, token), address = identity.address;
  if(method === 'POST' && path === '/api/auth/logout'){sessions.delete(token);return {ok:true};}
  if (method === 'GET' && path === '/api/records') return { records: state.records.filter(r => same(r.owner, address) || policy(r, address, 1) || policy(r, address, 2)).map(r => publicRecord(r, address)) };
  if (method === 'POST' && path === '/api/records') { const record = await create(state, identity, body); save(state); return publicRecord(record, address); }
  if (method === 'GET' && path === '/api/audit') { assert(identity.role === 'patient', 'Access logs are visible to the patient only.', 403); return { events: state.events.filter(e => !e.recordId || state.records.some(r => r.id === e.recordId && same(r.owner, address))) }; }
  if (method === 'POST' && path === '/api/revoke-all') {
    assert(identity.role === 'patient', 'Only the patient can revoke all consent.', 403);
    for (const record of state.records) if (same(record.owner, address)) record.grants = [];
    audit(state, address, 'access.revoked_all', null); save(state); return { ok: true };
  }
  const match = path.match(/^\/api\/records\/(0x[0-9a-fA-F]{64})(.*)$/); assert(match, 'Endpoint not found.', 404);
  const record = findRecord(state, match[1]), suffix = match[2];
  if (method === 'GET' && !suffix) {
    assert(same(record.owner, address) || policy(record, address, 1) || policy(record, address, 2), 'Access is not authorized.', 403);
    return { ...publicRecord(record, address), versions: record.versions.map(publicVersion) };
  }
  const contentMatch = suffix.match(/^\/versions\/(\d+)\/content$/);
  if (method === 'GET' && contentMatch) {
    if (!policy(record, address, 1)) { audit(state, address, 'record.read', record.id, 'denied', 'Consent missing, expired, revoked or archived.'); save(state); throw failure('Access denied. Consent may have expired or been revoked.', 403); }
    const version = record.versions[Number(contentMatch[1]) - 1]; assert(version, 'Version not found.', 404);
    const content = await decrypt(version);
    const recovered = verifyTypedData(version.attestation.domain, version.attestation.types, version.attestation.value, version.signature);
    assert(same(recovered, version.author), 'Record signature failed verification.', 409);
    audit(state, address, 'record.read', record.id, 'allowed', `Version ${version.version} decrypted and released.`); save(state);
    return { content, signature: version.signature, author: version.author, verified: true, version: version.version, ciphertextHash: version.ciphertextHash };
  }
  if (method === 'POST' && suffix === '/grants') {
    requireOwner(record, identity); assert(!record.archived, 'Restore this record before granting consent.', 409);
    const delegate = state.identities.find(item => same(item.address, body.delegate)); assert(delegate && !same(delegate.address, address), 'Select the demo clinician.');
    assert([1, 2, 3].includes(body.permissions), 'Invalid permission mask.');
    assert(Number.isSafeInteger(body.expiresAt) && body.expiresAt > now(), 'Access expiration must be in the future.');
    record.grants = record.grants.filter(g => !same(g.delegate, delegate.address));
    record.grants.push({ delegate: delegate.address, permissions: body.permissions, expiresAt: body.expiresAt });
    audit(state, address, 'access.granted', record.id, 'allowed', `Permissions ${body.permissions}; expires ${new Date(body.expiresAt * 1000).toISOString()}`); save(state); return { ok: true };
  }
  if (method === 'DELETE' && /^\/grants\/0x[0-9a-fA-F]{40}$/.test(suffix)) {
    requireOwner(record, identity); const delegate = suffix.split('/')[2]; record.grants = record.grants.filter(g => !same(g.delegate, delegate));
    audit(state, address, 'access.revoked', record.id); save(state); return { ok: true };
  }
  if (method === 'POST' && suffix === '/archive') {
    requireOwner(record, identity); assert(typeof body.archived === 'boolean', 'Archive state must be true or false.'); record.archived = body.archived;
    audit(state, address, body.archived ? 'record.archived' : 'record.restored', record.id); save(state); return { ok: true };
  }
  if (method === 'POST' && suffix === '/prepare') {
    assert(policy(record, address, 2), 'You do not have permission to contribute.', 403);
    assert(typeof body.content === 'string' && body.content.length > 0 && body.content.length <= 500000, 'Record content must contain 1–500,000 characters.');
    assert(body.expectedVersion === record.versions.length, 'Version changed; refresh before signing.', 409);
    const version = record.versions.length + 1, payload = await encrypt(body.content, record.id, version), value = valueFor(record.id, version, payload), requestId = randomHex();
    assert(pending.size < 100, 'Too many prepared updates; retry shortly.', 429);
    pending.set(requestId, { recordId: record.id, address, version, payload, value, expiresAt: now() + 120 });
    return { requestId, domain: DOMAIN, types: TYPES, value };
  }
  if (method === 'POST' && suffix === '/versions') {
    const prepared = pending.get(body.requestId); pending.delete(body.requestId);
    assert(prepared && prepared.expiresAt > now() && prepared.recordId === record.id && same(prepared.address, address), 'Prepared update expired or does not belong to this session.', 409);
    assert(policy(record, address, 2), 'Write permission was revoked or expired.', 403);
    assert(prepared.version === record.versions.length + 1, 'Another update was committed. Prepare your version again.', 409);
    let recovered; try { recovered = verifyTypedData(DOMAIN, TYPES, prepared.value, body.signature); } catch { throw failure('Invalid version signature.', 401); }
    assert(same(recovered, address), 'Version signature belongs to a different wallet.', 401);
    const timestamp = iso(); record.versions.push({ ...prepared.payload, version: prepared.version, author: address, createdAt: timestamp, signature: body.signature, attestation: { domain: DOMAIN, types: TYPES, value: prepared.value } }); record.updatedAt = timestamp;
    audit(state, address, 'version.appended', record.id, 'allowed', `Signed version ${prepared.version}`); save(state); return { ...publicRecord(record, address), version: prepared.version };
  }
  throw failure('Endpoint not found.', 404);
}

/** Same JSON protocol as the localhost gateway. All policy here is simulated. */
export function browserRequest(method, path, body = {}, token = null) {
  const run = () => handle(method.toUpperCase(), path.split('?')[0], body || {}, token);
  const locked = () => navigator.locks ? navigator.locks.request('corg-vault-state-v1', run) : run();
  const result = serial.then(locked, locked); serial = result.catch(() => {}); return result;
}
