# Changelog — 0.2.1 (22 October 2026, UTC)

Feature release on top of the maintenance build below. The vendored registry
contract, its artifact, and all runtime security controls are unchanged.

| File | Change and reason |
| --- | --- |
| `package.json` | Version 0.2.1; `compile` now also builds the AuditAnchor contract. |
| `VENDORED.md` | New: pins the canonical registry commit the vendored contract came from, with the re-sync rules. |
| `contracts/AuditAnchor.sol` | New companion contract: stores Merkle roots over audit-event ranges for tamper-evidence. |
| `artifacts/AuditAnchor.json` | New: compiled anchor artifact (1,030 deployed bytes, same pinned solc settings). |
| `scripts/compiler-anchor.mjs`, `scripts/compile-anchor.mjs` | New: guarded compile pipeline for the anchor contract, mirroring the registry's pattern without touching it. |
| `server/merkle.mjs` | New: audit-event leaf hashing, Merkle roots and proofs (keccak256, ordered pairs, odd node promoted). |
| `server/app.mjs` | Deploys/loads the anchor contract beside the registry (deployment.json gains `anchorAddress`, migrated in place); new `anchors` table; `POST /api/audit/anchor`, `GET /api/audit/anchors`, `GET /api/audit/verify`; `GET /api/records/:id/fhir` endpoint. |
| `server/fhir.mjs` | New: FHIR R4 projection (Patient, Consent from the live grant, version resources / DocumentReference wrapping). |
| `test/audit-anchor.test.mjs` | New: Merkle unit checks plus anchor → verify → tamper → detect and range isolation end-to-end. |
| `test/fhir.test.mjs` | New: Bundle shape, Consent mirroring grant/revocation, access gating. |
| `zk/` | New standalone prototype: Groth16 consent-membership circuit (1,575 constraints), Poseidon tree mirror, development-setup build, proof tests, README with exact claims and limits. Circom binary and build artifacts are not committed. |
| `Dockerfile`, `docker-compose.yml`, `.dockerignore` | New: two-stage image and one-command demo (host networking; loopback posture preserved). Not executed in the release environment — see NOT_FIXED.md. |
| `docs/SECURITY.md` | Residual risk 6 updated: anchored audit ranges are tamper-evident; unanchored events remain local evidence. |
| `docs/ARCHITECTURE.md` | New sections: audit anchoring, FHIR export, ZK prototype. |
| `README.md` | 0.2.1 extensions section and project-map additions. |
| `NOT_FIXED.md` | Docker non-execution and ZK non-integration recorded. |
| `VALIDATION.md` | Refreshed for the 33-test main suite and the zk suite. |

# Maintenance changelog — 22 October 2026 (UTC)

All original contract logic, application runtime security controls, dependency versions and synthetic-only scope are preserved. Earlier per-item runs occurred on 21 October in America/New_York; final verification is dated in UTC.

| File | Change and reason |
| --- | --- |
| `LICENSE` | Added the full copyright holder: Clinical Outcomes Research Group, CORG LLC. |
| `contracts/MedicalRecordsRegistry.sol` | Added requested first-line copyright attribution; no logic changes. |
| `package.json` | Added author; wired read-only pretest contract check and portable test runner. |
| `package-lock.json` | Marked Ganache's Darwin-only fsevents optional so Linux installs succeed; retained all versions and esbuild platforms. |
| `artifacts/MedicalRecordsRegistry.json` | Regenerated after copyright metadata change; runtime size remains 3,732 bytes. |
| `scripts/compiler.mjs` | New shared pinned Solidity compiler configuration and bytecode comparison. |
| `scripts/check-contract.mjs` | New read-only guard that fails on deployed-bytecode drift. |
| `scripts/compile.mjs` | Reused shared compiler; ordinary builds cannot overwrite drift; explicit reviewed resync flag added. |
| `scripts/run-tests.mjs` | New platform-independent test discovery, preserved diagnostics, environment notes and real exit-code PASS/FAIL summary; clears inherited Node test-worker context for nested runner checks. |
| `test/dependencies.test.mjs` | Added optional platform dependency regression check. |
| `test/contract-drift.test.mjs` | Added matching-artifact and deliberate-drift rejection tests, including non-overwrite and failing CLI exit. |
| `test/boot-smoke.test.mjs` | Added actual server process/HTTP patient and clinician workflow, Host/Origin denial, signed update, revocation and isolated-data cleanup. |
| `test/test-runner.test.mjs` | Added retained-diagnostic and genuine-failure propagation checks. |
| `README.md` | Updated clean start instructions, project map, vendoring/resync policy and known environment notes; retained candid limits. |
| `docs/SECURITY.md` | Added maintenance verification note; runtime security model unchanged. |
| `VALIDATION.md` | Refreshed executed checks, final date/count, environment and limits. |
| `test-results.txt` | Complete final fresh-install npm test output. |
| `verification/01-compile.txt` | Copyright-only recompilation evidence. |
| `verification/01-test-results.txt` | Original 24-test suite after copyright refresh. |
| `verification/02-original-install.txt` | Reproduction of original Linux EBADPLATFORM installation failure. |
| `verification/02-clean-install.txt` | Fresh ZIP install, compile, build and 25-test run after lockfile fix. |
| `verification/03-contract-guard.txt` | Drift guard verification output. |
| `verification/04-boot-smoke.txt` | Passing real-server smoke verification. |
| `verification/05-docs-tests.txt` | Compile/build and 28-test intermediate verification. |
| `verification/06-warning-runner.txt` | Passing warning/failure runner checks. |
| `verification/07-final-clean-room.txt` | Final fresh-directory unzip, install, compile, build, full tests and README startup transcript. |
| `NOT_FIXED.md` | Explicit remaining limitations and reasoning. |
| `CHANGELOG.md` | This complete file-by-file change inventory. |

Verification caught two test-harness issues during development: Fetch normalized the hostile Host header, so the smoke test now sends it through raw HTTP; inherited Node test-worker context prevented nested runner fixtures from executing correctly, so the standalone runner clears that context. Both were corrected before final verification. No application security control was weakened.
