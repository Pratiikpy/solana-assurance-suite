# Bridge Resources Index (pinned, June 2026)

Every tool, SDK, program, and doc a Solana bridge integration touches, with the version and link verified this month. **Verify before you ship** (see the note at the bottom — this is not optional for program IDs).

## Wormhole — TypeScript SDK

| Package | Version | Notes |
|---|---|---|
| `@wormhole-foundation/sdk` | **6.1.0** | Meta-package; lazily loads platforms/protocols. Start here. |
| `@wormhole-foundation/sdk-connect` | 6.1.0 | Orchestration (`Wormhole`, `routes`); re-exported by the meta-package. |
| `@wormhole-foundation/sdk-solana` | 6.1.0 | Solana platform. **Internally depends on `@solana/web3.js@^1.95.8`, not `@solana/kit`** — bridge at the boundary (see [integration-patterns.md](integration-patterns.md)). |
| `@wormhole-foundation/sdk-solana-core` | 3.4.x | Core Bridge (VAA verification) client. Version line diverges from the meta-package. |
| `@wormhole-foundation/sdk-solana-tokenbridge` | (matches solana-core line) | Wrapped Token Transfers on Solana. |
| `@wormhole-foundation/sdk-solana-cctp` | 3.4.x | CCTP via Wormhole on Solana. |
| `@wormhole-foundation/sdk-solana-ntt` | **7.2.0** | NTT manager/transceiver client for Solana. Versioned independently. |

- Repo: <https://github.com/wormhole-foundation/wormhole-sdk-ts> (release 6.1.0, 2026-06-24)
- API docs (latest): <https://wormhole-foundation.github.io/wormhole-sdk-ts/>
- Product docs: <https://wormhole.com/docs/>
- Portal Bridge (UI): <https://portalbridge.com/>
- WormholeScan (explorer/VAA lookup): <https://wormholescan.io/>

> The `sdk-solana-*` protocol packages and `sdk-solana-ntt` are on **separate version lines** from the 6.1.0 meta-package. Don't assume they share a number — pin each from npm.

## Wormhole — NTT (Native Token Transfers)

- `ntt` CLI — install: `curl -fsSL https://raw.githubusercontent.com/wormhole-foundation/native-token-transfers/main/cli/install.sh | bash` (requires **Bun ≥ 1.2.23** on PATH). Installer pulls the latest `vX.Y.Z+cli` tag verified against `main`.
- Versions `>= v2.0.0+solana` support SPL tokens with transfer hooks. Exact `+cli` tag is **unverified here** — run `ntt --version` after install.
- Core commands: `ntt new <path>`, `ntt init <network>`, `ntt add-chain <chain>`, `ntt push`, `ntt pull`, `ntt status`.
- Repo: <https://github.com/wormhole-foundation/native-token-transfers> · Docs: <https://wormhole.com/docs/products/token-transfers/native-token-transfers/>
- Integration guide: [wormhole-ntt.md](wormhole-ntt.md)

## Circle CCTP

CCTP **V2** is the current generation; Solana V2 shipped Oct 2025 (first non-EVM V2 deployment). Integration guide: [cctp.md](cctp.md).

**Solana program IDs (V2)** — *identical string shown for mainnet and devnet in Circle's docs; confirm per-cluster before use:*

| Program | Program ID |
|---|---|
| `MessageTransmitterV2` | `CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC` |
| `TokenMessengerMinterV2` | `CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe` |

`TokenMessengerMinterV2` combines the EVM `TokenMessengerV2` + `TokenMinterV2` roles. V1 Solana program IDs differ and are **not listed here** — pull from Circle docs if you must support V1.

**Iris attestation API:**
- Mainnet: `https://iris-api.circle.com`
- Sandbox (testnet): `https://iris-api-sandbox.circle.com`
- V2 messages/attestations: `GET /v2/messages/{sourceDomainId}?transactionHash=…` (or by nonce)
- V2 re-attest (raise finality): `POST /v2/reattest/{nonce}`
- V1 attestation: `GET /v1/attestations/{messageHash}` (keccak256 of the `MessageSent` bytes)

**CCTP domain IDs** (chain ≠ domain; do not confuse with Wormhole chain IDs):

| Chain | Domain | Chain | Domain |
|---|---|---|---|
| Ethereum | 0 | Noble | 4 |
| Avalanche | 1 | Solana | 5 |
| Optimism | 2 | Base | 6 |
| Arbitrum | 3 | Polygon PoS | 7 |

