# Sybil-Defense Resources Index (pinned, June 2026)

Every tool, SDK, program, and reference this skill touches, with the version/ID verified this month where possible. Items I could not pin exactly are marked **unverified here** — confirm from source before relying on them. Program IDs especially: re-check against official docs for your exact cluster before deploying.

## Data sources — Helius

| Thing | Value | Notes |
|---|---|---|
| RPC / DAS endpoint | `https://mainnet.helius-rpc.com/?api-key=KEY` | devnet: `devnet.helius-rpc.com` |
| `helius-sdk` (npm) | **v2.2.x** | namespaces: `helius.rpc`, `helius.enhanced`, `helius.webhooks` |
| DAS method | `getAssetsByOwner` | candidate set / holdings; `displayOptions.showFungible` |
| Enhanced Txns | `getTransactionsByAddress` | decoded `nativeTransfers`/`tokenTransfers` → funding edge + fingerprint |
| Webhooks | `createWebhook` | live monitoring on the distributor address |

- **Credit costs (June 2026):** Standard RPC = 1, DAS = 10, Enhanced Txns = 100, Webhooks = 1/event; overage **$5/million**. The deep funding trace dominates cost — cache the (immutable) funding edge forever. See [data-sources.md](data-sources.md).
- Docs: <https://www.helius.dev/docs/das-api> · SDK: <https://github.com/helius-labs/helius-sdk> (<https://helius-labs.github.io/helius-sdk/>)
- Overview/pricing: <https://chainstack.com/helius-rpc-provider-a-practical-overview/>

## Solana client — @solana/kit

| Package | Version | Notes |
|---|---|---|
| `@solana/kit` | **6.10.0** | modern tree-shakable successor to web3.js; `createSolanaRpc`, `getSignaturesForAddress`, `getTransaction` |
| `@noble/hashes` | 1.x | `keccak_256` for merkle leaf hashing (match the distributor's hasher) |

- Repo: <https://github.com/anza-xyz/kit> · Docs: <https://www.solanakit.com/docs>
- Raw RPC reference (pagination, `maxSupportedTransactionVersion`): <https://solana.com/docs/rpc/http/getsignaturesforaddress> · <https://solana.com/docs/rpc/http/gettransaction>
- `getTransaction` **requires** `maxSupportedTransactionVersion: 0` or v0 txs error. `getSignaturesForAddress` is newest-first; paginate with `before`/`until`.

## Merkle distributors (token distribution)

| Repo / package | What | ID / version |
|---|---|---|
| **jito-foundation/distributor** | `merkle-distributor` program (unlocked + linear-vested) | program ID `mERKcfxMC5SqJn4Ld4BUris3WKZZ1ojjWJ3A3J5CKxv` |
| `@streamflow/distributor` (npm) | Streamflow's merkle distributor client | version **unverified here** — pin from npm |
| ProjectOpenSea/merkle-distributor-svm | fork of jito distributor | — |
| saber-hq/merkle-distributor | older Solana merkle distributor | legacy; reference only |

- Jito: <https://github.com/jito-foundation/distributor> (CLI: `new-distributor`, `claim --merkle-tree-path merkle_tree.json`)
- Streamflow: <https://github.com/streamflow-finance> · platform <https://streamflow.finance/> · airdrops up to ~1M recipients, audited (FYEO/OPCODES) — claims per their site, **unverified here**
- ProjectOpenSea: <https://github.com/ProjectOpenSea/merkle-distributor-svm>
- Distribution playbook: <https://streamflow.finance/blog/how-to-do-a-solana-airdrop>
- **Generate the tree with the program's own CLI/SDK** so the leaf encoding matches the on-chain verifier. See [eligibility-export.md](eligibility-export.md).

## Known-CEX / address-label sources

The engine's `cex` signal needs labelled funders; CEX-funded ≠ sybil, so accurate labels prevent the dominant false-positive class. Pull, then **pin a local snapshot** so verdicts don't drift between runs.

| Source | Access | Notes |
|---|---|---|
| Solscan labels | web + API | public address labels (exchanges, programs); partial coverage |
| Helius address labels | RPC/SDK | programmatic; coverage partial |
| Arkham / Nansen | licensed | richest entity labels; commercial |
| Self-backfilled | derived | any funder fanning out to many *diverse* wallets ≈ custodian → promote to allowlist |

- Solscan: <https://solscan.io/> · A funder that the [planted-cluster proof](../examples/planted-cluster/) models as `CEX_HOT_WALLET` (40 diverse legit users) must **not** be flagged — labels are what keep it out of the deny set. See [data-sources.md](data-sources.md).

## Proof-of-humanity — Solana Attestation Service (SAS)

| Thing | Value |
|---|---|
| Program ID | `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG` (mainnet + devnet per docs — confirm per cluster) |
| TS client (npm) | `sas-lib` |
| Key fns | `createCredential`, `createSchema`, `createAttestation`, `fetchAttestation`, `deriveAttestationPda`, `deserializeAttestation`, `fetchSchema` |
| Components | Credential (issuer) → Schema (fields) → Attestation (claim about a wallet) |

- Live on mainnet (launched May 2025). Explicit use case: **sybil resistance / proof-of-humanity for airdrops, governance, fair launches.**
- Site/docs: <https://attest.solana.com/> · <https://attest.solana.com/docs> · Repo: <https://github.com/solana-foundation/solana-attestation-service>
- Announcement: <https://solana.com/news/solana-attestation-service>
- Guide (build credentials): <https://attest.solana.com/docs/guides/ts/how-to-create-digital-credentials>
- **Civic** is a launched SAS issuer for proof-of-personhood credentials: <https://www.civic.com/> — exact integration package/flow **unverified here**.
- Companion skill: `../solana-attestations` (issuing + on-chain verification of the credential). Wiring into the claim gate: [integration.md](integration.md).

## Sybil-analysis references (cross-ecosystem precedent)

- **Trusta.AI / TrustScan** — on-chain ML sybil scoring; the canonical methodology this engine's multi-signal design echoes. Published **two-phase** approach: (1) graph mining to find coordinated communities (star-like / chain-like transfer graphs, bulk operations, similar behavior sequences), (2) behavioral refinement to *reduce false positives*. Integrated into Gitcoin Passport and Galxe Web3 Score; used by Celestia, Starknet, Manta, Sonic, Plume.
  - Framework repo: <https://github.com/TrustaLabs/Airdrop-Sybil-Identification>
  - TrustScan: <https://www.trustalabs.ai/trustscan> · Docs: <https://trusta-labs.gitbook.io/trustalabs/trustscan/q-and-a-for-sybil-score>
  - Method writeup: <https://medium.com/@trustalabs.ai/trustas-ai-and-machine-learning-framework-for-robust-sybil-resistance-in-airdrops-ba17059ec5b7>
- **Gitcoin Passport / Human Passport** — stamp-based proof-of-personhood scoring; added Trusta's TrustScan score before GG18. Cross-ecosystem precedent for *layering* identity signals (the same logic as [integration.md](integration.md)'s two gates). Product naming has shifted toward "Human Passport" — **unverified here**, confirm current branding/API.
  - Checker: <https://checker.gitcoin.co/>
