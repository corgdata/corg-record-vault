import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Wallet } from 'ethers';
import { Vault, seal, unseal } from '../server/vault.mjs';

async function temporary(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'corg-vault-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('vault encrypts records with independent keys, private files and authenticated context', async t => {
  const directory = await temporary(t);
  const vault = new Vault(directory);
  t.after(() => vault.close());
  const marker = 'SYNTHETIC_SECRET_MARKER_741852';
  const payload = { content: marker };
  const first = vault.encrypt(payload, 'chain:31337:record:A:version:1');
  const second = vault.encrypt(payload, 'chain:31337:record:A:version:2');
  assert.notEqual(first.filename, second.filename);
  assert.notDeepEqual(first.bytes, second.bytes);
  assert.equal(first.bytes.includes(Buffer.from(marker)), false);
  assert.equal(first.wrappedKey.includes(marker), false);
  const row = { filename: first.filename, wrapped_key: first.wrappedKey };
  assert.deepEqual(vault.read(row, 'chain:31337:record:A:version:1').payload, payload);
  assert.throws(() => vault.read(row, 'chain:31337:record:B:version:1'));
  assert.throws(() => vault.read({ ...row, filename: '../master.key' }, 'context'));
  assert.equal((await stat(path.join(directory, 'master.key'))).mode & 0o777, 0o600);
  assert.equal((await stat(path.join(directory, first.filename))).mode & 0o777, 0o600);
});

test('authenticated encryption rejects a modified ciphertext and tag', () => {
  const key = Buffer.alloc(32, 7);
  const envelope = seal(key, Buffer.from('synthetic'), 'bound-context');
  const body = Buffer.from(envelope.body, 'base64'); body[0] ^= 1;
  assert.throws(() => unseal(key, { ...envelope, body: body.toString('base64') }, 'bound-context'));
  const tag = Buffer.from(envelope.tag, 'base64'); tag[0] ^= 1;
  assert.throws(() => unseal(key, { ...envelope, tag: tag.toString('base64') }, 'bound-context'));
  assert.throws(() => unseal(key, envelope, 'different-context'));
});

