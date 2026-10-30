# Vendored contract provenance

`contracts/MedicalRecordsRegistry.sol` is vendored from the canonical repository
**github.com/corgdata/solidity-medical-records**, pinned at commit
`90c8928f7058220147866b97da21507a22bb89b4` (main, verified 2026-10-30).
The contract and its main test file are byte-identical to their state at
`464dba1351010fba0d3652e15212824e678a760a`, the commit they were first
vendored from; the canonical commits since then touched other files only.

Vendored files and their canonical counterparts:

- `contracts/MedicalRecordsRegistry.sol` from
  `contracts/MedicalRecordsRegistry.sol`,
  SHA-256 `df11d3cbf4d4be3382cdfd801817e15b12182ebb5e2d0a4dc3be283439021a9c`
- `test/contract.test.mjs` from `test/registry.test.mjs`,
  SHA-256 `24c9ffebd3dc11e1a1c4853339a21de274f31330c1dbf3ebd89391c26006c48f`

Rules:
- Never edit the vendored contract in place. Changes land in the canonical repo
  first, under its own review, and are re-vendored here deliberately.
- `npm run check-contract` (also run as part of `npm test`) compiles the vendored
  source and fails if the deployed bytecode differs from
  `artifacts/MedicalRecordsRegistry.json`.
- CI runs `scripts/check-canonical-contract.mjs`, which fetches both
  canonical files from the canonical repo and fails if either vendored
  copy differs by a single byte. The canonical repo runs the mirror
  check against the hashes recorded in its SHA256SUMS, so a canonical
  change must update that file in the same commit, and this repo then
  re-vendors deliberately.
- A deliberate re-sync updates this file's pinned commit, the artifact, and the
  changelog in the same commit.
