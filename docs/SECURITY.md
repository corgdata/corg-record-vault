# Security model and development review

Review date: 21 October 2026. This is an engineering review of a synthetic-data prototype, not an independent audit, security certification, or compliance determination. Test results are recorded separately.

## Two deliberately different execution modes

The **local EVM application** runs an actual Solidity registry on a local Ganache chain and uses a Node gateway, SQLite metadata, and an encrypted filesystem vault. It is a single-machine demonstration. Demo wallet private keys are intentionally available to the local browser so the patient and clinician journeys can be exercised without an extension. Any user who can access this application can obtain both identities. They are not separately protected real-world accounts.

The **hosted browser demo** runs a simulated consent registry in the visitor's browser. It does not submit Ethereum transactions or enforce a security boundary between patient and clinician roles. Browser encryption and signatures demonstrate cryptographic operations, but keys and identities share the browser's origin and storage. The hosted page must identify this mode explicitly. Neither mode is suitable for real medical records.

## Trust boundaries

| Component | What it establishes | What it does not establish |
| --- | --- | --- |
| Solidity registry | Wallet-controlled grants, expiration, append authorization, immutable version commitments | Clinical accuracy, human identity, confidentiality of public state |
| Wallet challenge | Possession of the signing key for the challenge context | A medical license or independently verified patient identity |
| Typed update signature | Agreement by a wallet to the bound update fields | Accuracy or legal validity of the clinical assertion |
| Authenticated encryption | Confidentiality and tamper detection while the encryption key remains secret | Protection from a compromised gateway or host holding that key |
| Local audit trail | Application-observed release and mutation history | An independently witnessed, immutable, or complete history of every copy |
| Browser role switch | A convenient way to demonstrate both workflows | Account isolation or access control against the browser's user |

## Required behavior

- Plaintext documents and encryption keys must not enter contract calldata, events, or storage. Commitments must describe ciphertext or high-entropy opaque locators; plaintext hashes can disclose predictable records.
- Challenge signatures must be one-use, short-lived, and context-bound. Authorization decisions must use the authenticated address, not an address supplied in a record-read request.
- Signed updates must bind the chain, registry, record, expected version and content digest. The gateway must recheck current write authorization and version before committing a prepared update.
- Every content release must recheck current read authority. A grant cached before revocation or expiry is insufficient. The gateway must fail closed on unavailable or inconsistent chain state.
- Archived records must deny reads and appends. Restoring an archive reactivates otherwise valid retained grants; permanent revocation is a separate operation.
- A record's previous versions must never be overwritten. A correction is a new attributed version.
- The local service must bind loopback and reject foreign Host and Origin headers. Those checks limit browser-origin attacks; they do not make publicly exposed demo credentials safe to deploy.

## Residual risks and deliberate limits

1. **Demo custody is not authentication between people.** Local demo keys, browser-local keys and role switches are for synthetic evaluation only. A real deployment needs independently controlled wallets or an identity provider and a carefully reviewed account-recovery design.
2. **The host can decrypt local records.** The local master key wraps per-version keys and is stored with restrictive filesystem permissions. The gateway process and a user with host access remain trusted. There is no external KMS, HSM, hardware attestation, split custody or end-to-end confidentiality from the server operator.
3. **Revocation is prospective.** It prevents subsequent cooperating-gateway releases. It cannot retract downloaded plaintext, screenshots, previously disclosed keys, or a response already in flight.
4. **Chain metadata is observable.** Addresses, timestamps, record linkage and commitments may reveal sensitive relationships on a public network. The browser simulation has no public chain; switching to a real public chain changes the privacy model.
5. **Storage and chain commits are separate.** The prototype must not be treated as a distributed transactional storage system. Interrupted commits require reconciliation and backup/restore procedures before production use.
6. **Logs are local evidence, with tamper-evidence once anchored.** SQLite audit rows and browser audit entries can be modified by a sufficiently privileged host or browser user. Since 0.2.1, a patient can anchor a Merkle root over a contiguous range of audit events into the companion AuditAnchor contract (`POST /api/audit/anchor`); edits or deletions inside an anchored range are then detectable by recomputation (`GET /api/audit/verify`). Events not yet anchored remain local evidence only, and the anchoring chain in this prototype is the same local demo chain — this is tamper-evidence for anchored ranges, not an independently operated, regulatory-grade audit service.
7. **No medical or organizational identity proof.** The clinician label is a demo persona. Provider credential verification, patient matching, guardianship, care-team membership and emergency override are not implemented.
8. **No complete records lifecycle.** Retention policies, legal holds, deletion workflows, interoperability validation, malware scanning, disaster recovery, and jurisdiction-specific controls require separate engineering and review.

## Before any real-data deployment

Replace the demo credential flow; isolate identity and key custody; review metadata disclosure; use supported production infrastructure; add durable reconciliation, backup and recovery; independently assess the contract and gateway together; and determine the operational and jurisdictional requirements for the actual institution and data flow. Passing tests validates the exercised paths, not the complete system's security.

## Implemented controls reviewed in this build

- Gateway mutations use the authenticated wallet; owner-only consent changes are enforced again by Solidity.
- Prepared updates are one-use, expire after two minutes, and recheck current permission and the exact prior version before commit. Wrong signer and revoked-writer requests are rejected.
- Ciphertext hashes, locator commitments and authors are checked against the chain; signed updates are also checked against decrypted content and the expected record/version context.
- AES-GCM decryption requires a 16-byte authentication tag. Wrong context, ciphertext and tags fail authentication.
- The UI uses DOM text nodes for record data, removes opened content on role changes, and fails closed if the local API is unavailable.
- Browser encryption uses WebCrypto when available; the portable noble-ciphers AES-GCM implementation supports the HTTP-only internal preview. Both paths are integration-tested. Browser encryption is not protection against the browser owner, who holds the demo keys.

The parallel review agents reached a usage limit. The final integration, fixes and development review were completed by the primary coding agent. No external audit was performed.

## Maintenance verification — 22 October 2026 (UTC)

This maintenance release changes attribution, dependency portability, build/test safeguards and documentation only. The Solidity logic and runtime gateway/cryptography controls are unchanged. A new real-process smoke test exercises loopback startup, hostile Host/Origin rejection, signed authentication, per-record access, signed updates and post-revocation denial. Contract compilation now refuses accidental source/artifact drift before tests. Environment notices are labeled without suppressing diagnostics or overriding test failures. This remains a development review, not an external audit.
