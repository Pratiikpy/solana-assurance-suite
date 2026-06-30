# Loop: audit

**Drive an adversarial security audit to a small set of bulletproof, de-inflated findings — over many fresh sessions, with coverage tracked as a contract.** Modeled on a real 16-session audit loop that shipped Code4rena/Cantina submissions.

Paste this as the loop's `PROMPT.md`. Runs on the shared engine (`engine.md`).

## Strategy (locked)

**Tincho deep-dive: 2 bulletproof findings beat 10 shallow ones.** Depth over breadth. Methodology, in order:

`prior-art → docs → assumptions → enumerate → deep-dive → prove → write`

1. **Prior art** — read `PREVIOUS_AUDITS.md` and known bug classes for this stack (Solana/Anchor: missing signer, account substitution, `init_if_needed` reinit, unchecked math, CPI/PDA confusion, oracle manipulation).
2. **Docs before code** — build the intended-behavior model first; most real bugs live in the intent-vs-code gap.
3. **Assumptions** — list every developer assumption in `FINDINGS.md`, then check each one. A disproven assumption is recorded with *why* it doesn't hold (a dead end is data).
4. **Enumerate + deep-dive** — work the `COVERAGE.md` map; pick the highest-priority unreviewed component.
5. **Prove or kill** — every candidate finding gets a verdict before it counts.

## What "done" means for this loop

`loop.json` items are **components in `COVERAGE.md`** (coverage-as-a-contract: the run is not done while a required, in-scope component is unreviewed) plus **a written report**. A finding only counts when it carries a verdict:

`CONFIRMED · OVERSTATED · REFUTED · NEEDS-HUMAN`

This is the second-opinion discipline: **fight false positives as hard as false negatives.** Before any finding ships, re-judge it against a project-specific "critical bar," dedup root defects double-counted across passes, and downgrade anything scaffold-guarded / fails-honestly / not-on-a-money-path. A wall of inflated "criticals" nobody trusts is a failed audit.

## Per-session contract

1. Read `COVERAGE.md` + `FINDINGS.md` + `MEMORY.md`. Pick the highest-priority unreviewed component.
2. Review it line-by-line (or via a scoped sub-agent), against the intended-behavior model.
3. For each candidate: write `Severity | Finding | File:line | Evidence (quoted code) | Fix`, then a verdict. Update `FINDINGS.md` (with a `COUNTS` line) and mark coverage in `COVERAGE.md`.
4. Record disproven hypotheses in `MEMORY.md` with the reason. Commit.
5. Report 3 lines (SESSION / JUST CLOSED / NEXT) and exit.

## State files (this loop)

`COVERAGE.md` (the contract) · `FINDINGS.md` (tracker + verdicts + COUNTS) · `MEMORY.md` (dead ends) · `FINAL_SUBMISSIONS.md` (the ranked, verdict-CONFIRMED report) · `PREVIOUS_AUDITS.md` · `skills/` (auditor-mindset, report-writer).

The loop ends when COVERAGE hits its contracted threshold and `FINAL_SUBMISSIONS.md` holds the ranked, CONFIRMED findings — not when the model feels finished.
