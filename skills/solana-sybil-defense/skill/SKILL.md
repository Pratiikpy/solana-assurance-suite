---
name: solana-sybil-defense
description: Detect sybil clusters in Solana airdrops, mints, and points programs — and protect eligibility without punishing legit users. Builds a funding graph from on-chain data, clusters wallets by multiple corroborating signals (common-funder fan-out, timing bursts, identical amounts, shared CEX deposits, behavioral fingerprints, graph connectivity) plus a cross-funder behavioral-cohort signal that catches fresh-funder farms funder-clustering misses, scores sybil risk, and exports a fair, publishable claimant set (merkle distribution). Ships a runnable clustering engine and a verified proof. Extends solana-dev-skill; composes with solana-attestations (proof-of-human) and solana-testing (test the claim gate). For data plumbing it leans on Helius; this skill owns the detection + fairness logic.
user-invocable: true
---

# Solana Sybil Defense — Fair Airdrops, Without the Farms

> **Extends**: [solana-dev-skill](../solana-dev/SKILL.md). Composes with [solana-attestations](../solana-attestations/SKILL.md) (prove the humans) and [solana-testing](../solana-testing/SKILL.md) (test the claim gate). Data plumbing leans on Helius; this skill owns the **detection + fairness** layer.

Every Solana airdrop, mint, and points program gets farmed — one operator funds 50 wallets from a single source, scripts identical behavior, and harvests a disproportionate share. Teams either eat the dilution or hand-roll brittle filters that wrongly punish legit users (a PR disaster). There's no skill for this. This one turns any coding agent into a sybil analyst: build the funding graph, cluster on **multiple corroborating signals** (never one), score risk, and export a defensible, publishable eligibility set.

> **Core ethic:** catch farms **without** punishing legit users. A denied real user is worse than a missed sybil — so the detector biases to **precision**, requires ≥2 signals before flagging, and always leaves an appeals path. See [scoring-and-thresholds.md](scoring-and-thresholds.md) and [rules/sybil-fairness.md](../rules/sybil-fairness.md).

## What This Skill Is For

