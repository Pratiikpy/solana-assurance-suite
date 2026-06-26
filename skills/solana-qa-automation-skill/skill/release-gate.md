# Release Gate — One BLOCK/PASS Verdict Over Every Layer

The gate is the whole point of this skill. Every other layer (L0–L7, see [model.md](model.md)) does one job: produce **one manifest entry**. `tools/qa-gate/qa-gate.mjs` ingests the manifest and returns a single verdict — and **refuses to ship on a failed _or skipped_ required layer**. A skip is a gap, not a pass: you cannot ship what you did not test.

Zero dependencies, Node ≥ 18, library + CLI. Source: [`../tools/qa-gate/qa-gate.mjs`](../tools/qa-gate/qa-gate.mjs).

## Manifest schema

The gate ingests one JSON file. Each layer is one object in `layers[]`.

```jsonc
{
  "release": "v1.2.0",          // free-form version tag, shown in the report
  "layers": [
    {
      "name": "e2e",            // layer id
      "status": "pass",         // "pass" | "fail" | "skip"
      "metric": 0.86,           // optional number, compared to threshold
      "threshold": 0.80,        // optional number
      "direction": "min",       // "min" (default) | "max"
      "required": true,         // required layers block; non-required only warn
      "detail": "18 flows green"// optional free text, surfaced in the report
    }
  ]
}
```

- `direction: "min"` (default) → breach when `metric < threshold` (coverage, lighthouse, a11y, uptime).
- `direction: "max"` → breach when `metric > threshold` (load p95 ms, CU budget, error rate).
- `allowSkip: true` on a required layer downgrades a `skip` from blocker to warning — use it deliberately and rarely, with a dated reason.

## The verdict logic

A layer **fails the gate** when it is `required` AND any of:

1. `status === "fail"`, or
2. `status === "skip"` (and not `allowSkip`) — **untested = gap = block**, or
3. a metric breaches its threshold (`min`: `metric < threshold`; `max`: `metric > threshold`).

Non-required layers (e.g. L7 uptime) are evaluated identically but **only warn** — they never block. This is the exact rule in `evaluateLayer`:

```js
// tools/qa-gate/qa-gate.mjs
export function evaluateLayer(layer) {
  const { status, metric, threshold, direction = "min", required = true, allowSkip = false } = layer;
  let ok = true; const notes = [];
  if (status === "fail") { ok = false; notes.push("status=fail"); }
  if (status === "skip" && !allowSkip) { ok = false; notes.push("required layer was skipped (untested)"); }
  if (typeof metric === "number" && typeof threshold === "number") {
    const breach = direction === "max" ? metric > threshold : metric < threshold;
    if (breach) { ok = false; notes.push(`${direction} threshold breached: ${metric} vs ${threshold}`); }
  }
  const blocks = required && !ok;
  return { name: layer.name, ok, required, blocks, status, metric, threshold, direction, notes, detail: layer.detail };
}
```

The roll-up:

```js
export function qaGate(manifest) {
  const results  = (manifest.layers || []).map(evaluateLayer);
  const blockers = results.filter((r) => r.blocks);     // required && !ok
  const warnings = results.filter((r) => !r.ok && !r.blocks); // non-required && !ok
  return { release: manifest.release || "(unversioned)", pass: blockers.length === 0, results, blockers, warnings };
}
```

`pass` is true **iff zero blockers**. `toReport(gate)` renders a publishable markdown table (✅ / ⚠️ / 🔴 per layer, a verdict line, and a Blockers section). Exports: `evaluateLayer`, `qaGate(manifest) -> { pass, results, blockers, warnings }`, `toReport(gate)`.

## Green manifest → RELEASE ALLOWED

Every required layer passes; a breached non-required `uptime` would warn but here it is green too. From [`../examples/release-gate/manifest-green.json`](../examples/release-gate/manifest-green.json):

```json
{
  "release": "v1.2.0-rc",
  "layers": [
    { "name": "unit",         "status": "pass", "required": true },
    { "name": "integration",  "status": "pass", "required": true },
    { "name": "e2e",          "status": "pass", "required": true, "detail": "Playwright: 18 flows green" },
    { "name": "contract",     "status": "pass", "required": true, "detail": "anchor/foundry tests green" },
    { "name": "formal",       "status": "pass", "required": true, "detail": "halmos: no counterexamples" },
    { "name": "coverage",     "status": "pass", "metric": 0.86, "threshold": 0.80, "direction": "min", "required": true },
    { "name": "lighthouse",   "status": "pass", "metric": 0.93, "threshold": 0.90, "direction": "min", "required": true },
    { "name": "a11y",         "status": "pass", "metric": 0.98, "threshold": 0.95, "direction": "min", "required": true },
    { "name": "load-p95ms",   "status": "pass", "metric": 420,  "threshold": 500,  "direction": "max", "required": true },
    { "name": "security",     "status": "pass", "required": true, "detail": "gitleaks + slither/cargo-audit clean" },
    { "name": "uptime",       "status": "pass", "metric": 99.95, "threshold": 99.9, "direction": "min", "required": false }
  ]
}
```

```
$ node tools/qa-gate/qa-gate.mjs examples/release-gate/manifest-green.json
QA gate: v1.2.0-rc — PASS ✅
```

Exit 0.

## Blocked manifest → RELEASE BLOCKED (5 distinct blocker classes)

