import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, symlink, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { request as rawRequest } from 'node:http';
import { Wallet } from 'ethers';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function freePort(){const probe=createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));return port;}

// Exercise the real executable, including startup configuration and shutdown.
// The copied app resolves its .data under a temporary directory, never the user's.
test('real server boot smoke: patient create/open, clinician signed update, revoke and denial', {timeout:45000}, async t=>{
  const sandbox=await mkdtemp(path.join(os.tmpdir(),'corg-boot-smoke-'));
  let child,output='',exitPromise;
  t.after(async()=>{
    try{
      if(child && child.exitCode===null && child.signalCode===null){
        child.kill('SIGTERM');
        const force=setTimeout(()=>child.kill('SIGKILL'),5000);
        try{await exitPromise;}finally{clearTimeout(force);}
      }
    }finally{await rm(sandbox,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
    await assert.rejects(access(sandbox));
  });
  await mkdir(path.join(sandbox,'scripts'));
  await cp(path.join(root,'server'),path.join(sandbox,'server'),{recursive:true});
  await cp(path.join(root,'artifacts'),path.join(sandbox,'artifacts'),{recursive:true});
  await cp(path.join(root,'scripts/start-local.mjs'),path.join(sandbox,'scripts/start-local.mjs'));
  await symlink(path.join(root,'node_modules'),path.join(sandbox,'node_modules'),'junction');
  const port=await freePort(),base=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,['scripts/start-local.mjs'],{cwd:sandbox,env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
  exitPromise=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{output+=data;});
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{cleanup();reject(new Error(`Server readiness timed out:\n${output}`));},15000);
    const check=()=>{if(output.includes(`CORG medical-record prototype: ${base}`)){cleanup();resolve();}};
    const failed=(code,signal)=>{cleanup();reject(new Error(`Server exited before ready (${code}/${signal}):\n${output}`));};
    const error=e=>{cleanup();reject(e);};
    function cleanup(){clearTimeout(timer);child.stdout.off('data',check);child.off('exit',failed);child.off('error',error);}
    child.stdout.on('data',check);child.once('exit',failed);child.once('error',error);check();
  });
  async function http(method,url,{token,body,headers={}}={}){
    const response=await fetch(base+url,{method,headers:{...(['POST','DELETE'].includes(method)?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`} : {}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
    return {status:response.status,body:await response.json()};
  }
  function ok(r){assert.ok(r.status>=200&&r.status<300,JSON.stringify(r));return r.body;}
  async function login(identity){const wallet=new Wallet(identity.privateKey);const challenge=ok(await http('POST','/api/auth/challenge',{body:{address:wallet.address}}));const session=ok(await http('POST','/api/auth/verify',{body:{nonce:challenge.nonce,signature:await wallet.signMessage(challenge.message)}}));return {wallet,token:session.token};}
  // Fetch can normalize Host; use raw HTTP so this checks the actual hostile header.
  const hostileHostStatus=await new Promise((resolve,reject)=>{const req=rawRequest(base+'/api/config',{headers:{Host:'evil.example'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();});
  assert.equal(hostileHostStatus,403);
  assert.equal((await http('GET','/api/config',{headers:{Origin:'https://evil.example'}})).status,403);
  const config=ok(await http('GET','/api/config'));assert.equal(config.mode,'local-evm');
  const patientIdentity=config.identities.find(x=>x.role==='patient'),clinicianIdentity=config.identities.find(x=>x.role==='clinician');
  const patient=await login(patientIdentity);
  const record=ok(await http('POST','/api/records',{token:patient.token,body:{title:'Synthetic boot smoke record',category:'Laboratory',content:'SYNTHETIC original result'}}));
  const recordPath=`/api/records/${record.id}`;
  assert.equal(ok(await http('GET',recordPath+'/versions/1/content',{token:patient.token})).content,'SYNTHETIC original result');
  ok(await http('POST',recordPath+'/grants',{token:patient.token,body:{delegate:clinicianIdentity.address,permissions:3,expiresAt:Math.floor(Date.now()/1000)+3600}}));
  const clinician=await login(clinicianIdentity);
  assert.equal(ok(await http('GET',recordPath+'/versions/1/content',{token:clinician.token})).content,'SYNTHETIC original result');
  const prepared=ok(await http('POST',recordPath+'/prepare',{token:clinician.token,body:{content:'SYNTHETIC signed follow-up',expectedVersion:1}}));
  const signature=await clinician.wallet.signTypedData(prepared.domain,prepared.types,prepared.value);
  assert.equal(ok(await http('POST',recordPath+'/versions',{token:clinician.token,body:{requestId:prepared.requestId,signature}})).version,2);
  const updated=ok(await http('GET',recordPath+'/versions/2/content',{token:patient.token}));assert.equal(updated.content,'SYNTHETIC signed follow-up');assert.equal(updated.verified,true);
  ok(await http('DELETE',recordPath+'/grants/'+clinicianIdentity.address,{token:patient.token,body:{}}));
  assert.equal((await http('GET',recordPath+'/versions/2/content',{token:clinician.token})).status,403);
  assert.equal((await http('POST',recordPath+'/prepare',{token:clinician.token,body:{content:'SYNTHETIC blocked',expectedVersion:2}})).status,403);
  assert.ok(ok(await http('GET',`/api/audit?recordId=${record.id}`,{token:patient.token})).events.some(e=>e.action==='record.read'&&e.outcome==='denied'));
  t.diagnostic('Actual startup entrypoint bound 127.0.0.1; HTTP workflow passed; temporary app/data removed by cleanup.');
});
