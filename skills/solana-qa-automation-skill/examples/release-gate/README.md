# release-gate — the QA gate, proven

A self-checking proof of `tools/qa-gate`. Two manifests (an all-green release candidate and a
regressed one) + a `node:test` suite asserting the gate's behavior.

## Run

```bash
node --test                                              # 6/6 pass
node ../../tools/qa-gate/qa-gate.mjs manifest-green.json   # → PASS, exit 0
node ../../tools/qa-gate/qa-gate.mjs manifest-blocked.json # → BLOCKED, exit 1
```

## Verified output (Node 22)

```
# tests 6  # pass 6  # fail 0

manifest-blocked → BLOCKED 🔴
  🔴 e2e: status=fail
  🔴 formal: required layer was skipped (untested)
  🔴 coverage: min threshold breached: 0.74 vs 0.8
  🔴 lighthouse: min threshold breached: 0.81 vs 0.9
  🔴 load-p95ms: max threshold breached: 640 vs 500
  ⚠️  uptime (non-blocking): min threshold breached: 99.4 vs 99.9
```

## What it proves

The gate enforces five distinct blocker classes and one non-blocking warning:
- a **failed** required layer (e2e) blocks,
- a **skipped** required layer (formal) blocks — *you can't ship what you didn't test*,
- a `min`-direction metric below floor (coverage 0.74<0.80, lighthouse 0.81<0.90) blocks,
- a `max`-direction metric over budget (load p95 640>500) blocks,
- a breached **non-required** metric (uptime) warns but does **not** block.

This is the release-gate behavior real teams implement by hand. Methodology in
[../../skill/human-level-qa.md](../../skill/human-level-qa.md); gate docs in
[../../skill/release-gate.md](../../skill/release-gate.md).

_Last verified: June 2026 — Node 22._
