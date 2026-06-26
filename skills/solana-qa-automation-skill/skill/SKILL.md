---
name: solana-qa-automation
description: Full-stack dApp QA release-gating for web3 — the layer above program testing. Captures, from two production web3 codebases, the complete automated QA pyramid: static/lint gates, frontend + contract unit/property tests, Kani formal verification with an anti-erosion baseline, localnet integration, real-wallet Playwright e2e (local-pending vs live-receipt), k6 load, Lighthouse perf/a11y, gitleaks + base58 secret scanning, RPC/keeper uptime monitoring — all rolled up by a runnable release gate into one evidence-backed BLOCK/PASS verdict that refuses to ship on a failed OR skipped required layer. Extends solana-dev-skill; delegates program-level correctness to solana-testing and owns everything around it.
user-invocable: true
---

# Solana QA Automation — One Release Gate Over Every Layer

> **Extends**: [solana-dev-skill](../solana-dev/SKILL.md). **Delegates program-level testing** (Mollusk/LiteSVM/fuzz/invariants/coverage) to [solana-testing](../solana-testing/SKILL.md) — this skill owns the **full-stack dApp QA pyramid around it** and the release gate that rolls everything up.

Most teams have *some* tests. Almost none have a **release gate**: a single automated verdict that says "this build is safe to ship" only when every layer — program tests, formal proofs, e2e against a real wallet, load, accessibility, secret-scanning, uptime — is actually green, and that **refuses to ship on a skipped layer** (you can't ship what you didn't test). This skill encodes that, reverse-engineered from two production web3 codebases (an EVM/FHE pnpm monorepo and an Arbitrum/Stylus Rust+Foundry monorepo) and mapped onto the Solana stack.

> **The defining artifact** is `tools/qa-gate/` — a zero-dependency runner that ingests a per-layer results manifest and returns one BLOCK/PASS verdict + a publishable QA report. Verified: blocks on a regression (failed e2e, skipped formal, sub-floor coverage/lighthouse, over-budget load), passes when green. See [release-gate.md](release-gate.md) and [EVAL_REPORT.md](../EVAL_REPORT.md).

## The model — the real full-stack web3 QA pyramid

Each layer is automated in CI and contributes one entry to the release manifest. Program-runtime layers delegate to `solana-testing`; the rest this skill owns.

| Layer | Tools (real) | Gates release when | Skill file |
|-------|--------------|--------------------|------------|
| L0 Static/lint/type | `cargo fmt`, `clippy -D warnings`, `tsc`, ESLint, banned-words | any warning/diff/lint error | [static-lint.md](static-lint.md) |
| L1 Unit + property | Vitest; `cargo test` + `proptest`; (program: Mollusk/LiteSVM via solana-testing) | test fail | [unit-property.md](unit-property.md) |
| L1 Formal | **Kani** model-checking + baseline harness-count gate | counterexample, or proof count drops below baseline | [formal.md](formal.md) |
| L2 Integration + indexer | localnet/surfpool, Ed25519 signing; indexer guard scripts | suite fail / drift | [integration-indexer.md](integration-indexer.md) |
| L3 E2E (real wallet) | **Playwright + Synpress 4.1+ (real Phantom extension)**, local-pending vs live finalized-sig | flow fail; live mode asserts a finalized tx signature | [e2e-realwallet.md](e2e-realwallet.md) |
| L4 Load + compute | **k6** thresholds (p95, error-rate); CU/rent budget probe | k6 threshold breach | [load-perf.md](load-perf.md) |
| L5 Perf/a11y | `@lhci/cli` Lighthouse, minScore 0.90 | below 0.90 (soft-gate→harden) | [lighthouse-a11y.md](lighthouse-a11y.md) |
| L6 Security/secrets | **gitleaks** + base58/`id.json` backstop, `cargo-audit` | any finding | [security-secrets.md](security-secrets.md) |
| L7 Uptime/keeper | **Upptime** (RPC `getHealth`/slot-lag), self-looping keepers | observability (alerts, not a PR gate) | [uptime-keeper.md](uptime-keeper.md) |
| **GATE** | `qa-gate.mjs` roll-up + evidence rule | any required layer fail **or skip** | [release-gate.md](release-gate.md) |

Full table with the chain-agnostic↔Solana mapping for every layer: [model.md](model.md). CI wiring (SHA-pinned actions, `permissions:{}`, CI-as-data): [ci-wiring.md](ci-wiring.md).

## Cross-cutting principles (from the real codebases)

1. **A skipped required layer is a gap, not a pass.** The gate blocks on `skip` just like `fail`.
2. **Evidence-or-it-didn't-happen.** Every claimed pass carries a real on-chain signature (finalized, `status=1`) + a screenshot + the ground-truth read. A green badge with no CI run behind it is treated as RED.
3. **Honest-pending as a first-class state** — surfaces return `pending`/`null`, never fake-zero.
4. **Anti-erosion baselines** — coverage floor that ratchets up; formal-proof count can't silently drop.
5. **Least privilege + SHA-pinned CI**, secrets scanned, soft-gates carry a dated TODO to harden.

