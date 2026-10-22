import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { compileRegistry, assertArtifactMatches, projectRoot } from '../scripts/compiler.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'corg-contract-drift-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const sub of ['contracts','artifacts']) mkdirSync(path.join(root, sub));
  for (const name of ['contracts/MedicalRecordsRegistry.sol','artifacts/MedicalRecordsRegistry.json']) copyFileSync(path.join(projectRoot,name),path.join(root,name));
  return root;
}

test('drift guard accepts exact committed deployed bytecode without rewriting artifact', t => {
  const root=fixture(t), filename=path.join(root,'artifacts/MedicalRecordsRegistry.json');
  const original=readFileSync(filename);
  assert.equal(assertArtifactMatches(compileRegistry(root),root),3732);
  assert.deepEqual(readFileSync(filename),original);
});

test('drift guard rejects changed source and mismatched artifact with nonzero process exit', t => {
  const root=fixture(t), source=path.join(root,'contracts/MedicalRecordsRegistry.sol'), filename=path.join(root,'artifacts/MedicalRecordsRegistry.json');
  const sourceText=readFileSync(source,'utf8'), original=readFileSync(filename);
  // Modify only an isolated temporary copy; the vendored file is never edited.
  writeFileSync(source,sourceText.replace('uint8 public constant READ = 1;', 'uint8 public constant READ = 4;'));
  assert.throws(()=>assertArtifactMatches(compileRegistry(root),root),/CONTRACT DRIFT/);
  assert.deepEqual(readFileSync(filename),original);
  writeFileSync(source,sourceText);
  const changed=JSON.parse(original);changed.deployedBytecode='0x00';writeFileSync(filename,JSON.stringify(changed));
  const child=spawnSync(process.execPath,['--input-type=module','-e',`import {compileRegistry,assertArtifactMatches} from ${JSON.stringify(new URL('../scripts/compiler.mjs',import.meta.url).href)}; assertArtifactMatches(compileRegistry(${JSON.stringify(root)}),${JSON.stringify(root)});`],{encoding:'utf8'});
  assert.notEqual(child.status,0);assert.match(child.stderr,/CONTRACT DRIFT/);
  assert.equal(JSON.parse(readFileSync(filename)).deployedBytecode,'0x00');
});
