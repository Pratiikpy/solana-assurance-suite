# The loop engine (shared by every loop)

Every loop in this folder runs on the same engine. The loop directives differ only in *what "done" means*; the engine is constant. It is the distilled, battle-tested shape of an autonomous agent loop — the parts that actually make one work instead of burning money.

## The one rule that matters

**"Done" must be machine-verifiable, and the agent does not get to declare it.** A loop is just an agent working until something is *true*. If "done" is the model's own judgment, it will quit early on "good enough" (the #1 loop failure). So done is decided by `tools/loop-runner/stop-gate.mjs`, which re-verifies every item from ground truth and overrides any self-reported status.

An item is **satisfied** only when one of these holds:

- **verified-with-proof** — its objective check passes (a file exists, a command exits 0: `cargo test`, `node --test`, `deception-scan` clean, an on-chain read).
- **fixed and re-tested** — the same check, re-run after a fix, now passes.
- **blocked-with-reason** — `status: "blocked"` *and* a real `blockReason` naming the external dependency and the unblock action.

A `status: "done"` whose check fails is **not** satisfied. The gate re-runs the check and ignores the flag.

## How a single iteration runs

1. The driver (`run.sh`) asks the gate: are we done? The gate re-verifies `loop.json`. If every item is satisfied → exit success. If a guardrail tripped → stop and surface.
2. Otherwise it spawns **one fresh agent session** with a clean context, feeding it: the loop directive (`PROMPT.md`) + the reference skills + the current state files. Progress is read from disk, never from a prior context window.
3. The session picks **the single highest-leverage unsatisfied item**, does the real work, runs the item's check, updates the state files, commits, and exits.
4. Repeat. Each session sees the last session's results via the files and git history.

## State lives on disk, not in context

| File | Role |
|---|---|
| `PROMPT.md` | the loop directive — the verbatim operating contract |
| `loop.json` | the checklist the gate re-verifies (`items[]` with a `verify` spec each) |
| `MEMORY.md` | long-term notes carried across sessions (patterns, dead ends) |
| `PROGRESS.md` | append-only log of what each session closed |
| `COVERAGE.md` | coverage-as-a-contract — the run is not done while a required cell is unreviewed |
| `logs/session-N.log` | the raw transcript of each session |

> The core insight: progress does not exist in the model's context window — it exists in the files and the git diff.

## Guardrails (non-negotiable — this is what stops a runaway)

- **`MAX_SESSIONS`** hard cap (default 50). A loop with no cap can burn $500/hr.
- **Stuck detection** — the same failing set for `STUCK_LIMIT` (default 3) iterations → STOP and surface (don't grind a wall).
- **`MAX_TURNS`** per session (default 80) so one session can't run away.
- **Fresh context per session** — no single bloated session that context-rots and lossy-compacts.
- **Watch the first session.** Its interpretation of the goal shapes everything; correct course early.
- **No-fake-green.** A check that didn't run is `NOT TESTED`, not "skipped"; it blocks done.

## Status report (after every session, 3 lines)

```
SESSION: <n> / <max>
JUST CLOSED: <the one item verified satisfied this session>
NEXT (highest-leverage): <the next unsatisfied item>
```

## Operator-intervention points (surface, don't decide)

Anything needing a human or external resource — a key, paid quota, a mainnet spend, an external API that's down — is `blocked-with-reason`, surfaced, never faked green. The loop ends at "everything verified or honestly blocked," not at "I think it's done."
