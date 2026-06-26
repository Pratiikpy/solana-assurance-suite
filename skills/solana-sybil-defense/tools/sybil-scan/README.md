# sybil-scan

Cluster Solana wallets by funding/behavioral signals and score sybil risk — in one
command, zero dependencies (Node ≥ 18).

```bash
node sybil-scan.mjs <participants.json> [--out report.json]
```

## Input

```json
{ "wallets": [
  { "id": "wallet_pubkey", "funder": "first_funder_pubkey", "fundedAt": 1718000000,
    "amount": 0.02, "cex": "binance", "fingerprint": "swap,stake,claim" }
] }
```

Build this from on-chain data per [`../../skill/funding-graph.md`](../../skill/funding-graph.md)
and [`../../skill/data-sources.md`](../../skill/data-sources.md) (Helius / `@solana/kit`).

## How it decides

Groups wallets by `funder`, then flags a cluster **only when ≥2 signals corroborate** —
timing burst, amount uniformity, shared behavioral fingerprint, shared CEX. This is the
whole point: a CEX hot wallet that funds many *legit* users matches `cex` alone (1 signal)
and is **not** flagged, while a farm matches several and is.

A second, orthogonal pass catches the farm that *defeats* funder-clustering: when an operator
uses a fresh funder per wallet, every funder-cluster is size 1, so the engine also groups by
`(fingerprint|amount)` and flags any tight-window burst of **≥`cohortMin` (default 4)** wallets
across distinct funders — the **cross-funder behavioral-cohort** signal. The window
(`cohortWindow`, default 900s) plus an off-distribution amount keep it false-positive-free.
Exports `scan()` (returns `clusters`, `cohorts`, `flagged`) and `eligibility()` for programmatic use.

## Verified

Against the committed [`../../examples/planted-cluster`](../../examples/planted-cluster)
dataset it scores **precision 1.000 / recall 0.985, FP=0** — catching the 3 single-funder farms
*and* the 4-wallet fresh-funder cohort — vs a naive same-funder baseline that would false-flag 40
legit users. Full output in [`../../EVAL_REPORT.md`](../../EVAL_REPORT.md).

## Tuning

`scan(wallets, { minCluster, burstWindow, uniformity, cohortMin, cohortWindow })` — raise
thresholds to bias harder toward precision (fewer false positives, more evasion). See
[`../../skill/scoring-and-thresholds.md`](../../skill/scoring-and-thresholds.md).

_Last verified: June 2026 — Node 22._
