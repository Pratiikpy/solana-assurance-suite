# solana-loops rules

Enforceable rules for any loop run.

1. **"Done" is machine-verified, never self-declared.** Every item has an objective `verify` check; the Stop-gate re-runs it and overrides any self-reported `done`. → no overconfident termination.
2. **An item counts only as verified-with-proof, fixed-and-re-tested, or blocked-with-a-real-reason.** A `done` flag with a failing check is `NOT DONE`.
3. **No-fake-green.** A check that didn't run is `NOT TESTED`, not "skipped" — it blocks the loop. Never weaken a check to make it pass.
4. **One item per session, fresh context.** Progress lives in `loop.json` / `PROGRESS.md` / `MEMORY.md` / git — never the context window.
5. **Hard guardrails always on:** `MAX_SESSIONS` cap, stuck-detection (same failing set → STOP + surface), per-session `MAX_TURNS`. A loop with no cap can burn $500/hr.
6. **Watch the first session.** Its interpretation shapes the run; correct course early.
7. **External / irreversible actions are blocked-with-reason, surfaced — never faked.** Publish, submit, mainnet spend, a missing key/quota: stop and tell the operator the unblock action.
8. **Coverage-as-a-contract (audit loop):** the run is not done while a required in-scope component is unreviewed.
9. **Verdicts before findings ship (audit loop):** CONFIRMED / OVERSTATED / REFUTED / NEEDS-HUMAN; dedup root defects; downgrade scaffold-guarded / off-money-path. Fight false positives as hard as false negatives.

**Stop condition:** the loop ends only when the Stop-gate returns DONE (every item satisfied) or STOP (a guardrail trips or work is honestly blocked) — never when the model feels finished.
