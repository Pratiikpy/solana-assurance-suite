# L5 — Lighthouse Perf / a11y

The rendered-app quality layer: `@lhci/cli` runs Lighthouse against the built frontend across categories — performance, accessibility, best-practices, SEO — and asserts a `minScore`, plus a handful of **hard audits** (color-contrast, tap-targets, CLS) that no aggregate score can paper over. **Fully chain-agnostic**: Lighthouse audits a DOM and a network waterfall; it neither knows nor cares whether the chain underneath is Solana or EVM. This layer is **identical on a Solana dApp** — no mapping.

Grounded in `.lighthouserc.json` and the `frontend` job of `.github/workflows/ci.yml` from the source repo.

## What the real config asserts

```json
// .lighthouserc.json
{
  "ci": {
    "collect": {
      "startServerCommand": "pnpm --filter @atrium/verify start --port 3000",
      "startServerReadyPattern": "ready",
      "startServerReadyTimeout": 60000,
      "url": [
        "http://localhost:3000/",
        "http://localhost:3000/verify/1",
        "http://localhost:3000/app/vault",
        "http://localhost:3000/lantern"
      ],
      "numberOfRuns": 3,
      "settings": {
        "preset": "desktop",
        "emulatedFormFactor": "mobile",
        "throttlingMethod": "devtools",
        "onlyCategories": ["performance", "accessibility", "best-practices", "seo"],
        "skipAudits": ["uses-http2", "redirects-http"]
      }
    },
    "assert": {
      "preset": "lighthouse:no-pwa",
      "assertions": {
        "categories:performance":     ["error", { "minScore": 0.90 }],
        "categories:accessibility":   ["error", { "minScore": 0.90 }],
        "categories:best-practices":  ["error", { "minScore": 0.90 }],
        "categories:seo":             ["error", { "minScore": 0.90 }],
        "color-contrast": "error",
        "tap-targets":    "error",
        "image-alt":      "error",
        "label":          "error",
        "valid-lang":     "error",
        "html-has-lang":  "error",
        "meta-description":       "warn",
        "uses-text-compression":  "warn",
        "unused-javascript":      ["warn", { "maxLength": 1 }],
        "unminified-javascript":  "warn",
        "total-byte-weight":      ["warn", { "maxNumericValue": 1500000 }],
        "first-contentful-paint":  ["warn", { "maxNumericValue": 2500 }],
        "largest-contentful-paint":["warn", { "maxNumericValue": 4000 }],
        "cumulative-layout-shift": ["error", { "maxNumericValue": 0.1 }]
      }
    },
    "upload": { "target": "temporary-public-storage" }
  }
}
```

Read the design:
- **`numberOfRuns: 3`** — Lighthouse scores are noisy; LHCI reports the **median** of 3 runs, so a single unlucky GC pause can't flip a gate.
- **`throttlingMethod: "devtools"`** with `emulatedFormFactor: "mobile"` — audits the realistic mobile experience, not an unthrottled desktop best case.
- **`error` vs `warn` is the gate vs. the radar.** `error`-level assertions fail the run; `warn`-level ones print but never fail. The four category `minScore: 0.90`s plus the hard audits are `error`; byte-weight / FCP / LCP / unused-JS are `warn` (tracked, not blocking).
- **Hard audits over aggregate score.** `color-contrast`, `tap-targets`, and `cumulative-layout-shift` (CLS, `maxNumericValue: 0.1`) are `error`-level *on their own* — a 0.91 accessibility score does not buy you a contrast failure. Plus `image-alt`, `label`, `valid-lang`, `html-has-lang` for a11y semantics.
- **`preset: "lighthouse:no-pwa"`** — this is a dApp, not an installable PWA; skip the PWA assertions rather than fail them.
- **`skipAudits: ["uses-http2", "redirects-http"]`** — these are properties of the *local* `startServerCommand` server (HTTP/1.1, no TLS redirect), not the product. Skip them locally; they re-engage against the prod URL.

