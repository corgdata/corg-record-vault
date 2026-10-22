import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import { browserRequest as request } from '../client/browser-engine.js';
const store=new Map();
globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};
globalThis.location={origin:'https://synthetic.example'};
async function login(identity){const c=await request('POST','/api/auth/challenge',{address:identity.address});const wallet=new Wallet(identity.privateKey);const body={nonce:c.nonce,signature:await wallet.signMessage(c.message)};const session=await request('POST','/api/auth/verify',body);await assert.rejects(request('POST','/api/auth/verify',body));return {wallet,token:session.token};}
for(const fallback of [false,true])test(`browser workflow ${fallback?'portable AES-GCM':'WebCrypto'}: encrypted read, signed append, revoke and isolation`,async()=>{
 store.clear();const original=globalThis.crypto;if(fallback)Object.defineProperty(globalThis,'crypto',{configurable:true,value:{getRandomValues:original.getRandomValues.bind(original)}});
 try{
 const cfg=await request('GET','/api/config');const patient=await login(cfg.identities[0]),clinician=await login(cfg.identities[1]);
 const records=(await request('GET','/api/records',{},patient.token)).records;assert.equal(records.length,3);const id=records[0].id;
 assert.equal((await request('GET','/api/records',{},clinician.token)).records.length,0);
 await assert.rejects(request('GET',`/api/records/${id}/versions/1/content`,{},clinician.token));
 await request('POST',`/api/records/${id}/grants`,{delegate:cfg.identities[1].address,permissions:3,expiresAt:Math.floor(Date.now()/1000)+3600},patient.token);
 const detail=await request('GET',`/api/records/${id}`,{},patient.token);assert.equal(detail.grant.permissions,3);
 const content=await request('GET',`/api/records/${id}/versions/1/content`,{},clinician.token);assert.equal(content.verified,true);
 const marker='SYNTHETIC_SECRET_PAYLOAD_972';const prep=await request('POST',`/api/records/${id}/prepare`,{content:marker,expectedVersion:1},clinician.token);
 await assert.rejects(request('POST',`/api/records/${id}/prepare`,{content:marker,expectedVersion:0},clinician.token));
 const signature=await clinician.wallet.signTypedData(prep.domain,prep.types,prep.value);
 await request('POST',`/api/records/${id}/versions`,{requestId:prep.requestId,signature},clinician.token);
 assert.equal((await request('GET',`/api/records/${id}/versions/2/content`,{},patient.token)).content,marker);
 assert.equal([...store.values()].some(v=>v.includes(marker)),false);
 await request('DELETE',`/api/records/${id}/grants/${cfg.identities[1].address}`,{},patient.token);
 await assert.rejects(request('GET',`/api/records/${id}/versions/2/content`,{},clinician.token));
 assert.equal((await request('GET','/api/records',{},clinician.token)).records.length,0);
 const events=(await request('GET','/api/audit',{},patient.token)).events;assert.ok(events.some(e=>e.outcome==='denied'));
 await assert.rejects(request('GET','/api/audit',{},clinician.token));
 }finally{if(fallback)Object.defineProperty(globalThis,'crypto',{configurable:true,value:original});}
});
