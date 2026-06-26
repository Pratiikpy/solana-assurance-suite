---
description: Pick the right bridge for the user's goal (decision tree from bridge-landscape.md), scaffold the transfer integration module (Wormhole SDK / CCTP / deBridge) with attestation polling + retries, and stub the security checks. Outputs the module plus the failure tests to write.
argument-hint: "[goal, e.g. \"bridge USDC Solana->Base\" or \"make MYTOKEN canonical on Arbitrum\"]"
---

# /add-bridge

Add a cross-chain transfer to the project for the goal in `$ARGUMENTS`. Use the `bridge-engineer` conventions and the stack pinned across the skill references.

## 1. Route — pick the job, not the brand
Run the goal through the decision tree in [bridge-landscape.md](../skill/bridge-landscape.md) and state the pick in one line with the reason:

- **Native USDC / EURC across chains** → **Circle CCTP** (burn-and-mint, issuer-native; Solana domain `5`). [cctp.md](../skill/cctp.md)
- **Your own SPL token, kept canonical everywhere** → **Wormhole NTT** (you own mint authority + rate limits + pause). [wormhole-ntt.md](../skill/wormhole-ntt.md)
- **An arbitrary payload / cross-chain call / governance** (a *message*, not a registered asset) → **generic messaging** (Wormhole Core + VAAs). [messaging.md](../skill/messaging.md)
- **Best-price swap-and-bridge across an asset pair you don't control** → **deBridge DLN** (intent/solver, 0-TVL). [debridge.md](../skill/debridge.md)

Do **not** scaffold a classic lock-and-mint wrapped bridge — if that's what was asked, route to the issuer-native rail and say why.

## 2. Scaffold the transfer module with the full lifecycle
Generate a transfer module that implements **initiate → attestation/VAA → redeem** with recovery (see [integration-patterns.md](../skill/integration-patterns.md)):

- **Persist the source txid / burn tx first** — it is the idempotency key. On restart, rehydrate (`TokenTransfer.from(...)` for Wormhole, re-poll Iris by source tx hash for CCTP, re-query the DLN order id for deBridge) instead of re-initiating.
- **Attestation polling with backoff + jitter**, retrying only transient errors (not-yet-available / 429 / 503 / timeout); cap total wait and expose a "pending — resume later" state.
- **Redeem gated on a completed-check** (`isTransferCompleted` / used-nonce PDA) — never rely on the on-chain revert as the guard.

Stack to emit (June 2026):
- Wormhole token/NTT: `@wormhole-foundation/sdk@6.1.0` + (for NTT) `@wormhole-foundation/sdk-{solana,evm}-ntt@7.2.0` and route `@wormhole-foundation/sdk-route-ntt@7.2.0` — keep the side-effecting NTT import (it registers the protocol). App side `@solana/kit` 6.x, but the SDK still wraps **web3.js 1.x** internally: sign via `getSolanaSignAndSendSigner` with the 64-byte secret / base58 key; don't pass a kit `TransactionSendingSigner` through it.
- CCTP: **v2 programs** (`…V2…`), Iris API (`iris-api.circle.com`); poll until `status: "complete"`, respect ~35 req/s. `mintRecipient` is always 32 bytes (EVM left-padded; Solana pubkey raw).
- deBridge: `GET https://dln.debridge.finance/v1.0/dln/order/create-tx`; for a Solana source `tx.data` is a **base64 serialized Solana transaction**. Read `estimation` and enforce a minimum before signing.

## 3. Stub the security checks inline
Mark each with a `// SECURITY:` comment wired into the code path (per [bridge-security.md](../skill/bridge-security.md)):
- attestation/VAA verified against the **expected** signer set, read from **identity-checked** accounts (Wormhole-2022 root cause);
- **replay**: consumed-message PDA / used-nonce — same attestation never acts twice;
- **finality** before mint (note Fast V2 = Circle fronts soft-finality risk);
- **emitter / peer allowlist** enforced; registration owner-gated;
- in-payload **sender + recipient** validated;
- **decimals** explicit: NTT 9-dp wire (trims), CCTP USDC 6-dp, EVM often 18 — round-trip conserves value;
- (NTT) **rate limits + pause** set and the pause/owner authority access-controlled.

## 4. Never hardcode unverified IDs/domains/addresses
Program IDs, CCTP domains, NTT manager/transceiver addresses, and the deBridge internal chain ids (Solana = `7565164`) come from official sources at integration time (Circle `solana-cctp-contracts` IDL, your `deployment.json`, the live API response, the pinned Core Contract address). Any constant you write gets a source comment and a flag for the user to confirm.

## 5. Report
List the module file(s) written (absolute paths), the bridge chosen and why, the idempotency key, the security checks stubbed vs enforced, and the failure tests to write next (hand off to `/bridge-security-check` and [testing-bridges.md](../skill/testing-bridges.md)). Do **not** claim the transfer works — it isn't proven until a quote/devnet run is executed and pasted.
