# Vendored contract provenance

`contracts/MedicalRecordsRegistry.sol` is vendored from the canonical repository
**github.com/corgdata/solidity-medical-records**, pinned at commit
`464dba1351010fba0d3652e15212824e678a760a` (main, verified 2026-10-21).

Rules:
- Never edit the vendored contract in place. Changes land in the canonical repo
  first, under its own review, and are re-vendored here deliberately.
- `npm run check-contract` (also run as part of `npm test`) compiles the vendored
  source and fails if the deployed bytecode differs from
  `artifacts/MedicalRecordsRegistry.json`.
- A deliberate re-sync updates this file's pinned commit, the artifact, and the
  changelog in the same commit.