### Detect
- Understand the attack + when to use this → [sybil-landscape.md](sybil-landscape.md)
- The clustering signals (and each one's false-positive trap) → [clustering-signals.md](clustering-signals.md)
- Build the funding graph from on-chain data → [funding-graph.md](funding-graph.md)
- Where the data comes from (Helius DAS/RPC, cost realities) → [data-sources.md](data-sources.md)

### Decide
- Turn signals into a risk score + threshold → [scoring-and-thresholds.md](scoring-and-thresholds.md)
- Honest limits: how sophisticated sybils evade; why precision dominates → [evasion-and-limits.md](evasion-and-limits.md)

### Distribute
- Export a fair, publishable claimant set + merkle distribution → [eligibility-export.md](eligibility-export.md)
- Wire it into a claim/mint program, combine with proof-of-human → [integration.md](integration.md)

### Delegate to companion skills
- Prove the *humans* (SAS credentials) → [solana-attestations](../solana-attestations/SKILL.md)
- Test the claim gate (LiteSVM/Mollusk) → [solana-testing](../solana-testing/SKILL.md)
- Writing the claim program / client → solana-dev

## Default Approach (Opinionated)

1. **Never flag on one signal.** A CEX hot wallet funds thousands of legit users — `same-funder` alone is a false-positive machine. Require ≥2 corroborating signals (timing burst, amount uniformity, shared behavior/CEX). This is enforced by `tools/sybil-scan`.
2. **Bias to precision.** Tune so legit users are not denied; accept that a *truly-lone* sophisticated sybil evades (recall is never 1.0). A second, orthogonal signal — the cross-funder behavioral cohort — catches fresh-funder farms that defeat funder-clustering, closing most of the gap without costing precision.
3. **Publish the methodology.** Fairness requires transparency; export the merkle root + the rules used.
4. **Decision-support, not verdict.** Scores feed human review + appeals, especially near the threshold.

## Operating Procedure

### 1. Gather + graph
Pull each participant's first-funder, timing, amount, CEX trace, and behavioral fingerprint ([data-sources.md](data-sources.md)); build the funding graph ([funding-graph.md](funding-graph.md)).

### 2. Cluster + score
Run the engine: `node tools/sybil-scan/sybil-scan.mjs participants.json`. It groups by funder and flags only multi-signal clusters, then runs a second pass that groups by `(fingerprint|amount)` to catch cross-funder behavioral cohorts — fresh-funder farms that funder-clustering structurally misses ([clustering-signals.md](clustering-signals.md), [scoring-and-thresholds.md](scoring-and-thresholds.md)).

### 3. Review + appeal
Audit flagged clusters for false positives ([evasion-and-limits.md](evasion-and-limits.md)); the `eligibility-reviewer` agent checks fairness before anything is final.

### 4. Distribute
Export the eligible set + merkle proofs and publish the method ([eligibility-export.md](eligibility-export.md)); gate the claim program, optionally with a proof-of-human attestation ([integration.md](integration.md)).

### Pick the right agent
| Task | Agent | Model |
|------|-------|-------|
| Pull data, cluster, explain flags | **sybil-analyst** | sonnet |
| Audit an eligibility list for fairness | **eligibility-reviewer** | opus |

---

## Progressive Disclosure (Read When Needed)

### Detect
- [sybil-landscape.md](sybil-landscape.md) — attack taxonomy, when to use
- [clustering-signals.md](clustering-signals.md) — the signals + their false-positive traps
- [funding-graph.md](funding-graph.md) — build the graph, union-find clusters
- [data-sources.md](data-sources.md) — Helius DAS/RPC, cost realities

### Decide & distribute
- [scoring-and-thresholds.md](scoring-and-thresholds.md) — risk score, precision/recall tradeoff
- [evasion-and-limits.md](evasion-and-limits.md) — how sybils evade; honest limitations
- [eligibility-export.md](eligibility-export.md) — merkle distribution + transparency
- [integration.md](integration.md) — claim-gate + proof-of-human
- [resources.md](resources.md) — pinned tools, APIs, references

### Companion skills
> Install alongside for the full eligibility story.
- [solana-attestations](../solana-attestations/SKILL.md) — SAS proof-of-human gate
- [solana-testing](../solana-testing/SKILL.md) — test the claim program

---

## Task Routing Guide

| User asks about... | Primary file(s) |
|--------------------|-----------------|
| "is my airdrop being farmed" / detect sybils | sybil-landscape.md, clustering-signals.md |
| build the funding graph / trace funders | funding-graph.md, data-sources.md |
| how to score / what threshold | scoring-and-thresholds.md |
| "won't this flag real users?" | evasion-and-limits.md, scoring-and-thresholds.md |
| produce the claim list / merkle | eligibility-export.md |
| gate the claim program / proof-of-human | integration.md → solana-attestations |
| **prove unique humans** | solana-attestations |
| **test the claim gate** | solana-testing |

---

## Commands

| Command | Description |
|---------|-------------|
| `/scan-sybils` | Gather participant funding data, run `sybil-scan`, report suspicious clusters + signals |
| `/build-eligibility` | Produce the filtered claimant set + merkle root/proofs + a publishable methodology note |
| `/audit-airdrop` | Fairness audit of a decided eligibility list (false positives, appeals, transparency) |

## Agents

| Agent | Purpose |
|-------|---------|
| **sybil-analyst** | Pulls data, builds the graph, runs the engine, explains *why* each cluster was flagged |
| **eligibility-reviewer** | Audits an eligibility list for fairness and false-positive risk before it ships |

## Tool & proof

`tools/sybil-scan/` is the runnable clustering engine. `examples/planted-cluster/` is the
**verified proof**: on a synthetic dataset with planted sybil farms, a fresh-funder cohort,
*and* a legit CEX-funded decoy group, it scores **precision 1.000 / recall 0.985** with **zero
false positives** — catching the 3 single-funder farms plus the 4-wallet cross-funder cohort —
while a naive same-funder baseline would wrongly flag 40 legit users. See
[examples/planted-cluster/README.md](../examples/planted-cluster/README.md) and [EVAL_REPORT.md](../EVAL_REPORT.md).
