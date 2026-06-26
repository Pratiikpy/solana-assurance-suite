---
description: Given an already-decided eligibility list, run the eligibility-reviewer fairness audit — false positives, appeals, transparency, and threshold defensibility.
argument-hint: <eligibility.json | exclusion list> [+ scan report.json]
---

Audit an eligibility decision that has already been made, for fairness to the people who were
excluded. Use before publishing or distributing. This does not change the list — it produces a
verdict and a manual-review list.

Argument: `$ARGUMENTS` — the decided eligibility/exclusion list, and (ideally) the
`report.json` and `participants.json` the decision was based on so the audit can re-derive.

## Steps

1. **Load the decision** and, if available, the underlying scan and participant data.
2. **Hand off to the `eligibility-reviewer` agent** (read-only, opus). It audits across four
   axes — re-deriving from the engine where possible rather than trusting the list:
   - **False positives:** excluded wallets that look legitimate (organic timing, varied amounts,
     distinct behavior) or were flagged on thin evidence — including CEX-funded users caught by a
     too-aggressive rule. See [skill/clustering-signals.md](../skill/clustering-signals.md).
   - **Appeals:** is there a real, defined path for an excluded user to contest, with a human
     reviewer and a timeline?
   - **Transparency:** is the methodology published and reproducible (signals, thresholds, known
     limits), per [skill/evasion-and-limits.md](../skill/evasion-and-limits.md)?
   - **Threshold defensibility:** would the precision bar survive public scrutiny? Compare
     against the naive baseline that false-flags 40 legit CEX-funded users in the reference proof
     ([skill/scoring-and-thresholds.md](../skill/scoring-and-thresholds.md)).

## Output

- A **fairness verdict**: `defensible` / `defensible with changes` / `not defensible`, with
  reasoning across the four axes.
- A **flagged-for-manual-review list**: specific excluded wallets whose exclusion is weak or
  whose profile looks legitimate, each with the reason it needs a human second look.

Governing standard: a denied legitimate user is worse than a missed sybil. This is a fairness
audit, not legal or financial advice; consequential decisions remain the operator's, made with
counsel.
