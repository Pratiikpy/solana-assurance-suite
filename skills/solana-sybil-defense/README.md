# solana-sybil-defense

**Fair airdrops, without the farms.**

> **Extends**: [solana-dev-skill](https://github.com/solana-foundation/solana-dev-skill). Composes with `solana-attestations` (proof-of-human) and `solana-testing` (test the claim gate).

A progressively-loaded skill for Claude Code / Codex that turns any coding agent into a Solana sybil analyst: build a funding graph from on-chain data, cluster wallets on **multiple corroborating signals**, score sybil risk, and export a fair, publishable claimant set — *without* punishing legit users.

## The problem

Every Solana airdrop, mint, and points program gets farmed. One operator funds 50 wallets from a single source, scripts identical behavior, and harvests a disproportionate share — Jupiter, Wormhole, Drift, Kamino and Jito airdrops all fought this. Teams either eat the dilution or hand-roll brittle "same-funder = bot" filters that **wrongly deny real users** (the worst PR outcome). Third-party services exist, but there's no skill, and nothing in the kit or the 47 bounty PRs owns it.

The hard part isn't finding clusters — it's finding them **without false positives**: a CEX hot wallet funds thousands of *legitimate* users from one address. Naive funder-clustering flags them all. This skill requires ≥2 corroborating signals before flagging anyone.

**This is the cluster-level layer.** Proof-of-human APIs (Proof of Human, `verify-humanity-poh`) ask *"is this one wallet a human?"* — they can't see a farm of 50 individually-plausible wallets funded from one source. This catches the farm. Use both: eligibility = *not in a sybil cluster* **and** *holds a valid attestation* (see [solana-attestations](../solana-attestations)).

## What's included

| Component | Contents |
|-----------|----------|
| **Tool** (`tools/sybil-scan`) | Zero-dep Node engine: funding-graph clustering on multi-signal evidence → risk scores + an eligibility export. **Verified runnable.** |
| **Skill** (`skill/`) | `SKILL.md` router + 9 references: landscape, clustering-signals, funding-graph, data-sources, scoring-and-thresholds, evasion-and-limits, eligibility-export, integration, resources |
| **Agents** (`agents/`) | `sybil-analyst` (cluster + explain), `eligibility-reviewer` (fairness audit) |
| **Commands** (`commands/`) | `/scan-sybils`, `/build-eligibility`, `/audit-airdrop` |
| **Rules** (`rules/`) | `sybil-fairness.md` — never flag on one signal, bias to precision, always allow appeals |
| **Example** (`examples/planted-cluster`) | Synthetic dataset with planted farms + a fresh-funder cohort + a CEX-funded legit decoy group; **precision 1.000 / recall 0.985, FP=0** |

## The signals (and why one is never enough)

| Signal | Catches | False-positive trap |
|--------|---------|---------------------|
| Common-funder fan-out | a farm funded from one wallet | a CEX hot wallet funds many legit users |
| Funding timing burst | scripted bulk creation | a popular mint funds many users at once |
| Identical amounts (peeling) | automated equal splits | round-number coincidence |
| Shared CEX deposit | one human behind many wallets | everyone uses the same big exchange |
| Behavioral fingerprint | copy-paste scripts | a guided tutorial flow |
| Graph connectivity | linked wallet rings | shared infra (relayers) |
| **Cross-funder behavioral cohort** | a fresh-funder farm that defeats funder-clustering | guarded by a tight window + an off-distribution amount |

The first six are funder-cluster signals: `sybil-scan` flags a cluster only when **≥2** corroborate — so the CEX-funded legit group is spared while the farm is caught. The seventh is orthogonal: a scripted farm that uses a unique funder per wallet leaves every funder-cluster size 1, so the engine *also* groups by `(fingerprint|amount)` and flags any tight-window burst of ≥4 wallets across distinct funders. That catches fresh-funder farms the funder signals structurally cannot.

## Verified proof

```bash
cd examples/planted-cluster
node generate.mjs && node verify.mjs
```
```
flagged 64 wallets | TP=64 FP=0 FN=1 TN=240
precision=1.000  recall=0.985  f1=0.992
cross-funder behavioral cohorts caught: 1 (vote|0.09 x4)
naive "same-funder" baseline would FALSE-FLAG 40 legit wallets; multi-signal FP=0
PASS ✅
```
Recall is honestly < 1.0: one *truly-lone* sybil (unique funder, unique behavior, spread timing) evades — it shares nothing with anyone, so there is no cluster or cohort to find. The fresh-funder cohort that *used* to evade is now caught by the cross-funder behavioral-cohort signal — see `skill/evasion-and-limits.md`. The point is **zero false positives** plus catching the farms a naive filter and a real team would both get wrong.

## Installation

```bash
./install.sh          # ~/.claude/skills, clones core skill if missing
./install-custom.sh   # choose location; optionally copy agents/commands/rules
```

## Ethic

A denied real user is worse than a missed sybil. The detector biases to **precision**, requires multiple signals, exports a **publishable methodology**, and treats scores as decision-support feeding human review + appeals — never an automatic verdict. It requests no PII and is not legal/financial advice.

## License

MIT — see [LICENSE](LICENSE). Built for the [Solana AI Kit](https://github.com/solanabr/solana-ai-kit) bounty.
