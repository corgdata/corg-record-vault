import fs from 'node:fs';
import path from 'node:path';
import { compileAnchor, assertAnchorArtifactMatches, projectRoot, anchorArtifactName } from './compiler-anchor.mjs';
try {
  const flags = process.argv.slice(2);
  if (flags.some(flag => flag !== '--update-artifact')) throw new Error('Usage: node scripts/compile-anchor.mjs [-- --update-artifact]');
  const artifact = compileAnchor();
  if (!flags.includes('--update-artifact')) assertAnchorArtifactMatches(artifact);
  fs.mkdirSync(path.join(projectRoot, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, anchorArtifactName), JSON.stringify(artifact, null, 2) + '\n');
  console.log(`Compiled ${artifact.contractName}: ${(artifact.deployedBytecode.length - 2) / 2} deployed bytes; solc ${artifact.compilerVersion}; Paris EVM.`);
  if (flags.includes('--update-artifact')) console.log('Explicit artifact refresh completed. Review and commit source and artifact together.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
