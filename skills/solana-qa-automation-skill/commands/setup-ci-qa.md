---
description: Emit SHA-pinned, least-privilege GitHub Actions workflows for each applicable QA layer (lint, unit, formal/kani, e2e, k6 load, lighthouse, gitleaks, uptime) plus the final qa-gate step, and a gitleaks config with the base58/id.json backstop.
argument-hint: [--layers lint,unit,formal,e2e,load,lighthouse,security,uptime]
---

Wire this dApp's QA pyramid into CI. One job per applicable layer, each emitting a manifest entry, rolled up by a final `qa-gate` job. Conventions and the full per-layer detail: [../skill/ci-wiring.md](../skill/ci-wiring.md), [../skill/model.md](../skill/model.md).

## First: decide which layers apply

Inspect the repo and select from L0–L7. Every dApp gets L0/L1/L3/L5/L6; DeFi/program-heavy repos add L1-formal/L2/L4/L7. Map per [../skill/model.md](../skill/model.md). Delegate program-runtime testing to [../solana-testing](../solana-testing/SKILL.md) and represent its result as the `contract` manifest layer.

## Non-negotiable CI hygiene (every workflow)

- **`permissions: {}` at the top level**, then grant the minimum per job (`contents: read`; `fetch-depth: 0` only for the secrets-history scan). Least privilege.
- **SHA-pin every action** (full 40-char commit SHA + `# vX.Y.Z` comment) — never a floating tag.
- Multi-line `run:` steps under `set -euo pipefail` so the first failure aborts and a piped failure can't show green.
- Concrete `timeout-minutes` per job; upload evidence artifacts on failure.

## Layer workflows to emit

| Layer | Job | Gates on |
|---|---|---|
| L0 lint | `cargo fmt --check`; `cargo clippy --workspace --all-targets -- -D warnings`; `anchor build`; `tsc --noEmit`; ESLint; banned-words | any diff/warning/error |
| L1 unit | `vitest run`; `cargo test --workspace`; program tests → solana-testing | any failing spec |
| L1 formal | `cargo kani` per crate + **proof-count anti-erosion gate** vs `docs/kani-baseline.txt` | counterexample, or proof count below baseline |
| L3 e2e | Playwright + **Synpress/Phantom**; build `.cache-synpress`; `xvfb-run` (extension needs a display); `local` per-PR, `live` (devnet, finalized-sig) nightly + founder-gated | flow fail; `live` with no finalized signature = fail (not skip) |
| L4 load | **k6** thresholds (`http_req_duration p(95)`, `http_req_failed rate`) against the RPC; CU/rent budget probe | threshold breach — `schedule:` nightly |
| L5 lighthouse | `@lhci/cli` `lhci autorun`, `minScore 0.90` | below 0.90 (soft-gate now → harden when prod URL lands; carry a dated TODO) |
| L6 security | **gitleaks** full history (`fetch-depth: 0`) + base58/`id.json` backstop + `cargo-audit` | any finding |
| L7 uptime | **Upptime** RPC `getHealth`/slot-lag, keeper freshness | **observability only — never gates a PR**; alerts via Discord |
| GATE | `node tools/qa-gate/qa-gate.mjs qa-manifest.json --report QA_PROOF.md` — `needs:` every layer | any required layer fail **or skip** |

Skeleton for the e2e workflow (mirror this shape for every layer — name the job for what it actually runs):

```yaml
name: E2E (Phantom real-wallet — local pending-UI)
on:
  pull_request: { paths: ['apps/web/**', 'tests/e2e/**'] }
  schedule: [{ cron: '0 3 * * *' }]
  workflow_dispatch: {}
permissions: {}
jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    permissions: { contents: read }
    steps:
      - uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7
      - uses: actions/setup-node@1e60f620b9541d16bece96c5465dc8ee9832be0b # v4.0.3
        with: { node-version: 20 }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: npx synpress test/wallet-setup --phantom
        env: { E2E_PHANTOM_SEED: ${{ secrets.E2E_PHANTOM_SEED }}, E2E_PHANTOM_PASSWORD: ${{ secrets.E2E_PHANTOM_PASSWORD }} }
      - run: xvfb-run -a pnpm exec playwright test --project=chromium-desktop
      - if: failure()
        uses: actions/upload-artifact@0b2256b8c012f0828dc542b3febcab082c67f72b # v4.3.4
        with: { name: e2e-evidence, path: evidence/, retention-days: 30 }
```

## gitleaks config (Solana backstop)

Emit `.gitleaks.toml` extending the default ruleset with Solana-specific secret patterns the stock rules miss:

- An **`id.json` byte-array keypair** committed to source — a `[NNN,NNN,…]` 64-int array. The backstop greps tracked files for that shape in key contexts.
- **base58 secret keys** (~87–88 base58 chars) outside the allowlist.

Path-exclude test fixtures, seed files, and `*.env.example` to avoid false positives. This backstop is a follow-up to real incidents where a deployer key leaked into a temp log. Run gitleaks over **full history** (`fetch-depth: 0`), not just the diff. Detail: [../skill/security-secrets.md](../skill/security-secrets.md).

## Final wiring

The `qa-gate` job `needs:` every layer job, collects their manifest entries into `qa-manifest.json`, and runs `node tools/qa-gate/qa-gate.mjs qa-manifest.json --report QA_PROOF.md`. Its non-zero exit fails the PR. Required layers that `fail` **or `skip`** block; non-required (uptime) warn. For the evidence-backed go/no-go, route the manifest through the **release-gatekeeper** agent. Soft-gated layers (lighthouse) must carry a dated TODO to harden — see [../rules/release-gate.rules.md](../rules/release-gate.rules.md).