One manifest, five different ways to fail, proving each rule fires. From [`../examples/release-gate/manifest-blocked.json`](../examples/release-gate/manifest-blocked.json):

```json
{
  "release": "v1.3.0-rc",
  "layers": [
    { "name": "unit",         "status": "pass", "required": true },
    { "name": "integration",  "status": "pass", "required": true },
    { "name": "e2e",          "status": "fail", "required": true, "detail": "Playwright: connect-wallet flow broke" },
    { "name": "contract",     "status": "pass", "required": true },
    { "name": "formal",       "status": "skip", "required": true, "detail": "halmos not run this release" },
    { "name": "coverage",     "status": "pass", "metric": 0.74, "threshold": 0.80, "direction": "min", "required": true },
    { "name": "lighthouse",   "status": "pass", "metric": 0.81, "threshold": 0.90, "direction": "min", "required": true },
    { "name": "a11y",         "status": "pass", "metric": 0.97, "threshold": 0.95, "direction": "min", "required": true },
    { "name": "load-p95ms",   "status": "pass", "metric": 640,  "threshold": 500,  "direction": "max", "required": true },
    { "name": "security",     "status": "pass", "required": true },
    { "name": "uptime",       "status": "pass", "metric": 99.4,  "threshold": 99.9, "direction": "min", "required": false }
  ]
}
```

```
$ node tools/qa-gate/qa-gate.mjs examples/release-gate/manifest-blocked.json
QA gate: v1.3.0-rc — BLOCKED 🔴
  🔴 e2e: status=fail
  🔴 formal: required layer was skipped (untested)
  🔴 coverage: min threshold breached: 0.74 vs 0.8
  🔴 lighthouse: min threshold breached: 0.81 vs 0.9
  🔴 load-p95ms: max threshold breached: 640 vs 500
  ⚠️  uptime (non-blocking): min threshold breached: 99.4 vs 99.9
```

Exit 1. The five blocker classes: **failed e2e**, **skipped formal** (untested), **sub-floor coverage**, **sub-floor lighthouse**, **over-budget load p95**. The breached non-required `uptime` warns only — observability, not a merge gate (see [uptime-keeper.md](uptime-keeper.md)). This is exercised by [`../examples/release-gate/gate.test.mjs`](../examples/release-gate/gate.test.mjs) (`node --test`, 6/6 pass).

## The evidence rule — green badge with no CI run behind it is RED

A manifest entry is a **claim**. The gate trusts the manifest; the evidence rule is what makes the manifest trustworthy. **Every claimed pass carries three artifacts, or it is treated as a failure:**

1. A **real finalized tx signature** — read back from chain, `confirmationStatus: "finalized"` (Solana) / `status=1` receipt (EVM). Not a UI toast, not a hardcoded constant.
2. An **audited screenshot** — the before-state, the wallet approve/sign popup, and the result-state, captured at the real viewport(s).
3. The **on-chain read** — the ground-truth account/balance/root fetched from the program, matching what the UI claimed.

Corollaries, enforced as hard rules:

- A **green badge with no CI run behind it is RED.** A `status: "pass"` that no workflow produced is fabrication. The manifest is emitted *by CI jobs*, never hand-edited (see the anti-honesty-theater pattern in [ci-wiring.md](ci-wiring.md) — a CI-written status file that a test fails if hand-edited).
- A fabricated number presented as real is an automatic NO-GO. Honest `pending`/`null`/`0`/`not indexed yet` is a valid state; a fake-zero is a finding.
- `skip` is never silently upgraded to `pass`. Untested is untested.

## Wiring — the final CI step

The gate is the last job, `needs:` every layer job, each of which writes its manifest entry. Run it and fail the PR on non-zero exit:

```yaml
  gate:
    name: QA release gate
    runs-on: ubuntu-latest
    needs: [lint, unit, formal, integration, e2e, load, lighthouse, security]
    permissions: { contents: read }
    steps:
      - uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7
      - uses: actions/download-artifact@... # collect each layer's manifest fragment
        with: { path: manifest-parts }
      - name: Assemble manifest
        run: node tools/qa-gate/assemble.mjs manifest-parts/ > qa-manifest.json
      - name: Gate (exit 1 blocks the PR)
        run: node tools/qa-gate/qa-gate.mjs qa-manifest.json --report QA_PROOF.md
      - name: Upload QA proof
        if: always()
        uses: actions/upload-artifact@0b2256b8c012f0828dc542b3febcab082c67f72b # v4.3.4
        with: { name: qa-proof, path: QA_PROOF.md }
```

`--report QA_PROOF.md` writes the publishable per-layer table. The gate's exit code is the merge gate: **0 → ship, 1 → blocked.** Full layer-to-job wiring (L0–L7 each emitting an entry): [ci-wiring.md](ci-wiring.md).

## Two gates, one bar

- **This gate** (`qa-gate.mjs`) is the **machine** gate: deterministic, runs in CI, blocks the PR. It answers "did every automated layer pass?"
- The **LAUNCH-READY gate** in [human-level-qa.md](human-level-qa.md) §12 is the **human** gate: a real person drove every flow with a real wallet, saw only honest data, hit no dead control, and captured evidence. It answers "is this actually usable and honest?"

Both must be green to ship. The machine gate keeps regressions out; the human gate keeps honesty-theater and dead-but-green surfaces out. A build that passes `qa-gate.mjs` but fails the human LAUNCH-READY gate is **not** launch-ready — and vice versa.

---

_Last verified: June 2026_
