# L4 — Load + Compute

The load layer. Two questions, one job: **does the API hold its latency/error SLO under arrival-rate load**, and **does each on-chain action stay inside its CU/rent budget**. k6 owns the first (pass/fail via thresholds in its own exit code); a simulate-and-read CU probe owns the second (recorded as **data**, not a hard gate — budget regressions surface in the report, not the build).

Grounded in `.github/workflows/loadtest-nightly.yml` ("Atrium loadtest, nightly k6 + gas") from the Arbitrum/Stylus source repo. The Solana mapping keeps the k6 API profile verbatim and **adds** RPC-method load + a CU/rent probe where the EVM repo had `contract-gas.mjs`.

## What the real workflow does

```yaml
# .github/workflows/loadtest-nightly.yml
on:
  schedule:
    - cron: '0 2 * * *'        # nightly, 02:00 UTC
  workflow_dispatch:            # manual trigger
permissions: {}                 # default-deny; job re-grants the minimum
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: false     # never cancel a load run mid-flight

jobs:
  loadtest:
    timeout-minutes: 60
    permissions:
      contents: write           # only to open the CI-data PR
      pull-requests: write
    env:
      BASE_URL: ${{ secrets.LOADTEST_BASE_URL || 'https://useatrium.me' }}
      LOADTEST_PROFILE: ${{ secrets.LOADTEST_PROFILE || 'smoke' }}
```

Step order: install k6 (apt, GPG-keyed repo) → `k6 run scripts/api-load.k6.js` (latency probe) → `node scripts/contract-gas.mjs` (gas/budget estimation) → `node scripts/build-report.mjs` (roll-up) → open a PR writing `apps/verify/public/loadtest/latest.json` (only on `main`/`master`, `continue-on-error: true`) → `upload-artifact` (`if: always()`) of `summary.export.json` + `gas-report.json` + `latest.json` → Discord notify `if: failure()`.

Key design points, copy them:
- **Nightly cron `0 2 * * *`** plus `workflow_dispatch`. Load is expensive and noisy — run it off the PR hot path, on a schedule, against a deployed env. The PR-blocking gate ([release-gate.md](release-gate.md)) consumes the last run's manifest entry; it does not run k6 inline.
- **`cancel-in-progress: false`** — a half-cancelled load test produces garbage percentiles. Let it finish.
- **CI-as-data**: results are committed back as `latest.json` via an automated PR and uploaded as artifacts, so the dashboard and the gate read a real file, not a log scrape.
- **`profile` is an env knob** (`smoke` default, `full` for pre-release) so the same script scales from a CI sanity check to a real soak.

## k6: arrival-rate, custom Trends, profiles, summary export

k6's `constant-arrival-rate` executor is the correct model for an API: it holds a fixed **request rate** regardless of how slow responses get (open model), which is what a real RPC/API faces — unlike `constant-vus`, which silently throttles offered load when the system slows (closed model, hides the regression you're hunting). Custom `Trend` metrics tag latency per logical operation so a slow `sendTransaction` doesn't hide behind a fast `getAccountInfo`. `handleSummary` writes the machine-readable roll-up the gate ingests.

