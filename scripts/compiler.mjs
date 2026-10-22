import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sourceName = 'contracts/MedicalRecordsRegistry.sol';
export const artifactName = 'artifacts/MedicalRecordsRegistry.json';

/** Single pinned compiler configuration shared by build and read-only drift check. */
export function compileRegistry(root = projectRoot) {
  if (!solc.version().startsWith('0.8.30+')) throw new Error(`Expected Solidity 0.8.30; got ${solc.version()}`);
  const input = {
    language: 'Solidity',
    sources: { [sourceName]: { content: fs.readFileSync(path.join(root, sourceName), 'utf8') } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'paris',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'metadata'] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  for (const diagnostic of output.errors ?? []) console.error(diagnostic.formattedMessage);
  if ((output.errors ?? []).some(d => d.severity === 'error')) throw new Error('Solidity compilation failed');
  const compiled = output.contracts[sourceName].MedicalRecordsRegistry;
  return {
    contractName: 'MedicalRecordsRegistry', sourceName, compilerVersion: solc.version(),
    abi: compiled.abi, bytecode: `0x${compiled.evm.bytecode.object}`,
    deployedBytecode: `0x${compiled.evm.deployedBytecode.object}`,
    metadata: JSON.parse(compiled.metadata),
  };
}

export function assertArtifactMatches(compiled, root = projectRoot) {
  const filename = path.join(root, artifactName);
  if (!fs.existsSync(filename)) throw new Error(`Missing committed contract artifact: ${artifactName}. Restore it or deliberately resync from the canonical repository.`);
  const reference = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(reference.deployedBytecode ?? '') || compiled.deployedBytecode.toLowerCase() !== reference.deployedBytecode.toLowerCase()) {
    throw new Error('CONTRACT DRIFT: compiled deployed bytecode differs from artifacts/MedicalRecordsRegistry.json. Nothing was overwritten. Re-sync the vendored contract deliberately from github.com/corgdata/solidity-medical-records, review it, then explicitly regenerate the artifact.');
  }
  return (compiled.deployedBytecode.length - 2) / 2;
}
