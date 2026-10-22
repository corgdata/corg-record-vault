import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const anchorSourceName = 'contracts/AuditAnchor.sol';
export const anchorArtifactName = 'artifacts/AuditAnchor.json';

/** Pinned compiler configuration for the AuditAnchor companion contract.
 *  Deliberately separate from compiler.mjs: the vendored registry pipeline
 *  (and its drift guard) is never touched by this contract. */
export function compileAnchor(root = projectRoot) {
  if (!solc.version().startsWith('0.8.30+')) throw new Error(`Expected Solidity 0.8.30; got ${solc.version()}`);
  const input = {
    language: 'Solidity',
    sources: { [anchorSourceName]: { content: fs.readFileSync(path.join(root, anchorSourceName), 'utf8') } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'paris',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'metadata'] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  for (const diagnostic of output.errors ?? []) console.error(diagnostic.formattedMessage);
  if ((output.errors ?? []).some(d => d.severity === 'error')) throw new Error('Solidity compilation failed');
  const compiled = output.contracts[anchorSourceName].AuditAnchor;
  return {
    contractName: 'AuditAnchor', sourceName: anchorSourceName, compilerVersion: solc.version(),
    abi: compiled.abi, bytecode: `0x${compiled.evm.bytecode.object}`,
    deployedBytecode: `0x${compiled.evm.deployedBytecode.object}`,
    metadata: JSON.parse(compiled.metadata),
  };
}

export function assertAnchorArtifactMatches(compiled, root = projectRoot) {
  const filename = path.join(root, anchorArtifactName);
  if (!fs.existsSync(filename)) throw new Error(`Missing committed contract artifact: ${anchorArtifactName}. Restore it or regenerate it deliberately with --update-artifact.`);
  const reference = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(reference.deployedBytecode ?? '') || compiled.deployedBytecode.toLowerCase() !== reference.deployedBytecode.toLowerCase()) {
    throw new Error('CONTRACT DRIFT (AuditAnchor): compiled deployed bytecode differs from artifacts/AuditAnchor.json. Nothing was overwritten. Review the change, then explicitly regenerate the artifact.');
  }
  return (compiled.deployedBytecode.length - 2) / 2;
}
