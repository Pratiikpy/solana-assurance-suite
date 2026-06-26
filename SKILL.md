---
name: solana-assurance-suite
description: The verification & ship-safety layer for Solana — a progressively-loaded hub that routes to six focused, production-grade skills, each of which ships a runnable proof. Prove a program correct before mainnet (testing), gate the whole dApp release (qa-automation), keep airdrops fair (sybil-defense), issue & verify on-chain credentials (attestations), evaluate AI agents (agent-eval), and bridge cross-chain safely (bridge). Extends solana-dev-skill. Use this hub to pick the right sub-skill for a builder's task; each sub-skill then progressively loads its own references.
user-invocable: true
---

# Solana Assurance Suite — Prove It Before You Ship

> **Extends**: [solana-dev-skill](https://github.com/solana-foundation/solana-dev-skill). This is a **hub** that routes to six focused sub-skills under `skills/`. Load only the one the task needs — each is independently installable and ships its own progressive `SKILL.md`.

`solana-dev` and the protocol skills help you *build*. This suite is the layer that makes sure what you built **actually works and is safe to ship** — the assurance/verification layer, with one defining principle: **every skill ships a runnable proof a judge can execute, not a claim.** That principle is the thread that ties the six together.

## Route to the right sub-skill

| When the builder needs to… | Use | Proof it ships |
|---|---|---|
| Prove a **program** is correct before mainnet (unit/fuzz/invariants/coverage/CU) | [solana-testing](skills/solana-testing-skill/skill/SKILL.md) | invariant-poc + real SBF Mollusk test + IDL→suite generator (verified on Kamino Lending) |
| Gate the **whole dApp release** + test like a human with a real **Phantom** wallet | [solana-qa-automation](skills/solana-qa-automation-skill/skill/SKILL.md) | `qa-gate` release verdict (6/6); Phantom e2e scaffold |
| Keep an **airdrop/mint fair** (catch sybil farms, spare real users) | [solana-sybil-defense](skills/solana-sybil-defense/skill/SKILL.md) | `sybil-scan` precision 1.000 / recall 0.985 / FP=0 |
| Issue & **verify on-chain credentials** (SAS), proof-of-human gating | [solana-attestations](skills/solana-attestations-skill/skill/SKILL.md) | `sas-verify` 9/9 (every bypass rejected) |
| **Evaluate a Solana AI agent** (right tool/program/accounts) + CI gate | [solana-agent-eval](skills/solana-agent-eval-skill/skill/SKILL.md) | `agent-eval` 4/4 (gate fires on regression) |
| **Bridge cross-chain safely** (CCTP / Wormhole NTT / deBridge) | [solana-bridge](skills/solana-bridge-skill/skill/SKILL.md) | `bridge-guards` 6/6 (replay/finality/decimal guards) |

## How they compose

The suite isn't six islands — the sub-skills reinforce each other along the ship-safety path:

```
build (solana-dev)
  → solana-testing        prove the program            (program correctness)
  → solana-bridge         verify cross-chain moves      (integration safety)
  → solana-sybil-defense  +  solana-attestations        (eligibility = not-a-farm AND attested-human)
  → solana-agent-eval     prove the agent's decisions   (if you ship an agent)
  → solana-qa-automation  roll it ALL up into one release gate + human-level Phantom e2e
                          ↳ delegates program tests to solana-testing
```

`solana-qa-automation`'s release gate is the capstone: it ingests a per-layer results manifest
(unit → e2e → contract → formal → load → lighthouse → security → uptime) and returns one
BLOCK/PASS verdict — the other five skills feed layers into it.

## Operating procedure

1. **Pick the sub-skill** for the task from the table above.
2. **Open that sub-skill's `SKILL.md`** — it progressively loads only its own references (token-efficient; you never load all six at once).
3. **Run its proof** to ground the work (`node --test` / `cargo test` / the skill's `tools/` runner).
4. For a launch, drive everything through **solana-qa-automation**'s release gate.

## Install

```bash
./install.sh            # installs all six sub-skills into ~/.claude/skills
./install.sh testing    # or install a subset by name (testing|qa|sybil|attestations|agent-eval|bridge)
```

Each sub-skill is also independently installable from its own folder (`skills/<name>/install.sh`)
and independently MIT-licensed — so the suite can be merged whole or cherry-picked into the kit.

## Proof index

Every sub-skill ships an executable proof; the aggregate run is in [EVAL_REPORT.md](EVAL_REPORT.md):

| Sub-skill | Proof | Result |
|-----------|-------|--------|
| solana-testing | invariant-poc · vault-poc SBF · soltest-gen | 4✓ · 2✓ · escrow+Kamino(51 ix→343 checks) |
| solana-bridge | bridge-guards | 6/6 |
| solana-sybil-defense | planted-cluster | precision 1.000 / recall 0.985 / FP=0 |
| solana-attestations | sas-verify | 9/9 |
| solana-agent-eval | eval-run | 4/4 |
| solana-qa-automation | release-gate | 6/6 |
