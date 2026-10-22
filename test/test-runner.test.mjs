import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
const runner=fileURLToPath(new URL('../scripts/run-tests.mjs',import.meta.url));
function runFixture(t,code){const dir=mkdtempSync(path.join(os.tmpdir(),'corg-runner-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const filename=path.join(dir,'fixture.test.mjs');writeFileSync(filename,code);return spawnSync(process.execPath,[runner,filename],{encoding:'utf8',timeout:10000});}

test('test runner labels environment notices and preserves diagnostic output', t=>{
 const r=runFixture(t,`import test from 'node:test'; test('passing fixture',()=>{console.warn('SYNTHETIC diagnostic retained');});`);
 assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/ENVIRONMENT NOTE \(non-fatal\)/);assert.match(r.stdout,/# SYNTHETIC diagnostic retained/);assert.match(r.stdout,/TEST RESULT: PASS \(exit 0\)/);
});
test('test runner propagates genuine test failure with a nonzero exit', t=>{
 const r=runFixture(t,`import test from 'node:test'; import assert from 'node:assert/strict'; test('intentional failure fixture',()=>{assert.fail('SYNTHETIC_EXPECTED_FAILURE');});`);
 assert.notEqual(r.status,0);assert.match(r.stdout,/SYNTHETIC_EXPECTED_FAILURE/);assert.match(r.stdout,/TEST RESULT: FAIL/);assert.doesNotMatch(r.stdout,/TEST RESULT: PASS/);
});
