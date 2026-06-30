---
name: loop
description: Scaffold and start a solana-loops run — pick a loop (prd-to-product | audit | ship-it), generate its loop-dir (PROMPT.md + loop.json + state files), then drive it with the Stop-gate until DONE or a guardrail surfaces.
---

Start an autonomous loop for the user's goal.

Steps:

1. **Pick the loop** from the argument or the goal: `prd-to-product` (PRD → shipped product), `audit` (security audit → findings), or `ship-it` (build → mainnet-ready via the assurance gates).
2. **Scaffold the loop-dir**: copy the chosen directive to `<loop-dir>/PROMPT.md`, write `loop.json` (one item per task/gate/component, each with a real `verify` check — a command that exits 0 or a file that must exist), and create empty `MEMORY.md` / `PROGRESS.md` / `COVERAGE.md`.
3. **Confirm the "done" definition with the user** — show the `loop.json` items and their checks. This is the most important step: a loop is only as good as its verifiable end state.
4. **Dry-run the gate**: `node tools/loop-runner/stop-gate.mjs <loop-dir>` — confirm it reports the right unsatisfied items (and overrides any pre-set `done`).
5. **Run**: `bash tools/loop-runner/run.sh <loop-dir> 1 <max-sessions>`. Watch the first session and correct course if its interpretation is off.
6. **On STOP** (guardrail or blocked-with-reason), surface the remaining items to the operator with the reasons — never fake them green.

Keep the output tight: show the loop chosen, the `loop.json` done-definition, and the gate's first verdict.
