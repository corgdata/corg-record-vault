# CORG Record Vault

A working vertical prototype for patient-controlled medical records: encrypted storage, wallet authentication, expiring consent, clinician-signed versions, revocation and access auditing.

**Synthetic records only.** This is engineering demonstration software, not a clinical system, an independent security audit, or a compliance certification.

## Two execution modes

| | Private hosted demonstration | Full local application |
|---|---|---|
| Interface | Patient / clinician dashboard | Same dashboard |
| Record encryption | Browser AES-GCM (WebCrypto; portable fallback) | Node AES-256-GCM, wrapped per-version keys |
| Consent | Simulated in browser state | Actual Solidity contract on a local Ganache EVM |
| Signatures | Real wallet and typed-data signatures using demo keys | Real wallet and typed-data signatures using demo keys |
| Persistence | This browser's storage | Local SQLite, encrypted files and local chain state |
| Authentication boundary | No isolation from the browser's owner | Signed challenges and short-lived bearer sessions |
| Keys | Demo keys held in the same browser | Demo wallets and master key held by the local application |
| Public network | None | None |

The hosted demonstration does not deploy or execute Solidity. The local application does. Neither mode supports real patient data. Role switching is an explicit demonstration convenience, not a production identity system.

## Start the full application

Requires Node.js **24 or newer** and npm. Extract the ZIP and open a terminal inside `corg-record-vault` before running these commands.

```sh
npm ci
npm run compile
npm run build
npm test
npm start
```

Open the localhost address printed by the server. The server binds to loopback only. The local chain and synthetic accounts are created automatically. No cryptocurrency, wallet extension, RPC subscription, or production secrets are needed.

Local runtime data lives in `.data/`, excluded from source control and distribution. Keep this directory private. Deleting it intentionally resets local records, keys, identities and chain; stop the server first. Never reuse the demo wallets for money or real records.

## Demonstration workflow

1. Open the patient workspace and select a synthetic lab report.
2. Open/decrypt it to inspect the record; this produces an access event.
3. Grant the clinician read and contribution access for 24 hours.
4. Switch to the clinician workspace, open the shared record and submit a signed update.
5. Switch back to the patient workspace. Inspect the new immutable version, author and access activity.
6. Revoke the clinician's grant. New clinician reads and writes are denied.

Revocation cannot erase information already downloaded. Archive suspends access and appends; restoring reactivates unexpired grants unless they have been revoked. Consent is record-wide and covers its history.

## Vendored contract and drift guard

