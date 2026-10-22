import fs from 'node:fs';
import path from 'node:path';
import { compileRegistry, assertArtifactMatches, projectRoot, artifactName } from './compiler.mjs';
try {
  const flags = process.argv.slice(2);
  if (flags.some(flag => flag !== '--update-artifact')) throw new Error('Usage: npm run compile [-- --update-artifact]');
  const artifact = compileRegistry();
  // Ordinary builds cannot hide drift by rewriting its baseline before npm test.
  // Use the explicit flag only after a deliberate, reviewed canonical re-sync.
  if (!flags.includes('--update-artifact')) assertArtifactMatches(artifact);
  fs.mkdirSync(path.join(projectRoot, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, artifactName), JSON.stringify(artifact, null, 2) + '\n');
  console.log(`Compiled ${artifact.contractName}: ${(artifact.deployedBytecode.length - 2) / 2} deployed bytes; solc ${artifact.compilerVersion}; Paris EVM.`);
  if (flags.includes('--update-artifact')) console.log('Explicit artifact refresh completed. Review and commit source and artifact together.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