```javascript
// services/loadtest/scripts/api-load.k6.js
import http from 'k6/http';
import { check } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const apiLatency = new Trend('api_latency_ms', true);
const rpcLatency = new Trend('rpc_latency_ms', true);
const rpcErrors  = new Rate('rpc_errors');

const BASE_URL  = __ENV.BASE_URL  || 'https://useatrium.me';
const RPC_URL   = __ENV.RPC_URL   || 'https://api.devnet.solana.com';
const PROFILE   = __ENV.LOADTEST_PROFILE || 'smoke';

// smoke = CI sanity; full = pre-release soak. Same script, env-selected.
const PROFILES = {
  smoke: { rate: 20,  duration: '1m',  preAllocatedVUs: 20,  maxVUs: 50  },
  full:  { rate: 200, duration: '10m', preAllocatedVUs: 200, maxVUs: 600 },
};
const P = PROFILES[PROFILE] ?? PROFILES.smoke;

export const options = {
  scenarios: {
    api: {
      executor: 'constant-arrival-rate',
      rate: P.rate, timeUnit: '1s', duration: P.duration,
      preAllocatedVUs: P.preAllocatedVUs, maxVUs: P.maxVUs,
    },
  },
  // Threshold breach => k6 exits non-zero => the run (and the gate entry) FAILS.
  thresholds: {
    http_req_duration: ['p(95)<2000'],   // p95 latency < 2000ms
    http_req_failed:   ['rate<0.02'],     // < 2% request errors
    rpc_errors:        ['rate<0.02'],
  },
};

export default function () {
  // 1) dApp API surface (chain-agnostic — identical to the EVM repo)
  const api = http.get(`${BASE_URL}/api/health`);
  apiLatency.add(api.timings.duration);
  check(api, { 'api 200': (r) => r.status === 200 });

  // 2) RPC-method load — the Solana addition. getAccountInfo = cheap read,
  //    sendTransaction = the expensive write path. Hit a real provider.
  const headers = { 'Content-Type': 'application/json' };
  const accInfo = http.post(RPC_URL, JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'getAccountInfo',
    params: ['SysvarC1ock11111111111111111111111111111111', { encoding: 'base64' }],
  }), { headers });
  rpcLatency.add(accInfo.timings.duration);
  rpcErrors.add(accInfo.status !== 200 || !!accInfo.json('error'));
  check(accInfo, { 'rpc 200': (r) => r.status === 200 });
}

// summary.export.json is the artifact the report + release gate read.
export function handleSummary(data) {
  return { 'summary.export.json': JSON.stringify(data, null, 2) };
}
```

Run it exactly as CI does:

```bash
cd services/loadtest
BASE_URL=https://useatrium.me RPC_URL=$SOLANA_RPC_URL LOADTEST_PROFILE=smoke \
  k6 run scripts/api-load.k6.js
echo "exit=$?"   # 0 = all thresholds held; non-zero = at least one breached
```

### The thresholds are the gate

Two thresholds, copied verbatim from the model. A breach of either makes **k6's process exit non-zero**, which fails the CI step, which makes this layer's release-manifest entry `fail` — and [release-gate.md](release-gate.md) blocks the release on it.

| Threshold | Meaning | Breach |
|-----------|---------|--------|
| `http_req_duration: ['p(95)<2000']` | 95th-percentile request latency under 2000 ms | p95 ≥ 2000 ms → run fails |
| `http_req_failed: ['rate<0.02']` | request error rate under 2% | rate ≥ 0.02 → run fails |

Do **not** soften a threshold to make a red run green. If load regressed, the build is supposed to be red — that is the whole point of the layer. Ratchet thresholds *down* as the system gets faster (anti-erosion), never up to hide a regression.

## Solana mapping: same k6, plus RPC load, plus a CU/rent probe

The EVM repo loaded a dApp API and estimated **contract gas**. On Solana:

1. **dApp API load — unchanged.** The `BASE_URL` API scenario above is chain-agnostic. Keep it verbatim.
2. **RPC-method load — added.** Solana has no gas-priced mempool to load; the throughput surface is the **RPC provider**. Load `getAccountInfo` (the dominant read) and `sendTransaction` (the write path) against your real provider (Helius/Triton/QuickNode/own node), tagged with their own `Trend`s so each method's p95 is visible. Mind provider rate limits — use a dedicated load-tier endpoint, not the public `api.mainnet-beta.solana.com`, which will 429 and pollute `rpc_errors`.
3. **`contract-gas.mjs` → CU/rent budget probe.** EVM gas budget maps to the **compute-unit budget** (200k CU default per ix, 1.4M CU max per tx) plus **rent-exemption lamports** per account created. This is recorded as **data**, not a k6 threshold — a budget regression shows up in the report and trends over nights; it does not (by default) hard-fail the load run.

