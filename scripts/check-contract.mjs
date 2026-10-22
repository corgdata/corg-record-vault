import { compileRegistry, assertArtifactMatches } from './compiler.mjs';
try {
  const bytes = assertArtifactMatches(compileRegistry());
  console.log(`Contract drift guard PASS: deployed bytecode matches committed artifact (${bytes} bytes, including metadata).`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
