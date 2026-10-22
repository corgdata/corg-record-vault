import express from 'express';
import ganache from 'ganache';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserProvider, Contract, ContractFactory, Wallet, verifyMessage, verifyTypedData, keccak256, toUtf8Bytes, getAddress, hexlify } from 'ethers';
import { Vault } from './vault.mjs';
import { leafHash, merkleRoot } from './merkle.mjs';
import { toFhirBundle } from './fhir.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 86400;
const hex32 = /^0x[a-fA-F0-9]{64}$/;
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const check = (condition, status, message) => { if (!condition) throw new HttpError(status, message); };
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v);
const address = value => { try { return getAddress(value); } catch { throw new HttpError(400, 'Invalid wallet address'); } };
const contentValue = value => { check(typeof value === 'string' && Buffer.byteLength(value) > 0 && Buffer.byteLength(value) <= 100_000, 400, 'Content must be 1–100,000 bytes'); return value; };
const field = (value, fallback) => { const v = value ?? fallback; check(typeof v === 'string' && v.trim().length > 0 && v.length <= 120, 400, 'Invalid record label'); return v.trim(); };

/** Starts an isolated local EVM-backed service; no network server until caller listens. */
export async function createApp({ dataDir = path.join(ROOT, '.data'), origin = 'http://127.0.0.1:3000', seed = true, blockTime = 1 } = {}) {
  const parsedOrigin = new URL(origin);
  check(['127.0.0.1', 'localhost'].includes(parsedOrigin.hostname) && parsedOrigin.protocol === 'http:', 400, 'Local demo origin required');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 }); chmodSync(dataDir, 0o700);
  const identityPath = path.join(dataDir, 'demo-wallets.json');
  if (!existsSync(identityPath)) {
    writeFileSync(identityPath, json(['patient', 'clinician', 'outsider'].map(role => ({ role, name: role === 'patient' ? 'Alex Morgan' : role === 'clinician' ? 'Dr. Maya Chen' : 'Unassigned clinician', privateKey: Wallet.createRandom().privateKey }))), { flag: 'wx', mode: 0o600 });
  }
  chmodSync(identityPath, 0o600);
  const identities = JSON.parse(readFileSync(identityPath, 'utf8')).map(x => ({ ...x, address: new Wallet(x.privateKey).address }));
  const rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 31337, hardfork: 'shanghai' }, miner: { blockTime }, database: { dbPath: path.join(dataDir, 'chain') }, wallet: { accounts: identities.map(x => ({ secretKey: x.privateKey, balance: '0x56BC75E2D63100000' })) } });
  const provider = new BrowserProvider(rpc, undefined, { cacheTimeout: -1 }); provider.pollingInterval = 30;
  const artifact = JSON.parse(readFileSync(path.join(ROOT, 'artifacts/MedicalRecordsRegistry.json'), 'utf8'));
  const deploymentPath = path.join(dataDir, 'deployment.json');
  let registry;
  if (existsSync(deploymentPath)) {
    const prior = JSON.parse(readFileSync(deploymentPath, 'utf8'));
    check(await provider.getCode(prior.address) !== '0x', 500, 'Persisted registry is missing: restore the complete data directory');
    registry = new Contract(prior.address, artifact.abi, provider);
  } else {
    registry = await new ContractFactory(artifact.abi, artifact.bytecode, await provider.getSigner(identities[0].address)).deploy();
    await registry.waitForDeployment();
    writeFileSync(deploymentPath, json({ address: await registry.getAddress(), chainId: 31337 }), { mode: 0o600, flag: 'wx' });
    registry = registry.connect(provider);
  }
  const registryAddress = await registry.getAddress();
  const anchorArtifact = JSON.parse(readFileSync(path.join(ROOT, 'artifacts/AuditAnchor.json'), 'utf8'));
  let anchorContract;
  {
    const deployment = JSON.parse(readFileSync(deploymentPath, 'utf8'));
    if (deployment.anchorAddress && await provider.getCode(deployment.anchorAddress) !== '0x') {
      anchorContract = new Contract(deployment.anchorAddress, anchorArtifact.abi, provider);
    } else {
      anchorContract = await new ContractFactory(anchorArtifact.abi, anchorArtifact.bytecode, await provider.getSigner(identities[0].address)).deploy();
      await anchorContract.waitForDeployment();
      deployment.anchorAddress = await anchorContract.getAddress();
      writeFileSync(deploymentPath, json(deployment), { mode: 0o600 });
      anchorContract = anchorContract.connect(provider);
    }
  }
  const anchorAddress = await anchorContract.getAddress();
  const vault = new Vault(path.join(dataDir, 'vault'));
  const db = new DatabaseSync(path.join(dataDir, 'metadata.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, patient TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS versions(record_id TEXT NOT NULL, version INTEGER NOT NULL, filename TEXT NOT NULL, wrapped_key TEXT NOT NULL, ciphertext_hash TEXT NOT NULL, locator_commitment TEXT NOT NULL, author TEXT NOT NULL, created_at TEXT NOT NULL, attestation TEXT, tx_hash TEXT NOT NULL, PRIMARY KEY(record_id,version));
    CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY, record_id TEXT, actor TEXT NOT NULL, action TEXT NOT NULL, outcome TEXT NOT NULL, timestamp TEXT NOT NULL, tx_hash TEXT);
    CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, action TEXT NOT NULL, record_id TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS anchors(id INTEGER PRIMARY KEY, patient TEXT NOT NULL, root TEXT NOT NULL, from_seq INTEGER NOT NULL, to_seq INTEGER NOT NULL, chain_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, anchored_at TEXT NOT NULL);
  `);
  chmodSync(path.join(dataDir, 'metadata.sqlite'), 0o600);
  const sessions = new Map(), challenges = new Map(), prepared = new Map(), attempts = new Map();
  const domain = { name: 'CORG Medical Records', version: '1', chainId: 31337, verifyingContract: registryAddress };
  const types = { RecordUpdate: [{ name: 'recordId', type: 'bytes32' }, { name: 'expectedVersion', type: 'uint64' }, { name: 'ciphertextHash', type: 'bytes32' }, { name: 'contentHash', type: 'bytes32' }, { name: 'nonce', type: 'bytes32' }, { name: 'deadline', type: 'uint64' }] };
  const aad = (id, version) => json({ chainId: 31337, registry: registryAddress, recordId: id, version });
  const audit = (recordId, actor, action, outcome = 'success', txHash = null) => db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?)').run(randomUUID(), recordId, actor, action, outcome, new Date().toISOString(), txHash);
  const recordRow = id => { check(hex32.test(id), 400, 'Invalid record identifier'); const r = db.prepare('SELECT * FROM records WHERE id=?').get(id); check(r, 404, 'Record not found'); return r; };
  const owned = (id, actor) => { const r = recordRow(id); check(same(r.patient, actor), 403, 'Only the patient may perform this action'); return r; };
  const signer = async actor => { check(identities.some(x => same(x.address, actor)), 403, 'Unknown demo wallet'); return registry.connect(await provider.getSigner(actor)); };
  const loadVersion = async (id, version) => {
    const row = db.prepare('SELECT * FROM versions WHERE record_id=? AND version=?').get(id, version);
    check(row, 404, 'Version not found');
    const chain = await registry.getVersion(id, version);
    const result = vault.read(row, aad(id, version));
    check(keccak256(result.bytes) === chain.ciphertextHash && row.ciphertext_hash === chain.ciphertextHash && row.locator_commitment === chain.locatorCommitment && same(row.author, chain.author), 409, 'Encrypted record integrity or provenance check failed');
    return { row, payload: result.payload };
  };
  const insertVersion = (id, version, encrypted, actor, txHash, attestation = null) => db.prepare('INSERT INTO versions VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, version, encrypted.filename, encrypted.wrappedKey, keccak256(encrypted.bytes), keccak256(encrypted.token), actor, new Date().toISOString(), attestation ? json(attestation) : null, txHash);
  let queue = Promise.resolve();
  const serial = fn => { const next = queue.then(fn); queue = next.catch(() => {}); return next; };
  const execute = async (action, id, fn) => {
    const op = randomUUID(); db.prepare('INSERT INTO operations VALUES(?,?,?,?,?)').run(op, action, id, 'pending', new Date().toISOString());
    try { const result = await fn(); db.prepare('UPDATE operations SET status=? WHERE id=?').run('complete', op); return result; }
    catch (error) { db.prepare('UPDATE operations SET status=? WHERE id=?').run('failed-review-required', op); throw error; }
  };
  const createRecord = async (actor, input) => serial(() => execute('create', null, async () => {
    check(same(actor, identities[0].address), 403, 'Only the demo patient creates records');
    const payload = { title: field(input.title, 'Untitled record'), category: field(input.category ?? input.type, 'Clinical note'), content: contentValue(input.content) };
    const salt = hexlify(randomBytes(32)); const id = await registry.computeRecordId(actor, salt);
    const encrypted = vault.encrypt(payload, aad(id, 1));
    const tx = await (await (await signer(actor)).createRecord(salt, keccak256(encrypted.token), keccak256(encrypted.bytes))).wait();
    db.exec('BEGIN');
    try { db.prepare('INSERT INTO records VALUES(?,?,?)').run(id, actor, new Date().toISOString()); insertVersion(id, 1, encrypted, actor, tx.hash); audit(id, actor, 'record.created', 'success', tx.hash); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
    return { id, txHash: tx.hash };
  }));
  const summarize = async (row, actor) => {
    const chain = await registry.getRecord(row.id);
    const canRead = await registry.canRead(row.id, actor), canWrite = await registry.canWrite(row.id, actor);
    if (!same(row.patient, actor) && !canRead && !canWrite) return null;
    const versionCount = Number(chain.versionCount);
    let title = 'Restricted record', category = 'Write access only';
    if (same(row.patient, actor) || canRead) ({ title, category } = (await loadVersion(row.id, versionCount)).payload);
    const version = db.prepare('SELECT created_at FROM versions WHERE record_id=? AND version=?').get(row.id, versionCount);
    check(version, 503, 'Record index needs recovery');
    const grant = await registry.getGrant(row.id, identities[1].address);
    const validEpoch = grant.epoch === await registry.patientAccessEpoch(row.patient);
    return { id: row.id, title, category, patient: row.patient, owner: row.patient, createdAt: row.created_at, updatedAt: version.created_at, versionCount, archived: chain.archived, canRead, canWrite, grant: { permissions: validEpoch ? Number(grant.permissions) : 0, expiresAt: Number(grant.expiresAt), delegate: identities[1].address, active: await registry.canRead(row.id, identities[1].address) || await registry.canWrite(row.id, identities[1].address) } };
  };
  if (seed && !db.prepare('SELECT id FROM records LIMIT 1').get()) {
    for (const item of [
      { title: 'Annual wellness panel', category: 'Laboratory', content: JSON.stringify({ resourceType: 'DiagnosticReport', status: 'final', code: { text: 'SYNTHETIC wellness panel' }, conclusion: 'Synthetic demonstration only. Hemoglobin 14.8 g/dL; glucose 92 mg/dL; all example values.' }, null, 2) },
      { title: 'Cardiology consultation', category: 'Clinical note', content: 'SYNTHETIC RECORD\nRoutine consultation. No actual patient information. Follow-up discussion scheduled.' },
      { title: 'Immunization history', category: 'Immunization', content: JSON.stringify({ resourceType: 'Immunization', status: 'completed', vaccineCode: { text: 'SYNTHETIC immunization example' }, occurrenceDateTime: '2026-09-12' }, null, 2) },
    ]) await createRecord(identities[0].address, item);
  }
  const app = express(); app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
    try {
      check(req.headers.host === parsedOrigin.host, 403, 'Untrusted Host');
      if (req.headers.origin) check(req.headers.origin === origin, 403, 'Untrusted Origin');
      if (req.headers['sec-fetch-site']) check(['same-origin', 'none'].includes(req.headers['sec-fetch-site']), 403, 'Cross-site requests denied');
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) check(req.is('application/json'), 415, 'JSON content type required');
      next();
    } catch (e) { next(e); }
  });
  app.use(express.json({ limit: '128kb', strict: true }));
  const route = fn => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };
  app.get('/api/config', (_req, res) => res.json({ mode: 'local-evm', chainId: 31337, registryAddress, identities, warning: 'SYNTHETIC LOCAL DEMO: wallets and keys are intentionally available to this browser; no production identity assurance.' }));
  app.post('/api/auth/challenge', route(async (req, res) => {
    const actor = address(req.body.address); check(identities.some(x => same(x.address, actor)), 403, 'Unknown demo identity');
    const now = Date.now(), prior = attempts.get(actor) ?? [];
    const recent = prior.filter(x => now - x < 60_000); check(recent.length < 30, 429, 'Too many authentication attempts'); recent.push(now); attempts.set(actor, recent);
    for (const [key, value] of challenges) if (value.expiry < now) challenges.delete(key);
    check(challenges.size < 100, 429, 'Too many pending challenges');
    const nonce = hexlify(randomBytes(32)), expiry = now + 120_000;
    const message = `${origin} requests a synthetic medical-record session.\nWallet: ${actor}\nChain ID: 31337\nRegistry: ${registryAddress}\nNonce: ${nonce}\nExpires: ${new Date(expiry).toISOString()}`;
    challenges.set(nonce, { actor, message, expiry }); res.json({ nonce, message, expiresAt: expiry });
  }));
  app.post('/api/auth/verify', route(async (req, res) => {
    const item = challenges.get(req.body.nonce); challenges.delete(req.body.nonce);
    check(item && item.expiry > Date.now(), 401, 'Challenge expired or already consumed');
    let recovered; try { recovered = verifyMessage(item.message, req.body.signature); } catch { throw new HttpError(401, 'Invalid wallet signature'); }
    check(same(recovered, item.actor), 401, 'Wallet signature mismatch');
    for (const [key, value] of sessions) if (value.expiry < Date.now()) sessions.delete(key);
    check(sessions.size < 100, 429, 'Too many active sessions');
    const token = randomBytes(32).toString('hex'), expiry = Date.now() + 30 * 60_000;
    sessions.set(token, { actor: item.actor, expiry }); res.json({ token, address: item.actor, expiresAt: expiry });
  }));
  app.use('/api', (req, _res, next) => {
    try { const token = (req.headers.authorization ?? '').replace(/^Bearer /, ''); const session = sessions.get(token); check(session && session.expiry > Date.now(), 401, 'Authentication required'); req.actor = session.actor; next(); } catch (e) { next(e); }
  });
  app.post('/api/auth/logout', (req, res) => { sessions.delete(req.headers.authorization.slice(7)); res.json({ ok: true }); });
  app.get('/api/records', route(async (req, res) => {
    const records = []; for (const row of db.prepare('SELECT * FROM records ORDER BY created_at DESC').all()) { const item = await summarize(row, req.actor); if (item) records.push(item); } res.json({ records });
  }));
  app.post('/api/records', route(async (req, res) => { const result = await createRecord(req.actor, req.body); res.status(201).json({ ...result, record: await summarize(recordRow(result.id), req.actor) }); }));
  app.get('/api/records/:id', route(async (req, res) => {
    const row = recordRow(req.params.id), record = await summarize(row, req.actor); check(record, 403, 'Record access denied');
    const versions = db.prepare('SELECT version,author,created_at,ciphertext_hash,attestation,tx_hash FROM versions WHERE record_id=? ORDER BY version DESC').all(row.id).map(v => ({ version: v.version, author: v.author, createdAt: v.created_at, ciphertextHash: v.ciphertext_hash, signed: Boolean(v.attestation), txHash: v.tx_hash }));
    res.json({ record, versions });
  }));
  app.get('/api/records/:id/fhir', route(async (req, res) => {
    const row = recordRow(req.params.id), record = await summarize(row, req.actor); check(record, 403, 'Record access denied');
    check(same(row.patient, req.actor) || await registry.canRead(row.id, req.actor), 403, 'FHIR export requires read access');
    const versions = [];
    for (let v = 1; v <= record.versionCount; v++) {
      const vrow = db.prepare('SELECT * FROM versions WHERE record_id=? AND version=?').get(row.id, v);
      const { payload } = await loadVersion(row.id, v);
      versions.push({ recordId: row.id, version: v, payload, author: vrow.author, createdAt: vrow.created_at });
    }
    res.json(toFhirBundle({ record, versions, grant: record.grant, nowSeconds: Math.floor(Date.now() / 1000) }));
  }));
  app.get('/api/records/:id/versions/:version/content', route(async (req, res) => {
    const id = req.params.id; recordRow(id); const version = Number(req.params.version); check(Number.isSafeInteger(version) && version > 0, 400, 'Invalid version');
    if (!await registry.canRead(id, req.actor)) { audit(id, req.actor, 'record.read', 'denied'); throw new HttpError(403, 'Read permission expired, revoked, or absent'); }
    const { row, payload } = await loadVersion(id, version);
    let verified = true; const attestation = row.attestation ? JSON.parse(row.attestation) : null;
    if (attestation) verified = same(verifyTypedData(domain, types, attestation.value, attestation.signature), row.author) && attestation.value.contentHash === keccak256(toUtf8Bytes(payload.content)) && attestation.value.ciphertextHash === row.ciphertext_hash && attestation.value.recordId === id && Number(attestation.value.expectedVersion) === version - 1;
    check(verified, 409, 'Clinical update signature verification failed');
    if (!await registry.canRead(id, req.actor)) { audit(id, req.actor, 'record.read', 'denied'); throw new HttpError(403, 'Permission changed before release'); }
    audit(id, req.actor, 'record.read', 'success');
    res.json({ content: payload.content, title: payload.title, category: payload.category, version, author: row.author, verified, signature: attestation?.signature ?? null, ciphertextHash: row.ciphertext_hash });
  }));
  app.post('/api/records/:id/grants', route(async (req, res) => serial(async () => {
    const id = req.params.id; owned(id, req.actor); const delegate = address(req.body.delegate), permissions = req.body.permissions, expiresAt = req.body.expiresAt;
    check([1, 2, 3].includes(permissions) && Number.isSafeInteger(expiresAt) && expiresAt > Date.now()/1000 && expiresAt <= Date.now()/1000 + 365*DAY, 400, 'Invalid permissions or expiry (maximum one year)');
    const tx = await (await (await signer(req.actor)).grantAccess(id, delegate, permissions, expiresAt)).wait(); audit(id, req.actor, 'access.granted', 'success', tx.hash); res.json({ ok: true, txHash: tx.hash });
  })));
  app.delete('/api/records/:id/grants/:delegate', route(async (req, res) => serial(async () => { const id = req.params.id; owned(id, req.actor); const delegate = address(req.params.delegate); const tx = await (await (await signer(req.actor)).revokeAccess(id, delegate)).wait(); audit(id, req.actor, 'access.revoked', 'success', tx.hash); res.json({ ok: true, txHash: tx.hash }); })));
  app.post('/api/records/:id/archive', route(async (req, res) => serial(async () => { const id = req.params.id; owned(id, req.actor); check(typeof req.body.archived === 'boolean', 400, 'archived must be boolean'); const tx = await (await (await signer(req.actor)).setArchived(id, req.body.archived)).wait(); audit(id, req.actor, req.body.archived ? 'record.archived' : 'record.restored', 'success', tx.hash); res.json({ ok: true, txHash: tx.hash }); })));
  app.post('/api/revoke-all', route(async (req, res) => serial(async () => { const tx = await (await (await signer(req.actor)).revokeAllAccess()).wait(); for (const row of db.prepare('SELECT id FROM records WHERE patient=?').all(req.actor)) audit(row.id, req.actor, 'access.revoked-all', 'success', tx.hash); res.json({ ok: true, txHash: tx.hash }); })));
  app.post('/api/records/:id/prepare', route(async (req, res) => {
    const id = req.params.id; recordRow(id); check(await registry.canWrite(id, req.actor), 403, 'Write access denied');
    const chain = await registry.getRecord(id), expectedVersion = Number(chain.versionCount);
    check(req.body.expectedVersion === expectedVersion, 409, 'Version changed; refresh before signing');
    const content = contentValue(req.body.content), previous = await loadVersion(id, expectedVersion);
    for (const [key, value] of prepared) if (value.deadline <= Date.now()/1000) prepared.delete(key);
    check(prepared.size < 100, 429, 'Too many pending updates');
    const encrypted = vault.encrypt({ ...previous.payload, content }, aad(id, expectedVersion + 1));
    const requestId = randomUUID(), deadline = Math.floor(Date.now()/1000)+120;
    const value = { recordId: id, expectedVersion, ciphertextHash: keccak256(encrypted.bytes), contentHash: keccak256(toUtf8Bytes(content)), nonce: hexlify(randomBytes(32)), deadline };
    prepared.set(requestId, { id, actor: req.actor, encrypted, value, deadline });
    res.json({ requestId, domain, types, value });
  }));
  app.post('/api/records/:id/versions', route(async (req, res) => serial(async () => {
    const item = prepared.get(req.body.requestId); check(item && item.id === req.params.id && same(item.actor, req.actor), 404, 'Prepared update not found');
    prepared.delete(req.body.requestId);
    check(item.deadline > Date.now()/1000, 409, 'Prepared update expired');
    check(await registry.canWrite(item.id, req.actor), 403, 'Write permission revoked or expired before submission');
    let recovered; try { recovered = verifyTypedData(domain, types, item.value, req.body.signature); } catch { throw new HttpError(400, 'Invalid update signature'); }
    check(same(recovered, req.actor), 403, 'Update signer mismatch');
    const chain = await registry.getRecord(item.id); check(Number(chain.versionCount) === item.value.expectedVersion, 409, 'Stale update; prepare and sign again');
    const tx = await execute('append', item.id, async () => {
      const receipt = await (await (await signer(req.actor)).appendVersion(item.id, item.value.expectedVersion, keccak256(item.encrypted.token), item.value.ciphertextHash)).wait();
      insertVersion(item.id, item.value.expectedVersion + 1, item.encrypted, req.actor, receipt.hash, { value: item.value, signature: req.body.signature }); audit(item.id, req.actor, 'version.signed', 'success', receipt.hash); return receipt;
    });
    res.status(201).json({ ok: true, version: item.value.expectedVersion + 1, txHash: tx.hash });
  })));
  app.get('/api/audit', route(async (req, res) => {
    if (req.query.recordId) owned(String(req.query.recordId), req.actor);
    const rows = req.query.recordId ? db.prepare('SELECT * FROM audit WHERE record_id=? ORDER BY timestamp DESC LIMIT 200').all(req.query.recordId) : db.prepare('SELECT a.* FROM audit a JOIN records r ON r.id=a.record_id WHERE r.patient=? ORDER BY timestamp DESC LIMIT 200').all(req.actor);
    res.json({ events: rows.map(r => ({ id: r.id, recordId: r.record_id, actor: r.actor, action: r.action, outcome: r.outcome, timestamp: r.timestamp, txHash: r.tx_hash })) });
  }));
  const auditRowsFor = actor => db.prepare('SELECT a.rowid AS seq, a.* FROM audit a LEFT JOIN records r ON r.id = a.record_id WHERE r.patient = ? OR (a.record_id IS NULL AND a.actor = ?) ORDER BY a.rowid ASC').all(actor, actor);
  app.post('/api/audit/anchor', route(async (req, res) => serial(async () => {
    const last = db.prepare('SELECT MAX(to_seq) AS m FROM anchors WHERE patient = ?').get(req.actor)?.m ?? 0;
    const rows = auditRowsFor(req.actor).filter(r => r.seq > last);
    check(rows.length > 0, 409, 'No new audit events to anchor');
    const root = merkleRoot(rows.map(leafHash));
    const chainIndex = Number(await anchorContract.anchorCount());
    const anchorer = anchorContract.connect(await provider.getSigner(req.actor));
    const tx = await (await anchorer.anchor(root, rows[0].seq, rows[rows.length - 1].seq)).wait();
    const info = db.prepare('INSERT INTO anchors(patient, root, from_seq, to_seq, chain_index, tx_hash, anchored_at) VALUES(?,?,?,?,?,?,?)').run(req.actor, root, rows[0].seq, rows[rows.length - 1].seq, chainIndex, tx.hash, new Date().toISOString());
    audit(null, req.actor, 'audit.anchored', 'success', tx.hash);
    res.status(201).json({ anchorId: Number(info.lastInsertRowid), chainIndex, root, fromSeq: rows[0].seq, toSeq: rows[rows.length - 1].seq, events: rows.length, txHash: tx.hash });
  })));
  app.get('/api/audit/anchors', route(async (req, res) => {
    const rows = db.prepare('SELECT * FROM anchors WHERE patient = ? ORDER BY id ASC').all(req.actor);
    const anchors = [];
    for (const row of rows) { const onChain = await anchorContract.getAnchor(row.chain_index); anchors.push({ anchorId: row.id, chainIndex: row.chain_index, root: row.root, fromSeq: row.from_seq, toSeq: row.to_seq, txHash: row.tx_hash, anchoredAt: row.anchored_at, onChainRoot: onChain.root, anchorer: onChain.anchorer }); }
    res.json({ anchors });
  }));
  app.get('/api/audit/verify', route(async (req, res) => {
    const row = db.prepare('SELECT * FROM anchors WHERE id = ? AND patient = ?').get(Number(req.query.anchorId), req.actor);
    check(row, 404, 'Anchor not found');
    const rows = auditRowsFor(req.actor).filter(r => r.seq >= row.from_seq && r.seq <= row.to_seq);
    const problems = [];
    if (rows.length !== row.to_seq - row.from_seq + 1) problems.push(`expected ${row.to_seq - row.from_seq + 1} events in the anchored range, found ${rows.length}`);
    if (rows.length && (rows[0].seq !== row.from_seq || rows[rows.length - 1].seq !== row.to_seq)) problems.push('range boundaries no longer match the anchored rows');
    const recomputed = rows.length ? merkleRoot(rows.map(leafHash)) : null;
    const onChain = await anchorContract.getAnchor(row.chain_index);
    if (recomputed !== row.root) problems.push('recomputed root differs from the anchored root (audit rows were edited or deleted)');
    if (onChain.root !== row.root) problems.push('on-chain root differs from the stored anchor');
    res.json({ ok: problems.length === 0, anchorId: row.id, eventsChecked: rows.length, root: row.root, recomputedRoot: recomputed, onChainRoot: onChain.root, problems });
  }));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found' }));
  app.use(express.static(path.join(ROOT, 'dist'), { etag: false, maxAge: 0 }));
  app.use((err, _req, res, _next) => { const status = err.status ?? (err.code === 'CALL_EXCEPTION' ? 409 : 500); if (status >= 500) console.error('Gateway operation failed:', err.message); res.status(status).json({ error: status >= 500 ? 'Operation failed safely; inspect local server logs' : err.message }); });
  return { app, provider, rpc, registry, registryAddress, anchorContract, anchorAddress, identities, db, dataDir, async close() { await queue; provider.destroy(); await rpc.disconnect(); vault.close(); db.close(); } };
}
