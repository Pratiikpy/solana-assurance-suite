# solana-qa-automation-skill

**One release gate over every QA layer — full-stack dApp QA, tested like a human.**

> **Extends**: [solana-dev-skill](https://github.com/solana-foundation/solana-dev-skill). **Delegates program-level testing** to `solana-testing`; owns the full dApp QA pyramid around it. E2E drives a **real Phantom wallet**.

A progressively-loaded skill for Claude Code / Codex that turns any coding agent into a QA engineer who tests a Solana dApp the way a careful human does — and gates the release on the result. Reverse-engineered from two production web3 codebases (an EVM/FHE pnpm monorepo and an Arbitrum/Stylus Rust+Foundry monorepo) and from a battle-tested "autonomous, human-like" web3 testing methodology, mapped onto the Solana stack.

## The problem

Most teams have *some* tests; almost none have a **release gate** — a single automated verdict that ships only when every layer is green, and that refuses to ship on a *skipped* layer. And almost nobody tests like a real user: connecting a **real wallet**, reading the approval popup before signing, following one value from the UI to the chain and back. The Solana AI Kit's `solana-testing` proves a *program* is correct; generic CI skills run arbitrary steps. Neither owns the full-stack dApp release gate. This does.

## What's included

| Component | Contents |
|-----------|----------|
| **Tool** (`tools/qa-gate`) | Zero-dep release-gate runner: ingests a per-layer results manifest → one BLOCK/PASS verdict + a publishable QA report. **Verified runnable.** |
| **Skill** (`skill/`) | `SKILL.md` router + 13 references: **human-level-qa** (the methodology), model, static-lint, unit-property, formal, integration-indexer, **e2e-realwallet (Phantom)**, load-perf, lighthouse-a11y, security-secrets, uptime-keeper, release-gate, ci-wiring |
| **Agents** (`agents/`) | **qa-orchestrator** (runs the human-level act→audit loop against a real Phantom wallet, builds the manifest), **release-gatekeeper** (the go/no-go owner) |
| **Commands** (`commands/`) | `/qa-gate`, `/scaffold-e2e` (Phantom + Synpress skeleton), `/setup-ci-qa` |
| **Rules** (`rules/`) | `release-gate.rules.md` — fail OR skip blocks; evidence-or-it-didn't-happen |
| **Example** (`examples/release-gate`) | Green vs regressed manifest; gate **blocks on 5 distinct regressions, passes when green (6/6 tests)** |

## The model — full-stack web3 QA pyramid

L0 static/lint → L1 unit/property + **formal (Kani)** → L2 integration + indexer → **L3 e2e against a real Phantom wallet** → L4 load (k6) + compute → L5 Lighthouse perf/a11y → L6 security (gitleaks + base58/`id.json` backstop) → L7 uptime/keeper monitoring → **the release gate** rolls them all up. Program-runtime layers delegate to `solana-testing`. Full table with the chain-agnostic↔Solana mapping: `skill/model.md`.

## Human-level QA, with a real Phantom wallet

The `qa-orchestrator` agent and `skill/human-level-qa.md` encode an autonomous, maximal, human-like methodology:
- **Act → capture → audit → decide** — screenshot every step and *actually read it*; never chain actions blind.
- **Verify the Phantom popup before approving** — assert the cluster/program/instruction/accounts/amounts match what the UI promised (no blind-signing).
- **Follow one value across every surface** — UI ↔ counterparty UI ↔ Solscan ↔ RPC read must agree.
- **Real path only** — real browser, real Phantom extension (via **Synpress v4.1+**, the Phantom-capable tool — not dappwright, which is EVM-only), real cluster.
- **Evidence or it didn't happen** — a pass needs a **finalized signature** + an audited screenshot + the on-chain read, re-verified on an alternate RPC.
- **LAUNCH-READY gate** — a full checklist; any unmet item = NOT launch-ready, named explicitly.

## Verified proof

```bash
cd examples/release-gate && node --test    # 6/6 pass
```
```
GREEN   manifest → RELEASE ALLOWED (exit 0)
BLOCKED manifest → RELEASE BLOCKED (exit 1):
  🔴 e2e (status=fail)  🔴 formal (skipped = untested)  🔴 coverage 0.74<0.80
  🔴 lighthouse 0.81<0.90  🔴 load-p95 640ms>500ms   ⚠️ uptime 99.4<99.9 (non-blocking)
```
A skipped required layer blocks just like a failure — you can't ship what you didn't test. Full output in [EVAL_REPORT.md](EVAL_REPORT.md).

## Installation

```bash
./install.sh          # ~/.claude/skills, clones core skill if missing
./install-custom.sh   # choose location; optionally install companion solana-testing
```

## License

MIT — see [LICENSE](LICENSE). Built for the [Solana AI Kit](https://github.com/solanabr/solana-ai-kit) bounty. QA patterns extracted from two real web3 codebases.
