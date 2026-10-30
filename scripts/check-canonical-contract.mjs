// Cross-repo canonical drift guard for corg-record-vault.
//
// contracts/MedicalRecordsRegistry.sol and its main test
// (test/contract.test.mjs here, test/registry.test.mjs there) are
// vendored from the canonical repository
// github.com/corgdata/solidity-medical-records. This check fetches the
// canonical files from that repo's public raw URLs on main and fails
// if either vendored copy differs by a single byte, so the two repos
// cannot drift apart silently. A failure means: land the change in
// the canonical repo first, then re-vendor here and update
// VENDORED.md, per the rules in that file.
//
// Runs in CI only (the clean-room job), because it needs network
// access to the canonical repo; local npm test keeps its offline
// drift guards. Stdlib only; requires Node 18 or newer for fetch.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CANONICAL =
  "https://raw.githubusercontent.com/corgdata/solidity-medical-records/main";

const PAIRS = [
  ["contracts/MedicalRecordsRegistry.sol",
   "contracts/MedicalRecordsRegistry.sol"],
  ["test/contract.test.mjs", "test/registry.test.mjs"],
];

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

let failures = 0;
for (const [localRel, canonicalRel] of PAIRS) {
  const localHash = sha256(readFileSync(join(root, localRel)));
  const res = await fetch(`${CANONICAL}/${canonicalRel}`);
  if (!res.ok) {
    console.error(
      `FETCH FAILED: ${canonicalRel} from canonical repo ` +
        `(HTTP ${res.status})`
    );
    failures += 1;
    continue;
  }
  const canonicalHash = sha256(Buffer.from(await res.arrayBuffer()));
  if (localHash !== canonicalHash) {
    console.error(
      `CANONICAL DRIFT: ${localRel}\n  vendored  ${localHash}\n` +
        `  canonical ${canonicalHash} (${canonicalRel})`
    );
    failures += 1;
  }
}

if (failures > 0) {
  console.error(
    "Canonical drift guard FAILED: the vendored copy differs from " +
      "corgdata/solidity-medical-records. Land the change there first, " +
      "then re-vendor and update VENDORED.md."
  );
  process.exit(1);
}
console.log(
  "Canonical drift guard PASS: vendored contract and test match " +
    "corgdata/solidity-medical-records."
);
