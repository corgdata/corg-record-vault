import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const files=process.argv.slice(2);
if(!files.length) files.push(...readdirSync(path.join(root,'test')).filter(name=>name.endsWith('.test.mjs')).sort().map(name=>path.join(root,'test',name)));
// Keep all native diagnostics. TAP marks test-process output as comments (#),
// while the real child exit status alone controls our PASS/FAIL summary.
console.log('# ENVIRONMENT NOTE (non-fatal): Node SQLite ExperimentalWarning is informational; SQLite remains enabled.');
console.log('# ENVIRONMENT NOTE (non-fatal): Ganache may print "Cannot find module ... uws_*.node" followed by "Falling back to a NodeJS implementation". This pair is a supported JS fallback, not a failed test.');
console.log('# Diagnostics are preserved; assertion failures, failed imports and process errors still fail this command.');
// A standalone nested test runner must not inherit Node's parent test-worker context.
const childEnv={...process.env};
delete childEnv.NODE_TEST_CONTEXT;
const child=spawn(process.execPath,['--test','--test-reporter=tap',...files],{cwd:root,env:childEnv,stdio:'inherit'});
let failedToStart=false;
child.on('error',error=>{failedToStart=true;console.error(`TEST RESULT: FAIL (test process could not start): ${error.message}`);process.exitCode=1;});
child.on('close',(code,signal)=>{
 if(failedToStart)return;
 const success=code===0 && signal===null;
 console.log(success?'TEST RESULT: PASS (exit 0). Environment notices above are non-fatal.':`TEST RESULT: FAIL (exit ${code ?? 'none'}, signal ${signal ?? 'none'}).`);
 process.exitCode=success?0:(code || 1);
});
