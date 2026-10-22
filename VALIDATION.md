# Validation — 22 October 2026 (UTC)

## 0.2.1 feature release

Executed on Linux with Node v24.20.0 in the working tree (and re-verified from
a fresh copy before publication; see the repository's release tag):

- Main suite: **33 tests passed, 0 failed** — the 30 from the maintenance
  build plus `test/audit-anchor.test.mjs` (2) and `test/fhir.test.mjs` (1).
  The anchor tests cover Merkle determinism and proofs, the full
  anchor → verify flow, tamper detection on edit and on deletion, and range
  isolation. The FHIR test covers Bundle shape, Consent mirroring grant and
  revocation (including the exact provision period end), FHIR-shaped content
  embedding, DocumentReference wrapping, and access gating.
- ZK prototype (`zk/`): circuit compiles with circom 2.1.9 (1,575
  constraints); the development Groth16 setup completes; the suite proves a
  valid grant, verifies it (including the exact scope-bound nullifier), and
  confirms the failure modes — an expired grant cannot generate a proof,
  proofs do not verify against another tree's root, tampered public signals
  fail. Note: proving/verifying through the snarkjs API leaves worker
  threads open, so the zk test script uses `--test-force-exit`.
- Contracts compile: registry 3,732 deployed bytes (drift guard passing,
  artifact unchanged); AuditAnchor 1,030 deployed bytes via its own guarded
  pipeline.
- Docker packaging (`Dockerfile`, `docker-compose.yml`) is included but was
  **not executed**: the verification environment has no Docker. The files are
  written to the documented one-command flow and the limitation is recorded
  in NOT_FIXED.md rather than claimed as tested.

## Maintenance build (0.2.0 base)

## Final clean-room run

Executed on Linux with Node v24.19.0 and npm 11.9.0 in a fresh directory extracted from a source ZIP. Commands, diagnostics and exit codes are preserved in `verification/07-final-clean-room.txt`:

```sh
unzip ../final-candidate.zip
cd corg-record-vault
npm ci
npm run compile
npm run build
npm test
npm start
```

- Clean `npm ci`: added 425 packages; exit 0. No dependency versions were downgraded or removed.
- Solidity 0.8.30, Paris EVM, optimizer 200: **3,732 deployed bytes**; exit 0.
- esbuild frontend build: exit 0.
- Read-only drift guard: complete deployed bytecode matches the committed artifact, including metadata.
- **30 tests passed, 0 failed, 0 skipped**. Complete fresh `npm test` output is in `test-results.txt`.
- Default `npm start` bound `127.0.0.1:3000`; actual HTTP requests to `/` and `/api/config` both returned 200. Server was shut down afterward.

The delivered ZIP contains the same executable source, package manifests, lockfile and artifact as the tested candidate. Only final documentation and captured verification outputs were refreshed afterward. Archive root remains `corg-record-vault/`; generated dependencies, dist and local data are excluded.

## Coverage

All 24 original tests remain: 18 contract tests, two encrypted-vault tests, HTTP/EVM integration, clean-restart persistence and two browser adapter tests. They cover permissions, expiry, revocation, archival, immutable history, stale versions, challenge replay, signatures, encryption integrity and persistence.

Six new tests cover optional platform dependencies (one), read-only artifact matching and drift rejection (two), real-process startup/HTTP workflow (one), and diagnostic preservation plus genuine-failure propagation (two). The boot smoke test authenticates the patient, creates/opens a synthetic record, grants the clinician, authenticates the clinician, submits a signed update, revokes, verifies denied access/contribution, and cleans up its isolated application/data directory. It also checks hostile Host/Origin denial.

Per-item transcripts in `verification/` retain the original installation failure and subsequent passing verification. Earlier intermediate runs were recorded on 21 October 2026 in America/New_York; this final report uses UTC.

## Environment and limits

Ganache's optional native µWS binary did not match this Node build and its JavaScript networking fallback ran successfully. Node SQLite emitted its experimental notice. Diagnostics remain visible; the runner labels the known environment notices and derives PASS/FAIL from the actual process exit status. A regression test verifies genuine failures remain failures.

Windows and macOS execution was not available. Their optional dependency entries remain present, but success on those operating systems is not claimed. The offline drift guard does not establish an upstream commit or compare remote HEAD.

Only synthetic records and a local EVM were used. Contract logic and gateway runtime security controls were not changed. No formal verification, load testing, third-party audit, real KMS, hospital integration, production transaction or new manual browser UI review was performed. Browser adapter tests are automated; earlier manual UI inspection is historical, not repeated in this maintenance run. Demo custody, gateway plaintext access and other limits in `docs/SECURITY.md` remain applicable. See `NOT_FIXED.md`.