async function http(base, method, route, { token, body, headers = {} } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}
async function login(base, wallet) {
  const challenge = await http(base, 'POST', '/api/auth/challenge', { body: { address: wallet.address } });
  assert.equal(challenge.status, 200, JSON.stringify(challenge.data));
  const signature = await wallet.signMessage(challenge.data.message);
  const result = await http(base, 'POST', '/api/auth/verify', { body: { nonce: challenge.data.nonce, signature } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data.token;
}
function success(result) {
  assert.ok(result.status >= 200 && result.status < 300, `HTTP ${result.status}: ${JSON.stringify(result.data)}`);
  return result.data;
}
function denied(result) { assert.ok([400, 401, 403, 404, 409, 410].includes(result.status), `Expected rejection; got ${result.status}: ${JSON.stringify(result.data)}`); }

import { createApp } from '../server/app.mjs';
import { createServer } from 'node:net';
async function fixture(t) {
 const directory=await temporary(t),probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const base=`http://127.0.0.1:${port}`,service=await createApp({dataDir:directory,origin:base,seed:false,blockTime:0});
 const server=service.app.listen(port,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await new Promise(r=>server.close(r));await service.close();});
 const [patient,clinician,outsider]=service.identities.map(i=>new Wallet(i.privateKey));return {base,service,directory,patient,clinician,outsider};
}
test('HTTP/EVM workflow: auth replay, signed update, revocation, isolation and encrypted storage',async t=>{
 const {base,service,directory,patient,clinician,outsider}=await fixture(t);
 assert.equal((await http(base,'GET','/api/records')).status,401);
 assert.equal((await http(base,'GET','/api/config',{headers:{Origin:'https://evil.example'}})).status,403);
 const challenge=success(await http(base,'POST','/api/auth/challenge',{body:{address:patient.address}}));
 const proof={nonce:challenge.nonce,signature:await patient.signMessage(challenge.message)};
 const pt=success(await http(base,'POST','/api/auth/verify',{body:proof})).token;
 assert.equal((await http(base,'POST','/api/auth/verify',{body:proof})).status,401);
 const wrong=success(await http(base,'POST','/api/auth/challenge',{body:{address:patient.address}}));
 assert.equal((await http(base,'POST','/api/auth/verify',{body:{nonce:wrong.nonce,signature:await clinician.signMessage(wrong.message)}})).status,401);
 const ct=await login(base,clinician),ot=await login(base,outsider);
 const marker='SYNTHETIC_CONTENT_ONLY_86420';
 const record=success(await http(base,'POST','/api/records',{token:pt,body:{title:'Synthetic laboratory',category:'Laboratory',content:marker}})),id=record.id;
 assert.equal(success(await http(base,'GET','/api/records',{token:ct})).records.length,0);
 assert.equal((await http(base,'GET',`/api/records/${id}`,{token:ot})).status,403);
 assert.equal((await http(base,'GET',`/api/records/${id}/versions/1/content`,{token:ct})).status,403);
 success(await http(base,'POST',`/api/records/${id}/grants`,{token:pt,body:{delegate:clinician.address,permissions:3,expiresAt:Math.floor(Date.now()/1000)+86400}}));
 assert.equal(success(await http(base,'GET',`/api/records/${id}/versions/1/content`,{token:ct})).content,marker);
 const bad=success(await http(base,'POST',`/api/records/${id}/prepare`,{token:ct,body:{content:'Invalid signer',expectedVersion:1}}));
 assert.equal((await http(base,'POST',`/api/records/${id}/versions`,{token:ct,body:{requestId:bad.requestId,signature:await outsider.signTypedData(bad.domain,bad.types,bad.value)}})).status,403);
 const prep=success(await http(base,'POST',`/api/records/${id}/prepare`,{token:ct,body:{content:'SYNTHETIC signed follow-up',expectedVersion:1}}));
 const signature=await clinician.signTypedData(prep.domain,prep.types,prep.value);
 success(await http(base,'POST',`/api/records/${id}/versions`,{token:ct,body:{requestId:prep.requestId,signature}}));
 denied(await http(base,'POST',`/api/records/${id}/versions`,{token:ct,body:{requestId:prep.requestId,signature}}));
 const v2=success(await http(base,'GET',`/api/records/${id}/versions/2/content`,{token:pt}));assert.equal(v2.verified,true);assert.equal(v2.author,clinician.address);assert.equal(v2.content,'SYNTHETIC signed follow-up');
 assert.equal(success(await http(base,'GET',`/api/records/${id}/versions/1/content`,{token:pt})).content,marker);
 assert.equal((await http(base,'POST',`/api/records/${id}/prepare`,{token:ct,body:{content:'stale',expectedVersion:1}})).status,409);
 const pending=success(await http(base,'POST',`/api/records/${id}/prepare`,{token:ct,body:{content:'must not commit',expectedVersion:2}}));
 success(await http(base,'DELETE',`/api/records/${id}/grants/${clinician.address}`,{token:pt,body:{}}));
 assert.equal((await http(base,'GET',`/api/records/${id}/versions/2/content`,{token:ct})).status,403);
 assert.equal((await http(base,'POST',`/api/records/${id}/versions`,{token:ct,body:{requestId:pending.requestId,signature:await clinician.signTypedData(pending.domain,pending.types,pending.value)}})).status,403);
 assert.equal(success(await http(base,'GET','/api/records',{token:ct})).records.length,0);
 const events=success(await http(base,'GET',`/api/audit?recordId=${id}`,{token:pt})).events;
 assert.ok(events.some(e=>e.action==='record.read'&&e.outcome==='denied'));assert.ok(events.some(e=>e.action==='version.signed'));
 assert.equal((await http(base,'GET',`/api/audit?recordId=${id}`,{token:ct})).status,403);
 for(const name of await readdir(path.join(directory,'vault')))if(name.endsWith('.enc'))assert.equal((await readFile(path.join(directory,'vault',name))).includes(Buffer.from(marker)),false);
 assert.equal((await service.registry.getRecord(id)).versionCount,2n);
});

test('local chain, encrypted records and wallet identities survive a clean restart',async t=>{
 const dataDir=await temporary(t);
 let service=await createApp({dataDir,seed:true,blockTime:0});
 const rows=service.db.prepare('SELECT id FROM records').all();assert.equal(rows.length,3);
 const address=service.registryAddress,owner=service.identities[0].address;
 await service.close();
 service=await createApp({dataDir,seed:true,blockTime:0});
 try{assert.equal(service.registryAddress,address);assert.equal(service.identities[0].address,owner);
 assert.equal(service.db.prepare('SELECT COUNT(*) AS n FROM records').get().n,3);
 for(const {id}of rows)assert.equal((await service.registry.getRecord(id)).patient,owner);
 }finally{await service.close();}
});