## The CI job — and the soft-gate-with-dated-TODO pattern

```yaml
# .github/workflows/ci.yml — frontend job
  frontend:
    name: Frontend build + Lighthouse
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7
      - uses: pnpm/action-setup@fe02b34f77f8bc703788d5817da081398fad5dd2 # v4.0.0
      - uses: actions/setup-node@1e60f620b9541d16bece96c5465dc8ee9832be0b # v4.0.3
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @atrium/verify build
      - name: Lighthouse CI (mobile)
        run: |
          npm install -g @lhci/cli
          # Phase 11: remove the || echo to enforce 0.90 threshold once useatrium.me is the LHCI URL
          lhci autorun --config=.lighthouserc.json || echo "Lighthouse below threshold (soft-fail until prod URL)"
```

### Soft-gate-with-dated-TODO

`lhci autorun` exits non-zero on any `error`-level assertion. Today the source repo runs it against a freshly built local server (`startServerCommand`), where scores are unrepresentative of production CDN/caching — so it is deliberately **soft-gated**:

```bash
lhci autorun --config=.lighthouserc.json || echo "Lighthouse below threshold (soft-fail until prod URL)"
```

The `|| echo` swallows the non-zero exit so a sub-0.90 local run does not block the PR. **This is only honest because of the comment directly above it**, which names the phase and the exact removal step:

```yaml
# Phase 11: remove the || echo to enforce 0.90 threshold once useatrium.me is the LHCI URL
```

That dated/phased TODO **is the contract**. The rule (from the cross-cutting principles): a soft-gate is acceptable *only* with a written, dated note saying what flips it to hard and when. A bare `|| true` with no comment is how a gate quietly rots into decoration. When the prod URL lands, you delete `|| echo "..."` and the comment in the same commit — `lhci autorun` now hard-fails the build below 0.90.

Until then this layer reports as a **soft-gate** in the release manifest (warn, not block); after hardening it is a required `fail`-on-breach layer like the rest. See [release-gate.md](release-gate.md).

To point LHCI at a deployed URL instead of a local server, drop `startServerCommand`/`startServerReadyPattern` and set `collect.url` to the prod URLs (or pass `LHCI_BUILD_CONTEXT` / a temporary public deploy preview). Then remove the soft-gate.

## Solana note

There is nothing to map. Lighthouse runs a headless Chrome against your rendered dApp and scores the DOM, the a11y tree, and the network/CPU profile. A Solana wallet-adapter connect button, a Phantom modal, an SPL-token balance render — all just DOM and JS to Lighthouse. The config above drops onto a Solana frontend unchanged; only `collect.url` (your routes) and the `startServerCommand` (your dev server) differ. Keep the same `minScore: 0.90`, the same hard a11y/CLS audits, and the same soft-gate-with-dated-TODO discipline.

## Checklist

- [ ] `@lhci/cli` via `lhci autorun --config=.lighthouserc.json`; `numberOfRuns: 3` (median).
- [ ] `minScore: 0.90` at `error` level on performance / accessibility / best-practices / seo.
- [ ] Hard `error` audits beyond the aggregate: `color-contrast`, `tap-targets`, `cumulative-layout-shift` (≤ 0.1), plus a11y semantics (`image-alt`, `label`, `valid-lang`, `html-has-lang`).
- [ ] `preset: "lighthouse:no-pwa"`, mobile form factor, devtools throttling.
- [ ] If soft-gated (`|| echo ...`), a **dated/phased TODO comment** directly above naming the exact removal step and trigger (prod URL). No bare `|| true`.
- [ ] On Solana: identical config; change only `collect.url` and `startServerCommand`.

See also: [release-gate.md](release-gate.md) · [model.md](model.md) · [ci-wiring.md](ci-wiring.md) · [load-perf.md](load-perf.md)

_Last verified: June 2026_
