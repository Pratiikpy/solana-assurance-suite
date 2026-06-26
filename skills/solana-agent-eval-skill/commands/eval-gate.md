---
description: Compare current eval scores to the committed baseline and fail on any regression; wire the gate into CI.
argument-hint: <golden.json> <agent-output.json> [baseline=baseline.json]
---

Gate the agent on regressions against a committed baseline. Args: `$ARGUMENTS` (golden dataset, current agent output, baseline path — default `baseline.json`). Follow `skill/ci-gating.md`.

Run the gate:

```
node tools/agent-eval/eval.mjs <golden.json> <agent-output.json> --baseline <baseline.json>
```

`gate()` fails if *any* dimension (`tool`, `program`, `accounts`, `argValidity`, `buildable`, `overall`) drops below baseline by more than `tol` (default 1e-4). It prints `GATE: PASS ✅` (exit 0) or `GATE: FAIL ❌ — <dim> <baseline>-><current>, ...` (exit 1). The non-zero exit is what fails the CI job.

Steps:
1. Confirm `baseline.json` reflects the current shipped agent — regenerate it from the agent on the baseline commit if in doubt. A baseline padded below true performance silently disables the gate.
2. Run the gate. Paste the real `GATE:` line and the listed regressed dimensions.
3. On FAIL: this is a real regression — report the dropped dimensions and the failing task ids from the `✗` lines; do not lower the baseline or edit the dataset to make it pass (that's leakage — see `rules/eval-honesty.md`). The agent must be fixed.
4. On PASS: only update `baseline.json` to a higher score after a verified, intentional improvement, and commit it in the same change.

CI wiring (per `skill/ci-gating.md`): regenerate the agent output, run the command above, and let the exit code gate the pipeline. Example step:

```yaml
- run: node tools/agent-eval/eval.mjs golden.json agent-output.json --baseline baseline.json
```