- Docs: <https://developers.circle.com/cctp> · Solana programs: <https://developers.circle.com/cctp/references/solana-programs> · Supported chains/domains: <https://developers.circle.com/cctp/cctp-supported-blockchains>
- Solana contracts repo: <https://github.com/circlefin/solana-cctp-contracts>
- Get-attestation API: <https://developers.circle.com/api-reference/cctp/all/get-attestation>

## deBridge (DLN)

Intent-based cross-chain swaps; integrate via the **REST API** (recommended) rather than the on-chain client. Guide: [debridge.md](debridge.md).

- DLN API base: `https://dln.debridge.finance/v1.0`
  - Create order tx: `GET /dln/order/create-tx` (params: `srcChainId`, `srcChainTokenIn`, `srcChainTokenInAmount`, `dstChainId`, `dstChainTokenOut`, `dstChainTokenOutAmount`, `dstChainTokenOutRecipient`, `srcChainOrderAuthorityAddress`, `dstChainOrderAuthorityAddress`). `tx` is withheld unless recipient + both authorities are supplied.
  - **Solana caveat:** for orders originating on Solana, `tx` has a single `data` field = hex-encoded `VersionedTransaction`. Set priority fees yourself based on network load.
  - Track status: `GET /dln/order/{id}/status`.
- `@debridge-finance/dln-client` (on-chain client): **17.6.2** on npm. Prefer the REST API for most integrations; the client is heavier and lower-level.
- Docs: <https://docs.debridge.finance/> · Develop hub: <https://debridge.finance/develop> · GitHub: <https://github.com/debridge-finance>
- deBridge chain IDs are bespoke (Solana uses a large sentinel value, **not** 101/CCTP-5) — read the API params doc; **unverified here**, confirm from docs.

## Chain-ID cheat sheet (do not cross the namespaces)

Three independent ID systems are in play; mixing them is a top integration bug.

| Chain | Wormhole chain ID | CCTP domain | EVM chain ID |
|---|---|---|---|
| Solana | 1 | 5 | n/a |
| Ethereum | 2 | 0 | 1 |
| Base | 30 | 6 | 8453 |
| Arbitrum | 23 | 3 | 42161 |
| Optimism | 24 | 2 | 10 |
| Avalanche | 6 | 1 | 43114 |

Wormhole chain IDs above are the long-standing canonical values; **re-confirm from `@wormhole-foundation/sdk-base` constants** before hardcoding — treat as unverified here. CCTP domains are from Circle docs (verified). deBridge uses yet another scheme (see deBridge section).

## Solana client (transaction layer)

| Package | Version | Notes |
|---|---|---|
| `@solana/kit` | **6.10.0** | Modern, tree-shakable successor to web3.js (formerly "web3.js 2.x"). Peer: `typescript >= 5.4`. Use for your own instruction building. |
| `@solana/web3.js` | 1.95.x | Legacy 1.x line. Still what `sdk-solana` emits internally — see boundary note in [integration-patterns.md](integration-patterns.md). |
| `@solana/web3-compat` | — | Bridge layer for incremental kit migration of existing web3.js apps. |

- Kit repo: <https://github.com/anza-xyz/kit> · Docs: <https://www.solanakit.com/docs>

## Testing

- **Surfpool** (mainnet-fork test validator, drop-in for `solana-test-validator`): <https://docs.surfpool.run/> · <https://github.com/txtx/surfpool> — `surfpool start`; `surfnet_setAccount` and time-travel cheat RPCs.
- **LiteSVM** (in-process VM) and the full testing methodology: companion testing skill — [LiteSVM integration](../solana-testing/litesvm-integration.md), [bug-class playbook](../solana-testing/bug-class-playbook.md), [CI harness](../solana-testing/ci-harness.md).
- Bridge-specific testing strategy across all four tiers: [testing-bridges.md](testing-bridges.md).
- Solana faucet: <https://faucet.solana.com> (2026: web UI blocks agents → use `solana airdrop` / PoW faucet / local validator in automation).

## Verify before you ship

- **Program IDs are environment-specific.** Circle's docs currently print the same V2 string for mainnet and devnet — do not assume that holds for V1, for other clusters, or after a redeploy. Re-confirm every program ID against the **official docs for your exact network** immediately before deploying. A swapped testnet/mainnet ID is the most common (and most expensive) bridge bug.
- **Pin versions in `package.json`.** Bridge SDKs ship breaking changes between minors; the meta-package and the `sdk-solana-*` protocol packages move on different cadences.
- **Anything marked "unverified here"** (exact `ntt +cli` tag, deBridge Solana chain ID, V1 Solana CCTP IDs) must be confirmed from source before relying on it.

_Last verified: June 2026_