### CU/rent probe — simulate, read `unitsConsumed`

`simulateTransaction` returns `unitsConsumed` without paying fees or touching state. That is the CU number. Rent comes from `getMinimumBalanceForRentExemption(dataLen)`.

```javascript
// services/loadtest/scripts/cu-rent-probe.mjs  (the Solana contract-gas.mjs)
import { Connection, PublicKey } from '@solana/web3.js';
import fs from 'node:fs';

const conn = new Connection(process.env.SOLANA_RPC_URL, 'confirmed');

// Build the tx you want to budget (signed or with sigVerify:false).
// tx = ... your VersionedTransaction / Transaction for the instruction under test

const sim = await conn.simulateTransaction(tx, {
  sigVerify: false,
  replaceRecentBlockhash: true,
});
const unitsConsumed = sim.value.unitsConsumed ?? null;   // <-- the CU number
const logs = sim.value.logs ?? [];

// Rent floor for each account size the program creates.
const ACCOUNT_SIZES = { vault: 165, position: 256 };
const rent = {};
for (const [name, len] of Object.entries(ACCOUNT_SIZES)) {
  rent[name] = await conn.getMinimumBalanceForRentExemption(len); // lamports
}

const CU_LIMIT = 200_000;                                  // per-ix default budget
const report = {
  ts: new Date().toISOString(),
  unitsConsumed,
  cuBudget: CU_LIMIT,
  cuHeadroomPct: unitsConsumed == null ? null
    : +(100 * (CU_LIMIT - unitsConsumed) / CU_LIMIT).toFixed(1),
  rentLamports: rent,
  simError: sim.value.err ?? null,
};
fs.writeFileSync('gas-report.json', JSON.stringify(report, null, 2));
console.log(`CU: ${unitsConsumed}/${CU_LIMIT} (${report.cuHeadroomPct}% headroom)`);
```

Wire it where the EVM repo ran `contract-gas.mjs`:

```yaml
      - name: CU / rent budget probe
        working-directory: services/loadtest
        env:
          SOLANA_RPC_URL: ${{ secrets.SOLANA_RPC_URL }}
        run: node scripts/cu-rent-probe.mjs
```

`gas-report.json` rides the same `upload-artifact` + `latest.json` PR path as the k6 summary, so CU/rent trends are visible night-over-night. If you *do* want CU to gate (a hard per-ix budget), assert `unitsConsumed < CU_LIMIT` in the probe and exit non-zero — but that is a deliberate choice; the source repo keeps gas as data. CU-regression benchmarking with a ratcheting floor belongs to the program-test layer — delegate it to [../solana-testing](../solana-testing/cu-benchmarking.md).

## Checklist

- [ ] Nightly cron `0 2 * * *` + `workflow_dispatch`; `cancel-in-progress: false`; `permissions: {}` then minimal re-grant.
- [ ] k6 `constant-arrival-rate` (open model), `smoke`/`full` profiles via `LOADTEST_PROFILE`.
- [ ] Thresholds `http_req_duration p(95)<2000` + `http_req_failed rate<0.02` — breach exits non-zero, fails the run, blocks via the gate.
- [ ] Custom `Trend`s per operation (API vs `getAccountInfo` vs `sendTransaction`); `handleSummary` → `summary.export.json`.
- [ ] RPC load against a dedicated provider tier (not the public endpoint).
- [ ] CU/rent probe via `simulateTransaction` → `unitsConsumed` + `getMinimumBalanceForRentExemption`, recorded as data in `gas-report.json`.
- [ ] Artifacts uploaded `if: always()`; `latest.json` committed back as CI-data; Discord notify `if: failure()`.

See also: [release-gate.md](release-gate.md) · [model.md](model.md) · [../solana-testing](../solana-testing/cu-benchmarking.md).

_Last verified: June 2026_