- Takeaway echoed across all three: catching clusters is easy; **not punishing real users is the hard part**, and it's won by requiring multiple corroborating signals — exactly what this skill's [scoring-and-thresholds.md](scoring-and-thresholds.md) enforces.

## This skill's own artifacts

- Engine (library + CLI): [`tools/sybil-scan/sybil-scan.mjs`](../tools/sybil-scan/sybil-scan.mjs) — `scan()`, `eligibility(keepRepresentative)`. Zero deps, Node ≥ 18.
- Verified proof: [`examples/planted-cluster/`](../examples/planted-cluster/) — `generate.mjs` (seeded synthetic dataset, known labels), `verify.mjs` (CI gate). Reproduce: `node generate.mjs && node verify.mjs`.
  - Result: **precision 1.000, recall 0.985, f1 0.992** (TP=64 FP=0 FN=1 TN=240). Catches the 3 single-funder farms *and* the 4-wallet fresh-funder cohort (cross-funder behavioral-cohort signal). Naive same-funder baseline would false-flag 40 legit CEX-funded wallets; multi-signal FP=0.
  - 1 FN = a truly-lone evader (unique funder, unique behavior, spread timing — shares nothing, so no cluster or cohort to find) — the honest recall ceiling of funding-graph analysis. Covered by layering proof-of-humanity.

## Companion skills

- `../solana-attestations` — SAS proof-of-human credential issuance + verification (the second eligibility gate).
- `../solana-testing` — LiteSVM/Mollusk, CI harness, fuzzing; test the claim gate ([integration.md](integration.md)).

## Verify before you ship

- **Program IDs are environment-specific.** SAS docs print one ID for mainnet+devnet; the jito distributor ID is mainnet. Re-confirm against official docs for your exact cluster before deploying — a swapped ID is the most expensive class of bug.
- **Pin versions in `package.json`.** `@solana/kit`, `helius-sdk`, `sas-lib`, and the distributor client all ship breaking changes between minors.
- **Anything marked "unverified here"** (`@streamflow/distributor` version, Streamflow scale claims, Civic integration specifics, Human Passport branding/API) must be confirmed from source before relying on it.

_Last verified: June 2026_
