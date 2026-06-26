---
description: Run the release gate over a per-layer QA manifest and return one BLOCK/PASS verdict + a publishable QA report. Exit 1 fails CI.
argument-hint: <manifest.json> [--report out.md]
---

Run the release gate (`tools/qa-gate/qa-gate.mjs`) over the QA results manifest at `$ARGUMENTS` and report the verdict.

## Workflow

1. **Resolve args.** First positional token = the manifest path (required). Optional `--report <out.md>` writes the publishable markdown report. If no manifest is given, stop and ask for one.

2. **Run the gate:**
   ```bash
   node tools/qa-gate/qa-gate.mjs <manifest.json> [--report out.md]
   ```
   It is zero-dependency (Node ≥ 18) and prints the verdict line, every blocker, and every non-blocking warning. **Its exit code is the decision: `0` = PASS, `1` = BLOCKED.** In CI this is the gate — a non-zero exit fails the PR. Do not swallow the exit code.

3. **Report.** Relay the verdict (`🟢 RELEASE ALLOWED` / `🔴 RELEASE BLOCKED`), then the blockers (required layers that failed, were skipped, or breached a metric threshold) and the non-blocking warnings (non-required layers). If `--report` was passed, point to the generated markdown.

## How the gate decides

A layer **blocks** when it is `required` and either `status:"fail"`, or `status:"skip"` (a skipped required layer is a gap, not a pass — you can't ship what you didn't test), or a metric breaches its threshold. `required:false` layers warn only. The verdict is BLOCKED if any layer blocks, else PASS.

## Manifest schema

```json
{
  "release": "v1.2.0",
  "layers": [
    { "name": "e2e",        "status": "pass", "required": true, "detail": "Phantom: 12 flows green; sig …finalized" },
    { "name": "coverage",   "status": "pass", "metric": 0.86, "threshold": 0.80, "direction": "min", "required": true },
    { "name": "lighthouse", "status": "pass", "metric": 0.93, "threshold": 0.90, "direction": "min", "required": true },
    { "name": "load-p95ms", "status": "pass", "metric": 420,  "threshold": 500,  "direction": "max", "required": true },
    { "name": "security",   "status": "pass", "required": true, "detail": "gitleaks + cargo-audit clean" },
    { "name": "uptime",     "status": "pass", "metric": 99.95, "threshold": 99.9, "direction": "min", "required": false }
  ]
}
```

Per layer: `name`, `status` (`pass|fail|skip`); optional `metric` + `threshold` + `direction` (`min`|`max`) for metric layers; `required` (bool); optional `detail`. For the full evidence-backed go/no-go (re-reading cited signatures, the LAUNCH-READY checklist), hand the manifest to the **release-gatekeeper** agent. Details: [../skill/release-gate.md](../skill/release-gate.md).
