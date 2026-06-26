# Attestations Resources Index (pinned, June 2026)

Every SDK, program, ID, and reference this skill touches, with the version/ID verified this month where possible. Items I could not pin exactly are marked **unverified here** — confirm from source before relying on them. Program IDs especially: re-check against official docs for your exact cluster before deploying — a swapped ID is the most expensive class of bug.

## Solana Attestation Service (SAS) — the core

| Thing | Value | Notes |
|---|---|---|
| Program ID | `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG` | printed for mainnet + devnet in SAS docs — **confirm per cluster** before deploying |
| Model | **Credential (issuer) → Schema (fields) → Attestation (claim about a subject)** | a credential authority defines schemas; attestations are PDAs under (credential, schema, nonce/subject) |
| Status | Live on mainnet since **May 2025** | explicit target use cases: proof-of-humanity, sybil resistance, KYC/compliance attestations, fair launches, governance |

- Site / docs: <https://attest.solana.com/> · <https://attest.solana.com/docs>
- Repo: <https://github.com/solana-foundation/solana-attestation-service>
- Announcement: <https://solana.com/news/solana-attestation-service>
- Build guide (digital credentials, TS): <https://attest.solana.com/docs/guides/ts/how-to-create-digital-credentials>

## TS client — sas-lib / solana-attestation-service-client

| Package | Value | Notes |
|---|---|---|
| `sas-lib` (npm) | the SAS TypeScript client | high-level helpers over the generated client |
| `solana-attestation-service-client` | codama-generated low-level client | instruction builders + account codecs; what `sas-lib` wraps |
| Key fns | `createCredential`, `createSchema`, `createAttestation`, `closeAttestation` (revoke), `fetchAttestation`, `fetchSchema`, `fetchCredential`, `deriveAttestationPda`, `deriveCredentialPda`, `deriveSchemaPda`, `deserializeAttestation` | names per current docs — **pin the exact version**; helper names shift between minors |

- Built on **`@solana/kit`** (not legacy web3.js) — see below.
- Exact published version of `sas-lib` is **unverified here** — pin from npm (`npm view sas-lib version`) and lock it; the client tracks the program and ships breaking changes between minors.

## Solana client — @solana/kit

| Package | Version | Notes |
|---|---|---|
| `@solana/kit` | **6.x** (e.g. 6.10.x) | modern tree-shakable successor to web3.js; `createSolanaRpc`, `address`, codecs, signers — what `sas-lib` and the generated client are built on |

- Repo: <https://github.com/anza-xyz/kit> · Docs: <https://www.solanakit.com/docs>
- Pin the exact minor in `package.json`; kit moves fast and `sas-lib` expects a compatible range.

## Identity issuers / proof-of-personhood

| Source | Role | Notes |
|---|---|---|
| **Civic** | launched SAS issuer for proof-of-personhood credentials | the practical path to *attested-human* without running your own personhood check; exact integration package/flow **unverified here** — confirm from Civic docs |
| Self-issued | you are the credential authority | for app-specific attestations (allowlist, tier, KYC-passed) where *you* are the source of truth — see [issuing.md](issuing.md) |

- Civic: <https://www.civic.com/>
- Proof-of-human composition (which issuer, what schema, how it gates): [proof-of-human.md](proof-of-human.md).

## Cross-ecosystem precedent — EAS + Verax

SAS is Solana's analogue to the EVM attestation stack. Same primitives (schema → attestation → on-chain/off-chain verify), same hard-won lessons (the verifier is the security boundary; an unverified attestation is just data on an account). Useful for design precedent and threat-modeling — **not** API-compatible with SAS.

- **EAS (Ethereum Attestation Service)** — the canonical schema/attestation primitive; on-chain + off-chain attestations, schema registry, revocation. <https://attest.org/> · <https://github.com/ethereum-attestation-service>
- **Verax** — Linea's attestation registry, EAS-aligned; production attestation infra for a major L2. <https://www.ver.ax/> · <https://github.com/Consensys/linea-attestation-registry>
- Takeaway echoed across both and SAS: **catching the issuance is easy; verifying correctly is the hard part** — owner check, schema match, subject binding, revocation, and expiry are the same five footguns in every ecosystem. See [hardened-verifier.md](hardened-verifier.md).

## This skill's own artifacts

- Offline verifier (library + CLI): [`tools/sas-verify/verify.mjs`](../tools/sas-verify/verify.mjs) — `verifyAttestation(att, expected, nowUnix)` + `SAS_PROGRAM_ID`. Zero deps, Node ≥ 18. Models the exact on-chain/off-chain check sequence (owner → credential → schema → subject → revocation → expiry → issuer).
- Verified proof: [`examples/attestation-verify/`](../examples/attestation-verify/) — `verify.test.mjs`, a `node --test` suite asserting the verifier rejects every attack: spoofed owner, wrong credential, wrong schema, subject reuse, revoked, expired, unauthorized issuer; and accepts a valid (incl. non-expiring) attestation. Reproduce: `node --test examples/attestation-verify/`.

## Companion skills

- `../solana-sybil-defense` — funding-graph sybil detection + merkle eligibility export. Combine: eligibility = **graph-clean AND attested-human** ([integration.md](integration.md)).
- `../solana-testing` — LiteSVM / Mollusk, CI harness, fuzzing; test the on-chain verifier gate adversarially ([integration.md](integration.md)).

## Verify before you ship

- **Program ID is environment-specific.** SAS docs print one ID for mainnet+devnet; re-confirm against official docs for your exact cluster before deploying.
- **Pin versions in `package.json`.** `@solana/kit`, `sas-lib`, and `solana-attestation-service-client` all ship breaking changes between minors; lock them and upgrade deliberately.
- **Anything marked "unverified here"** (`sas-lib` exact version, generated-client helper names, Civic integration specifics) must be confirmed from source before relying on it.
- **The verifier is the boundary, not the issuer.** No SDK helper makes an attestation trustworthy — your owner + credential + schema + subject + revocation + expiry checks do. See [rules/attestation-safety.md](../rules/attestation-safety.md).

_Last verified: June 2026_
