# Loop: prd-to-product

**Turn a PRD into a shipped, verified product — one task per session, until every box is green with proof.** This is the "hand off a spec, walk away, come back to real progress" loop.

Paste this as the loop's `PROMPT.md`. It runs on the shared engine (`engine.md`) — read that first; it owns the stop rule, state files, and guardrails.

## Your contract

You are running one fresh session of the prd-to-product loop. Progress lives in `loop.json` / `PROGRESS.md` / `MEMORY.md`, not your context. Do not trust your memory; read the files.

1. **Pick one task.** Read `loop.json`. Choose the single **highest-leverage** unsatisfied item — the biggest user-visible gap, not the easiest atomic closure.
2. **Build it fully — no stubs.** Implement the task end-to-end: the code path *and* the user-visible surface. No mock-as-real, no dead buttons, no "looks done."
3. **Verify it for real.** Run the item's `verify` check (a test, a build, an on-chain read, a `deception-scan`). The item is satisfied only when the check passes — `verified-with-proof`. If you can't pass it because of an external dependency, set the item `blocked` with a real `blockReason` and the unblock action.
4. **Record + commit.** Update the item's status in `loop.json`, append one line to `PROGRESS.md` (what you closed + the proof), note any pattern/dead-end in `MEMORY.md`, update `COVERAGE.md` if a surface is now covered, and `git commit` the task + its proof together.
5. **Report 3 lines** (SESSION / JUST CLOSED / NEXT) and exit. The gate decides whether the loop continues.

## What "done" means for this loop

Every PRD item is either **verified-with-proof** or **blocked-with-reason**. No item may be `done` without its check passing — the Stop-gate re-verifies and will override a false `done`. The product ships only when the gate returns DONE.

## Anti-drift rules

- One task per session. Clean git history = clean rollback points.
- Highest-leverage item over the easiest one. "It's concrete and safe" is not a reason to pick it.
- No publish / no submit / no external irreversible action — those are `blocked-with-reason`, surfaced to the operator.
- Expect ~80–95% autonomous completion; the last mile is honest blocks for the operator, not faked greens.

## `loop.json` shape

```json
{ "items": [
  { "id": "deposit-flow", "status": "pending", "verify": { "cmd": "node --test app/tests/deposit.test.mjs" } },
  { "id": "landing-no-fake-success", "status": "pending", "verify": { "cmd": "node tools/deception-scan/deception-scan.mjs ./app --json" } },
  { "id": "mainnet-deploy", "status": "blocked", "blockReason": "needs operator to fund the deployer wallet — surface the address" }
] }
```
