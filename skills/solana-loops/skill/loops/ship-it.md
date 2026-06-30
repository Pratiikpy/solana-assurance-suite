# Loop: ship-it (mainnet-readiness)

**Drive a Solana build to mainnet-ready by looping the assurance suite's gates until every one is green — then stop.** This is the capstone: the other suite skills are the *gates*, this loop is the *driver*.

Paste as `PROMPT.md`. Runs on the shared engine (`engine.md`).

## What "done" means for this loop

`loop.json` items are the suite's objective gates — each one a real, runnable check:

```json
{ "items": [
  { "id": "program-tests",   "verify": { "cmd": "cargo test" } },
  { "id": "no-deception",    "verify": { "cmd": "node ../deception-defense/tools/deception-scan/deception-scan.mjs ./app --json" } },
  { "id": "release-gate",    "verify": { "cmd": "node ../solana-qa-automation-skill/tools/qa-gate/qa-gate.mjs manifest.json" } },
  { "id": "airdrop-fair",    "verify": { "cmd": "node ../solana-sybil-defense/tools/sybil-scan/sybil-scan.mjs allowlist.json" } },
  { "id": "agent-decisions", "verify": { "cmd": "node ../solana-agent-eval-skill/tools/agent-eval/eval.mjs" } }
] }
```

Ship-ready = the Stop-gate returns DONE, i.e. **every applicable gate passes from ground truth**. Overconfident "it's ready" is exactly the deception defect-class — and `no-deception` + `release-gate` are themselves gates, so the loop literally cannot declare ready while the product is faking success.

## Per-session contract

1. Read `loop.json` + `PROGRESS.md`. Pick the highest-leverage failing gate (a money path / a security gate outranks a cosmetic one).
2. Fix the underlying cause — not the test. (Making the check pass by weakening it is fake-green; the gate's check must stay honest.)
3. Re-run that gate's `verify`. Satisfied only when it passes. If blocked by an external dependency (mainnet funds, an RPC key), mark `blocked` with the reason + unblock action and surface it.
4. Update `loop.json` / `PROGRESS.md` / `MEMORY.md`, commit the fix + its now-green proof together.
5. Report 3 lines and exit.

## Compose with the suite

Drop only the gates that apply to your project (a program-only repo skips `release-gate`; a frontend skips `program-tests`). Each gate is an independently-installable suite skill. The loop's value is exactly the research finding: a loop works when "done" is objective — and the suite *is* the objective definition of Solana ship-safety.

The loop ends at "every applicable gate green, or honestly blocked for the operator" — never at "looks ready."
