---
description: From a sybil scan, produce the filtered claimant set plus merkle root and proofs, and a publishable methodology note.
argument-hint: <report.json | participants.json>
---

Turn a sybil scan into a publishable eligibility artifact: the filtered claimant set, a merkle
root and per-claimant proofs, and a methodology note that anyone can read. Follow
[skill/eligibility-export.md](../skill/eligibility-export.md) for the export and merkle format.

Argument: `$ARGUMENTS` — a scan `report.json`, or a `participants.json` to scan first.

## Steps

1. **Get a scan.** If given participants, run
   `node tools/sybil-scan/sybil-scan.mjs participants.json --out report.json` first
   (or via `/scan-sybils`). Otherwise read the provided `report.json`.
2. **Filter.** Drop flagged wallets to get the eligible set — the engine's `eligibility()`
   helper does this (optionally keeping one representative per sybil cluster, only if the
   airdrop policy explicitly allows it). Record the exact rule used.
3. **Build the merkle tree** over the eligible claimants per
   [skill/eligibility-export.md](../skill/eligibility-export.md): deterministic leaf encoding,
   sorted, producing a single `merkleRoot` and a proof per claimant. Emit
   `eligibility.json` (claimants + proofs) and the root for on-chain configuration.
4. **Write the methodology note** — publishable, plain-language:
   - the signals and thresholds used, and the precision-first stance (link
     [skill/scoring-and-thresholds.md](../skill/scoring-and-thresholds.md));
   - counts: participants, flagged, eligible, and clusters excluded;
   - **known limits** — the sybils this misses (link
     [skill/evasion-and-limits.md](../skill/evasion-and-limits.md));
   - the **appeals path**: how an excluded user contests the exclusion, with a human reviewer.

## Output

- `eligibility.json` — eligible claimants with merkle proofs.
- `merkleRoot` — for the claim program / distributor config.
- `methodology.md` — the publishable note above.

Bias to precision: when a cluster is borderline, prefer including the claimant and flagging for
manual review over excluding. This produces an eligibility list, not a final legal determination
of fraud, and is not legal or financial advice. To audit the result for fairness before
publishing, run `/audit-airdrop`.
