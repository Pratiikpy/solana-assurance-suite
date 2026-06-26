# L7 — Uptime, Keeper Freshness & Indexer Drift

**This layer is OBSERVABILITY, not a PR gate.** It alerts (Discord, status badge) and feeds the dashboard. In the release manifest it is a **non-required** layer — a breach **warns, never blocks** (see [release-gate.md](release-gate.md), [model.md](model.md) L7). The job here is to know — within minutes, not at the next deploy — that an RPC is down, the indexer fell behind, or an on-chain freshness value (a Pyth push, a Switchboard feed, a crank, an attestation root) drifted past its staleness window.

Three independent mechanisms, all on schedules, all reverse-engineered from a production Arbitrum/Stylus monorepo and mapped onto Solana.

## 1. Upptime — 5-minute probe → auto-opened issues → status site

[Upptime](https://upptime.js.org) is a GitHub-native uptime monitor: a workflow probes a list of URLs every 5 minutes, commits response-time/uptime history into the repo, **auto-opens a GitHub issue** when a site goes down (and closes it on recovery), and publishes a static status site. The probe workflow is tiny — the action does the work:

```yaml
# .github/workflows/upptime.yml
name: Upptime
on:
  schedule:
    - cron: "*/5 * * * *"      # the probe cadence; Upptime tolerates throttling here
  workflow_dispatch:
permissions:
  contents: write              # commit history back to the repo
  issues: write                # auto-open/close incident issues
concurrency:
  group: upptime
  cancel-in-progress: false    # never cancel an in-flight probe
jobs:
  upptime:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7
      - uses: upptime/uptime-monitor@75b0413ab8fd16c2c9be1048818805d67f53ac2f # v1.38.0
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
      - name: Notify Discord on failure
        if: failure()
        uses: Ilshidur/action-discord@0c4b27844ba47cb1c7bee539c8eead5284ce9fa9 # v0.3.2
        env:
          DISCORD_WEBHOOK: ${{ secrets.DISCORD_OPS_WEBHOOK }}
        with:
          args: "Upptime monitor workflow failed - check https://github.com/${{ github.repository }}/actions/runs/${{ github.run_id }}"
```

The sites and the status-site config live in `.upptimerc.yml`. Note the per-check schedules, the **POST probe with a GraphQL body** for a subgraph/indexer health endpoint, and the `$VAR` URL interpolated from a secret:

```yaml
# .upptimerc.yml
owner: atrium-protocol
repo: atrium
workflowSchedule:
  summary: "*/5 * * * *"       # the live tile refresh
sites:
  - name: Verify (production)
    url: https://useatrium.me
  - name: Codex API
    url: https://codex.useatrium.me/healthz
  - name: Scribe (subgraph)        # POST a GraphQL _meta query at the indexer
    url: $SCRIBE_URL
    method: POST
    headers: [ "Content-Type: application/json" ]
    body: '{"query":"{ _meta { block { number } } }"}'
  - name: Lantern Attestor
    url: https://lantern-attestor.useatrium.me/api/cron
    method: GET
status-website:
  cname: status.useatrium.me
  name: Atrium status
  introMessage: Live uptime for Atrium services. Updates every 5 minutes.
```

**Solana mapping.** Replace the EVM/HTTP health endpoints with Solana liveness probes:

- **RPC health** — POST `getHealth` (returns `"ok"` or an error) and `getSlot` to your RPC; alert if it errors or slot stops advancing. A static endpoint that returns the slot works as an Upptime POST site:
  ```yaml
  - name: RPC getHealth
    url: $SOLANA_RPC_URL
    method: POST
    headers: [ "Content-Type: application/json" ]
    body: '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
  - name: RPC getSlot
    url: $SOLANA_RPC_URL
    method: POST
    headers: [ "Content-Type: application/json" ]
    body: '{"jsonrpc":"2.0","id":1,"method":"getSlot"}'
  ```
- **Program-account existence** — a tiny `/healthz` route (or a serverless function) that does `getAccountInfo(programId)` + a key PDA and 200s only if both exist with the expected owner; Upptime probes the route.
- **Indexer slot-lag** — a route that returns the indexer's last-processed slot vs `getSlot`; 200 only if lag ≤ threshold (mirrors the Scribe `_meta.block.number` POST probe above, with slot in place of block number).

## 2. The self-looping keeper — beat GitHub's cron throttling

The trap: **GitHub throttles scheduled workflows.** A `*/30` cron does not fire every 30 minutes under load — it fires *hours apart*. If your on-chain freshness window is shorter than the real cron gap, your data goes stale and trades revert / proofs expire / cranks miss. The fix used in production: **the cron only (re)starts the job; a single CI run self-loops for ~5.3–5.5h**, doing the work on a tight in-run interval, keeping the on-chain value inside its staleness window for the whole run. The next cron fire (whenever it lands) starts a fresh loop. `concurrency` ensures runs never stack.

The Pyth price keeper — pushes a fresh oracle price every ~30s for ~5.5h to stay inside Plinth's 60s staleness gate:

```yaml
# .github/workflows/pyth-keeper.yml
name: pyth-keeper
on:
  schedule:
    - cron: '*/30 * * * *'        # RESTART cadence only — GH throttles this, fires hours apart
  workflow_dispatch:
concurrency:
  group: pyth-keeper
  cancel-in-progress: true        # a fresh dispatch cancels the previous long-lived loop
jobs:
  keep-fresh:
    runs-on: ubuntu-latest
    timeout-minutes: 340          # GH free-tier job cap is 6h; stay under it
    steps:
      - uses: actions/checkout@v4
      - uses: foundry-rs/foundry-toolchain@v1
      - name: Push fresh price every ~30s
        env:
          ARBITRUM_SEPOLIA_RPC_URL: ${{ secrets.ARBITRUM_SEPOLIA_RPC_URL }}
          DEPLOYER_PRIVATE_KEY:     ${{ secrets.PYTH_KEEPER_KEY }}
        run: |
          end=$((SECONDS + 19800))  # ~5.5h, just under the job timeout
          n=0
          while [ "$SECONDS" -lt "$end" ]; do
            n=$((n + 1))
            if bash scripts/pyth-push-usdc.sh >/tmp/push.log 2>&1; then
              echo "[$n] pushed @ ${SECONDS}s"
            else
              echo "[$n] push failed (will retry next tick):"; tail -2 /tmp/push.log
            fi
            sleep 30               # 30s NOT 50s: tx-confirm latency + jitter on a 50s sleep peaked near ~56s and crossed the 60s gate
          done
          echo "loop done after $n pushes; cron will restart"
```

The cadence math is real and load-bearing: a 50s sleep + per-tx confirmation latency under jitter let on-chain price age peak near ~56s and occasionally cross the 60s contract bound (opening a window where every trade reverted `ERR_ORACLE_STALE`). A 30s sleep caps age near ~35–40s with headroom. **Match the in-run interval to the on-chain staleness bound minus confirmation latency minus jitter — not to the bound itself.**

The same pattern for a gas-costing on-chain attestation, where each tick is minutes not seconds — `lantern-cron.yml` loops ~5.33h publishing every ~45min (well inside a ~130min staleness window), and the ~130min buffer after the final publish covers the gap until the throttled cron restarts:

```yaml
# .github/workflows/lantern-cron.yml — the same self-loop, minutes-scale cadence
permissions: {}
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
jobs:
  publish:
    timeout-minutes: 350          # loops ~5.3h; GH free-tier cap is 6h
    steps:
      - run: |
          end=$((SECONDS + 19200))           # ~5.33h
          n=0
          while [ "$SECONDS" -lt "$end" ]; do
            pnpm --filter @atrium/lantern-attestor publish-now || echo "publish #$n failed; retrying next tick"
            n=$((n + 1))
            [ "$SECONDS" -lt "$end" ] && sleep 2700   # ~45min, inside the ~130min staleness window
          done
```

A lighter 5-minute tick variant (`vigil-keeper.yml`, `agents-cron.yml`) skips the in-run loop and just runs once per cron fire — fine when the staleness window is far larger than the worst-case throttle gap, or when the tick is an idempotent "poke this endpoint" rather than a freshness obligation.

**Solana mapping.** This is the keeper/crank story directly:

- **Pyth pull-oracle update** — replace `scripts/pyth-push-usdc.sh` with a `solana program`/`@pythnetwork/pyth-solana-receiver` call that posts the latest price update to the on-chain price feed account; loop on the interval that keeps the feed's `publish_time` inside your program's `maximum_age` (the Solana analogue of the 60s gate — `get_price_no_older_than`).
- **Switchboard** — same shape: push/crank the aggregator so its result stays inside `maxStaleness`.
- **Any crank** — a program that needs periodic `crank`/`settle`/`update` instructions (AMM TWAP, perp funding, vault harvest) is a self-looping keeper: loop `cast`-equivalent `solana`/`anchor` ix sends inside the cadence the program tolerates.
- Fund a **dedicated throwaway keeper keypair** (low balance, rotated); never the deployer. The secret is the keeper key only.

## 3. Indexer drift / reconcile — freshness AND value AND manifest agreement

Two distinct failure modes, two distinct guards. **Slot-lag** is freshness ("is the indexer keeping up?"). **Drift** is correctness ("is the indexer pointed at the right addresses, and does its data match the chain?"). The cutover-drift class — a subgraph indexing address B while the app points at A — *looks live and is silently wrong*. Both run on a 15-min cron and **alert; they do not gate a PR**:

```yaml
# .github/workflows/subgraph-health.yml
name: Subgraph health check
on:
  schedule:
    - cron: '*/15 * * * *'
  workflow_dispatch: {}
permissions:
  contents: read
concurrency:
  group: subgraph-health
  cancel-in-progress: true
jobs:
  check:
    steps:
      - uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7
      - uses: actions/setup-node@1e60f620b9541d16bece96c5465dc8ee9832be0b # v4.0.3
        with: { node-version: 20 }
      - name: Check health (block-lag)            # freshness guard
        env: { SCRIBE_URL: ${{ secrets.SCRIBE_URL }}, ARBITRUM_SEPOLIA_RPC: ${{ secrets.ARBITRUM_SEPOLIA_RPC }} }
        run: node scripts/check-scribe-health.mjs
      - uses: foundry-rs/foundry-toolchain@8f1998e9878d786675189ef566a2e4bf24869773 # v1.2.0  # `cast` for on-chain reads
      - name: Reconcile chain <-> indexer <-> deployment manifests (drift guard)
        env: { SCRIBE_URL: ${{ secrets.SCRIBE_URL }}, ARBITRUM_SEPOLIA_RPC: ${{ secrets.ARBITRUM_SEPOLIA_RPC }} }
        run: node scripts/reconcile-chain-scribe.mjs
      - name: Alert on health/reconcile failure
        if: failure()
        env: { DISCORD_OPS_WEBHOOK: ${{ secrets.DISCORD_OPS_WEBHOOK }} }
        run: |
          [ -z "$DISCORD_OPS_WEBHOOK" ] && { echo "no webhook; skipping"; exit 0; }
          curl -s -X POST "$DISCORD_OPS_WEBHOOK" -H "Content-Type: application/json" \
            -d '{"content":"⚠️ Subgraph health or chain/indexer reconcile failed (block-lag or address drift)."}'
```

**Freshness guard** (`check-scribe-health.mjs`): query the indexer's `_meta.block.number`, compare to chain tip, alert if `lagBlocks > 200` **on two consecutive checks 5s apart** (one transient lag spike is not an incident; sustained lag is). Exit non-zero → the alert step fires.

**Drift guard** (`reconcile-chain-scribe.mjs`) reconciles three sources and exits non-zero on any disagreement:

1. **Freshness** — `_meta.block` within LAG of tip and `hasIndexingErrors == false`.
2. **Value** — the indexer's latest attested root **equals** the on-chain `latest_root()` (data matches the contract, not just keeps up).
3. **Manifest integrity** — *every* address the indexer's manifest indexes is also present in the canonical deployment registry **and** the web-bundle mirror **and has non-empty on-chain code**. An indexer pointed at a dead/old address fails here.

```js
// reconcile-chain-scribe.mjs — manifest integrity (the cutover-drift guard)
const manifestAddrs = [...manifest.matchAll(/address:\s*"(0x[0-9a-fA-F]{40})"/g)].map((m) => m[1].toLowerCase());
for (const a of [...new Set(manifestAddrs)]) {
  const inRoot  = rootDeploy.includes(a);                 // canonical deployments/<net>.json
  const inWeb   = webDeploy ? webDeploy.includes(a) : true;// apps/.../public/deployments mirror
  const hasCode = (cast(['code', a]) || '0x') !== '0x';   // on-chain code present
  if (inRoot && inWeb && hasCode) ok(`addr present + has code: ${a}`);
  else bad(`addr ${a}: inRoot=${inRoot} inWeb=${inWeb} hasCode=${hasCode} (drift / dead address)`);
}
```

**Solana mapping.**

- **Block-lag → slot-lag.** Replace `eth_blockNumber` with `getSlot`; compare to the indexer's last-processed slot. Two-consecutive-check debounce unchanged.
- **EVM event-log indexing → Solana program-log / Anchor-event / account-change indexing** (Geyser, Helius webhooks, a custom log parser). See [model.md](model.md) L2 and `integration-indexer.md`.
- **Address drift → program-id and PDA drift.** Reconcile every account the indexer subscribes to against the deployment manifest: each must be in the canonical `deployments/<cluster>.json`, mirrored in the web bundle, and exist on-chain with the **expected owner program** (the Solana analogue of "has non-empty code" — `getAccountInfo(pda).owner === programId`). A PDA derived from the wrong program id or seeds is the cutover-drift bug.
- **Value reconciliation → account-state equality.** The on-chain `latest_root()` read becomes a `getAccountInfo` + Borsh/Anchor deserialize of the relevant account, compared field-for-field against the indexed copy.

## What this layer feeds the gate

One **non-required** manifest entry, e.g. `{ "name": "uptime", "status": "pass", "metric": 99.95, "threshold": 99.9, "direction": "min", "required": false }`. A breach warns in `QA_PROOF.md` and pings Discord — it does **not** block the release. Gate semantics and the evidence rule: [release-gate.md](release-gate.md). Where this sits in the pyramid: [model.md](model.md). CI cross-cutting patterns (SHA-pinning, `permissions:{}`, Discord alerts, concurrency): [ci-wiring.md](ci-wiring.md).

---

_Last verified: June 2026_