## Operating Procedure

### 1. Map the app's layers
Identify which of L0–L7 apply (every dApp has L0/L1/L3/L5/L6; DeFi adds L1-formal/L2/L4/L7). [model.md](model.md).

### 2. Wire each layer in CI
One job per layer, emitting a manifest entry. [ci-wiring.md](ci-wiring.md) + the per-layer files.

### 3. Roll up the gate
`node tools/qa-gate/qa-gate.mjs qa-manifest.json --report QA_PROOF.md` → one verdict + a publishable report. [release-gate.md](release-gate.md).

### 4. Enforce
CI fails the PR on a non-zero gate. Ship only on 🟢 with evidence.

### Pick the right agent
| Task | Agent | Model |
|------|-------|-------|
| Run each layer, capture evidence, build the manifest | **qa-orchestrator** | sonnet |
| Roll up the gate, make the go/no-go call | **release-gatekeeper** | opus |

---

## Progressive Disclosure (Read When Needed)

### Methodology, model & gate
- [human-level-qa.md](human-level-qa.md) — the autonomous, maximal, **human-like** QA methodology: act→audit loop, real-user mindset, evidence rule, the LAUNCH-READY gate (run by the `qa-orchestrator` agent against a real Phantom wallet)
- [model.md](model.md) — full pyramid + chain-agnostic↔Solana mapping
- [release-gate.md](release-gate.md) — manifest schema, qa-gate verdict, the evidence rule
- [ci-wiring.md](ci-wiring.md) — SHA-pinned actions, `permissions:{}`, CI-as-data, Discord/alerts

### Per layer
- [static-lint.md](static-lint.md) · [unit-property.md](unit-property.md) · [formal.md](formal.md)
- [integration-indexer.md](integration-indexer.md) · [e2e-realwallet.md](e2e-realwallet.md)
- [load-perf.md](load-perf.md) · [lighthouse-a11y.md](lighthouse-a11y.md) · [security-secrets.md](security-secrets.md)
- [uptime-keeper.md](uptime-keeper.md)

### Companion skills
- [solana-testing](../solana-testing/SKILL.md) — program-level unit/fuzz/coverage (the L1-program layer this delegates to)
- [solana-sybil-defense](../solana-sybil-defense/SKILL.md) / [solana-attestations](../solana-attestations/SKILL.md) — when the app gates on eligibility/credentials

---

## Task Routing Guide

| User asks about... | Primary file(s) |
|--------------------|-----------------|
| "test my dApp like a human" / full human-level QA | human-level-qa.md → qa-orchestrator agent |
| e2e with a real Phantom wallet | e2e-realwallet.md (Synpress 4.1+) |
| "set up CI/QA for my dApp" | ci-wiring.md, model.md |
| "block my release until QA passes" | release-gate.md |
| e2e against a real wallet | e2e-realwallet.md |
| load / k6 / RPC throughput | load-perf.md |
| Lighthouse / accessibility | lighthouse-a11y.md |
| secret scanning / leaked keys | security-secrets.md |
| formal verification (Kani) | formal.md |
| uptime / keeper freshness | uptime-keeper.md |
| **program unit/fuzz/coverage** | solana-testing |

---

## Commands

| Command | Description |
|---------|-------------|
| `/qa-gate` | Run `tools/qa-gate` over a results manifest → BLOCK/PASS verdict + QA report (exit 1 fails CI) |
| `/scaffold-e2e` | Generate a dual-mode **Playwright + Synpress (real Phantom)** e2e skeleton — connect→unlock→approve→sign→send, local-pending vs live finalized-sig |
| `/setup-ci-qa` | Emit SHA-pinned, least-privilege workflows for every applicable layer + gitleaks config |

## Agents

| Agent | Purpose |
|-------|---------|
| **qa-orchestrator** | Runs each layer, captures evidence (both viewports, console, on-chain read), writes one manifest entry per layer |
| **release-gatekeeper** | Single owner of go/no-go; refuses to ship on any required-layer fail or skip; enforces the evidence rule |

## Tool & proof

`tools/qa-gate/` is the runnable release gate. `examples/release-gate/` is the **verified proof**:
an all-green manifest → RELEASE ALLOWED; a regressed manifest → RELEASE BLOCKED naming 5 distinct
blocker classes (failed e2e, **skipped formal**, sub-floor coverage + lighthouse, over-budget load
p95), while a breached non-required uptime metric warns without blocking (**6/6 tests pass**).
See [examples/release-gate](../examples/release-gate) and [EVAL_REPORT.md](../EVAL_REPORT.md).