The canonical contract is maintained at [github.com/corgdata/solidity-medical-records](https://github.com/corgdata/solidity-medical-records). `contracts/MedicalRecordsRegistry.sol` is a vendored copy: **never edit its logic in place**. Make and review contract changes in the canonical repository, then deliberately copy the approved source here. The copyright header update in this maintenance release was specifically requested; it changes metadata, not logic.

`npm run check-contract` recompiles with Solidity 0.8.30, optimizer 200 and Paris EVM, then compares the complete deployed bytecode (including metadata) against the committed artifact. It is read-only and exits nonzero on drift. `npm test` runs it before tests; ordinary `npm run compile` also refuses to overwrite a mismatching baseline.

After a reviewed canonical re-sync, explicitly run `npm run compile -- --update-artifact`, then `npm test`, and review/commit the source and artifact together. Do not use this flag to silence unexpected drift. Keep the reviewed canonical commit identifier in the resync commit message.

This is an offline guard against divergence between this bundled source and its committed artifact. It does not fetch the canonical repository or prove the bundle matches its latest HEAD. A coordinated source-and-artifact change still requires review. No upstream commit is claimed for the original bundle because its provenance was not supplied.

## Added in 0.2.1: proof-oriented extensions

- **Tamper-evident audit anchoring.** `POST /api/audit/anchor` computes a Merkle root (keccak256, ordered pairs, odd node promoted) over the patient's not-yet-anchored audit events and stores it in the companion `AuditAnchor` contract; `GET /api/audit/verify?anchorId=` recomputes the root from the stored rows and compares it with the on-chain value, so edits or deletions inside an anchored range fail verification. The vendored registry is untouched; the anchor contract has its own guarded compile pipeline (`scripts/compile-anchor.mjs`).
- **FHIR R4 export.** `GET /api/records/:id/fhir` returns a Bundle: a Patient, a Consent derived from the live chain grant (READ → `access`, WRITE → `use`, grant expiry → provision period end), and one resource per version — FHIR-shaped content embedded as-is, plain text wrapped as a DocumentReference. The mapping is documented as an approximation in `server/fhir.mjs`; the chain grant remains authoritative.
- **Zero-knowledge consent proof (prototype).** `zk/` holds a Groth16 circuit proving that a valid, unexpired grant exists in a grants Merkle tree without revealing which grant or grantee, with a scope-bound nullifier for replay rejection. Standalone prototype with its own build and test suite and a development (not production) trusted setup; see `zk/README.md`.
- **One-command demo.** `docker compose up --build` on Linux (host networking preserves the loopback-only posture; see the compose file for the Docker Desktop caveat). The Docker path was not executed in the environment that produced this release — disclosed in `VALIDATION.md`.

## Project map

- `contracts/MedicalRecordsRegistry.sol`: the deliberately vendored patient-owned Solidity registry.
- `artifacts/MedicalRecordsRegistry.json`: compiled ABI, bytecode and compiler metadata.
- `contracts/AuditAnchor.sol` + `artifacts/AuditAnchor.json`: companion contract storing Merkle roots over audit-log ranges (not the canonical registry; separate guarded pipeline in `scripts/compiler-anchor.mjs` and `scripts/compile-anchor.mjs`).
- `server/`: local EVM, authentication, encrypted persistence, API and audit controls.
- `server/merkle.mjs`: audit-event Merkle tree (leaf hashing, roots, proofs).
- `server/fhir.mjs`: FHIR R4 mapping (Patient, Consent, version resources) behind `GET /api/records/:id/fhir`.
- `zk/`: zero-knowledge consent-proof prototype (circuit, tree mirror, build, tests; own package, own README).
- `Dockerfile`, `docker-compose.yml`: one-command demo packaging.
- `VENDORED.md`: the pinned canonical commit the registry is vendored from.
- `client/`: responsive portal, local API adapter and browser demonstration engine.
- `scripts/compiler.mjs`: shared pinned compiler settings.
- `scripts/check-contract.mjs`: read-only deployed-bytecode comparison.
- `scripts/compile.mjs`: guarded compilation and explicit artifact refresh.
- `scripts/run-tests.mjs`: portable test discovery, explicit environment notes and truthful exit-status summary.
- `scripts/build.mjs`, `scripts/start-local.mjs`: frontend build and real loopback server entrypoint.
- `test/`: contract/application integration, dependency portability, drift rejection and real-process boot smoke tests.
- `test/boot-smoke.test.mjs`: real executable startup, HTTP workflow, shutdown and temporary data cleanup.
- `docs/SECURITY.md`: threat model and development security review.
- `docs/ARCHITECTURE.md`: trust boundaries and integration design.
- `VALIDATION.md`: executed verification and remaining limits.
- `test-results.txt`, `verification/`: final full test output and per-item transcripts.
- `CHANGELOG.md`: every changed file and why.

## Important implementation boundaries

The local gateway sees plaintext during upload and download. Encryption at rest is not end-to-end encryption against the gateway operator. A separate master-key service and external patient/provider wallets are needed for stronger custody boundaries. Browser demo keys and encrypted data share the same origin; encryption demonstrates the protocol but does not protect against someone controlling that browser or injected script.

Wallet signature verification proves control of a key, not professional identity, medical accuracy or consent capacity. Clinician signatures are checked by the gateway and stored with version metadata; the Solidity registry anchors ciphertext integrity and transaction authorship. Direct contract interactions can bypass application-specific validation, so downstream readers must validate the application attestation independently.

The contract contains no PHI, clinical titles, URLs, plaintext hashes or encryption keys. Public-chain use would nevertheless expose wallet relationships and timing. This prototype does not claim anonymous or confidential blockchain metadata.

## Next production engineering milestones

Replace demonstration key custody with external wallets or reviewed smart accounts; put encryption keys in a managed KMS/HSM; provision real storage and a database with backups; integrate provider identity and FHIR validation; implement multi-process transaction coordination and recovery; choose an explicit privacy-preserving deployment model; commission independent contract, application and infrastructure review. Legal/regulatory requirements must be assessed for the actual deployment.

## Known environment notes

Node's built-in SQLite may emit an `ExperimentalWarning`. Ganache may print a missing native µWS module message followed by “Falling back to a NodeJS implementation”; this uses its supported JavaScript fallback and may affect performance. Both are informational when execution continues. `npm test` preserves diagnostics as TAP comments, labels these known notices, and ends with an explicit `TEST RESULT: PASS` or `FAIL` based on the real exit code. No warnings or errors are suppressed. A missing module **without** successful fallback is still a failure.

The lockfile intentionally marks Ganache's Darwin-only `fsevents@2.3.2` as optional. Preserve that classification when regenerating the lockfile and rerun clean Linux `npm ci`; esbuild's platform packages remain present. No dependency versions were changed in this maintenance release.

## Sources

- [Solidity security considerations](https://docs.soliditylang.org/en/latest/security-considerations.html)
- [Ethers signature verification](https://docs.ethers.org/v6/api/hashing/)
- [EIP-712 typed structured data](https://eips.ethereum.org/EIPS/eip-712)
- [Node cryptography documentation](https://nodejs.org/api/crypto.html)

