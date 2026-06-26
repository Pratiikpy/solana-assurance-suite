---
description: Gather participant funding data, run the sybil-scan engine, and report suspicious clusters with the signals that fired and their risk scores.
argument-hint: <participants.json | program/mint to gather>
---

Run a sybil scan on a set of airdrop/mint participants and report the suspicious funding
clusters. Bias to precision: this surfaces clusters for human review, it does not deny anyone.

Argument: `$ARGUMENTS` — either a path to a prepared `participants.json`, or a
program/mint/snapshot to gather data for first.

## Steps

1. **Gather (if needed).** If the argument is not already a normalized participants file, follow
   [skill/data-sources.md](../skill/data-sources.md) to pull each wallet's first funder, funding
   timestamp, amount, CEX/deposit tag, and behavioral fingerprint, and write
   `participants.json`: `{ "wallets": [ { id, funder, fundedAt, amount, cex, fingerprint }, ... ] }`.
   Note any wallets with unresolved funding.
2. **Scan.** Run:
   ```
   node tools/sybil-scan/sybil-scan.mjs participants.json --out report.json
   ```
3. **Interpret.** Read `report.json`. For each suspicious cluster, explain *why* it was flagged
   using [skill/clustering-signals.md](../skill/clustering-signals.md) and
   [skill/scoring-and-thresholds.md](../skill/scoring-and-thresholds.md): which signals fired
   (`burst`, `amountUniform`, `fpShared`, `cexShared`), cluster size, time spread, risk score.

## Report

- Totals: wallets scanned, distinct funders, flagged vs eligible counts.
- Suspicious clusters ranked by risk, each with: funder, size, time spread, **signals that
  fired**, and risk score.
- Any large funder that was **not** flagged because it tripped only one signal (e.g. a CEX hot
  wallet funding diverse legit users) — call these out as correctly spared.
- A short limits note: this misses sophisticated sybils (unique funders, CEX routing, organic
  timing, varied behavior) — see [skill/evasion-and-limits.md](../skill/evasion-and-limits.md).

Do not declare any wallet a sybil on a single signal, and do not produce a final eligibility
list here — that is `/build-eligibility`. For a deeper investigation, hand off to the
`sybil-analyst` agent.
