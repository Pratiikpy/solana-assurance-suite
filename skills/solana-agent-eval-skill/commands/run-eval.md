---
description: Run tools/agent-eval/eval.mjs over a golden dataset + agent output and report per-scorer scores and failing tasks.
argument-hint: <golden.json> <agent-output.json> [--baseline <baseline.json>]
---

Score an agent's outputs against a golden dataset. Args: `$ARGUMENTS` (golden dataset, agent output, optional `--baseline`).

Run it — do not describe what it would do:

```
node tools/agent-eval/eval.mjs <golden.json> <agent-output.json> [--baseline <baseline.json>]
```

The engine prints a `scores:` line over `tool`, `program`, `accounts`, `argValidity`, `buildable`, `overall`, then one `✗ <id>:` line per task that isn't `buildable`, and — if `--baseline` is passed — a `GATE: PASS/FAIL` verdict (exit 1 on regression). See `skill/scorers.md` for what each dimension means.

Report:
1. Paste the real `scores:` line and every `✗` failing-task line verbatim.
2. For each failing task, name the dimension that dropped it: wrong `tool`/`program`, missing/extra `accounts` (Jaccard < 1), or a required arg absent (`argValidity`).
3. If the agent output is missing an id present in golden, call it out — a missing output scores zero across the board, not a skip.
4. Note that `buildable` is structural only. For value-moving tools, a clean structural score still needs the `svm-outcome` scorer (`skill/svm-grounded-scoring.md`) to confirm the on-chain effect — say so rather than implying correctness.

Never report a score you didn't just produce. If the command errored (bad JSON, missing file), show the error and stop.
