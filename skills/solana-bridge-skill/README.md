# solana-bridge-skill

**Cross-chain on Solana — without getting drained.**

> **Extends**: [solana-dev-skill](https://github.com/solana-foundation/solana-dev-skill). Pairs with `solana-testing-skill` for testing the integration.

A progressively-loaded skill for Claude Code / Codex that makes any coding agent pick the **right** bridge for the goal and wire the verification that stops the drain. Covers the full 2026 cross-chain stack and the security lessons from the bridges that got hacked.

## The problem

Bridges are the most-exploited primitive in crypto — Ronin ($625M), Wormhole ($325M), Nomad ($190M). Yet almost every Solana builder needs one: move USDC in, make a token multichain, accept a cross-chain message. The choice (CCTP vs NTT vs messaging vs an intent bridge) is non-obvious, the SDKs churn, and the safety checks — attestation verification, replay protection, finality-before-mint, emitter allowlisting, decimal normalization — are exactly what the hacked bridges skipped. There's no skill in the kit for any of it.

## What's included

| Component | Contents |
|-----------|----------|
| **Skill** (`skill/`) | `SKILL.md` router + 9 reference files: bridge-landscape (decision tree), CCTP v2, Wormhole NTT, messaging/VAAs, deBridge DLN, integration patterns, **bridge-security**, testing-bridges, resources |
| **Agents** (`agents/`) | `bridge-engineer` (choose + integrate), `bridge-security-reviewer` (audit against the hack failure modes) |
| **Commands** (`commands/`) | `/add-bridge`, `/bridge-security-check`, `/quote-bridge` |
| **Rules** (`rules/`) | `bridge-safety.md` — auto-loaded cross-chain safety constraints |
| **Examples** (`examples/`) | `bridge-guards` — runnable verification logic (emitter allowlist, replay guard, decimal normalization), **6/6 tests passing** |

## Pick the right bridge (the decision tree)

| Goal | Use | Why |
|------|-----|-----|
| Move native **USDC** | **Circle CCTP v2** | Burn/mint, no wrapped asset, issuer-native. Solana = domain 5. |
| Make **your SPL token** multichain | **Wormhole NTT** | Canonical token, rate-limited, pausable. |
| Send an arbitrary **message** | **Wormhole core / VAAs** | Cross-chain governance, state sync. |
| **Swap** asset A→B across chains | **deBridge DLN** | Intent/solver, market rate, no wrapped asset. |

## Installation

```bash
./install.sh          # installs to ~/.claude/skills, clones core skill if missing
./install-custom.sh   # choose location; optionally install companion solana-testing
```

## Stack (June 2026)

| Piece | Version / value |
|------|-----------------|
| `@wormhole-foundation/sdk` | 6.1.x |
| `@wormhole-foundation/sdk-*-ntt` | 7.2.x |
| CCTP v2 on Solana | live; domain `5`; Iris attestation API |
| deBridge DLN | REST `dln.debridge.finance` |
| `@solana/kit` | 6.x (app-side; Wormhole SDK still wraps web3.js 1.x internally) |

> Program IDs, domains, and versions differ by cluster and drift over time. `skill/resources.md` pins June-2026 values; **confirm from official docs before mainnet.**

## Security is the point

`skill/bridge-security.md` maps each real hack to the check that would have stopped it, and `examples/bridge-guards` makes those checks runnable code:

- **Replay guard** — Nomad replayed a trusted message ($190M). One-time message consumption.
- **Emitter allowlist** — consume only from known (chain, emitter) pairs.
- **Decimal normalization** — 9-dp NTT wire ↔ 6-dp USDC; a silent mismatch mis-credits by 1000×.
- **Finality gate** — never mint before the source reached required finality.

```bash
cd examples/bridge-guards && node --test   # 6/6 pass
```

## Repository structure

```
solana-bridge-skill/
├── skill/        SKILL.md + bridge-landscape, cctp, wormhole-ntt, messaging,
│                 debridge, integration-patterns, bridge-security, testing-bridges, resources
├── agents/       bridge-engineer.md, bridge-security-reviewer.md
├── commands/     add-bridge.md, bridge-security-check.md, quote-bridge.md
├── rules/        bridge-safety.md
├── examples/     bridge-guards/ (runnable, 6/6 tests pass)
├── install.sh    install-custom.sh
└── README.md     LICENSE (MIT)
```

## License

MIT — see [LICENSE](LICENSE). Built for the [Solana AI Kit](https://github.com/solanabr/solana-ai-kit) bounty.
