# qa-gate

The release gate for full-stack web3 QA — ingests a per-layer results manifest and returns
one BLOCK/PASS verdict + a publishable QA report. Zero dependencies (Node ≥ 18). Library + CLI.

```bash
node qa-gate.mjs <manifest.json> [--report QA_PROOF.md]
```

## Manifest

```json
{ "release": "v1.2.0", "layers": [
  { "name": "e2e",        "status": "pass", "required": true },
  { "name": "coverage",   "status": "pass", "metric": 0.86, "threshold": 0.80, "direction": "min", "required": true },
  { "name": "load-p95ms", "status": "pass", "metric": 420,  "threshold": 500,  "direction": "max", "required": true },
  { "name": "uptime",     "status": "pass", "metric": 99.95,"threshold": 99.9, "direction": "min", "required": false }
] }
```

## The rule

A `required` layer **blocks** the release when it is `fail`, **`skip`** (untested = a gap, not a
pass), or a metric breaches its threshold (`min`: metric < threshold; `max`: metric > threshold).
Non-required layers warn but never block. Exports `evaluateLayer`, `qaGate(manifest)`, `toReport(gate)`.

Wire as the final CI step after every layer job writes its manifest entry:
`node tools/qa-gate/qa-gate.mjs qa-manifest.json --report QA_PROOF.md` → exit 1 fails the build.
See [`../../skill/release-gate.md`](../../skill/release-gate.md) and [`../../skill/ci-wiring.md`](../../skill/ci-wiring.md).

## Verified

[`../../examples/release-gate`](../../examples/release-gate): green → allowed; regressed → blocked
on 5 distinct classes (failed e2e, **skipped formal**, sub-floor coverage/lighthouse, over-budget
load), uptime warns. **6/6 tests pass.** Output in [`../../EVAL_REPORT.md`](../../EVAL_REPORT.md).

_Last verified: June 2026 — Node 22._
