import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ZK = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(ZK, 'build');
const CIRCOM = path.join(ZK, 'tools', 'circom');
const SNARKJS = path.join(ZK, 'node_modules', '.bin', 'snarkjs');
const entropy = () => randomBytes(32).toString('hex');
const B = name => path.join(BUILD, name);

if (!fs.existsSync(CIRCOM)) {
  console.error('Missing the circom 2.1.9 binary at zk/tools/circom. Download the release binary for your platform from https://github.com/iden3/circom/releases (v2.1.9) and place it there. The binary is deliberately not committed.');
  process.exit(1);
}
fs.mkdirSync(BUILD, { recursive: true });

console.log('[1/5] Compiling circuit (circom 2.1.9)…');
await run(CIRCOM, ['circuits/grant_membership.circom', '--r1cs', '--wasm', '--sym', '-o', 'build', '-l', 'node_modules'], { cwd: ZK });

console.log('[2/5] Powers of tau (DEVELOPMENT ceremony — not production; see README)…');
await run(SNARKJS, ['powersoftau', 'new', 'bn128', '12', B('pot_0000.ptau')], { cwd: ZK }); // 2^12 = 4096 slots >= 1575 constraints
await run(SNARKJS, ['powersoftau', 'contribute', B('pot_0000.ptau'), B('pot_0001.ptau'), '--name=corg-zk dev contribution 1', `-e=${entropy()}`], { cwd: ZK });
await run(SNARKJS, ['powersoftau', 'prepare', 'phase2', B('pot_0001.ptau'), B('pot_final.ptau')], { cwd: ZK });

console.log('[3/5] Groth16 setup…');
await run(SNARKJS, ['groth16', 'setup', B('grant_membership.r1cs'), B('pot_final.ptau'), B('grant_0000.zkey')], { cwd: ZK });
await run(SNARKJS, ['zkey', 'contribute', B('grant_0000.zkey'), B('grant_final.zkey'), '--name=corg-zk dev contribution 1', `-e=${entropy()}`], { cwd: ZK });

console.log('[4/5] Exporting verification key…');
await run(SNARKJS, ['zkey', 'export', 'verificationkey', B('grant_final.zkey'), B('verification_key.json')], { cwd: ZK });

console.log('[5/5] Exporting Solidity verifier (reference only)…');
await run(SNARKJS, ['zkey', 'export', 'solidityverifier', B('grant_final.zkey'), B('GrantVerifier.sol')], { cwd: ZK });

const { stdout } = await run(SNARKJS, ['r1cs', 'info', B('grant_membership.r1cs')], { cwd: ZK });
const constraints = stdout.match(/Constraints:\s*(\d+)/)?.[1] ?? 'unknown';
console.log(`Done. Circuit constraints: ${constraints}. Artifacts in zk/build/ (not committed).`);
