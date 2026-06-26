# Building the Funding Graph from On-Chain Data

The funding graph is the substrate everything else runs on. Nodes are wallets; edges are
"X first funded Y" (and, for connectivity, generic transfers). Once you have it, clustering
is union-find over the edges and scoring is the signals in
[clustering-signals.md](./clustering-signals.md). This file is how you get the edges out of
Solana cheaply and correctly. For RPC/indexer choices and credit economics in depth, see
[data-sources.md](./data-sources.md).

## Step 1 — Find a wallet's first funder

Every funded Solana account has a genesis: the earliest transaction that gave it lamports.
That transaction's payer/source is the **first funder** — the single most important edge.

**Raw RPC path.** `getSignaturesForAddress` returns confirmed signatures **newest-first**,
paginated by the `before` cursor. To reach genesis you page backward until the result set is
shorter than the limit (no more history), then take the *oldest* signature and fetch that
transaction:

```ts
import { Connection, PublicKey } from "@solana/web3.js"; // or @solana/kit equivalents

async function firstFundingTx(conn: Connection, addr: PublicKey) {
  let before: string | undefined;
  let oldest: { signature: string; blockTime?: number | null } | undefined;
  for (;;) {
    const page = await conn.getSignaturesForAddress(addr, { before, limit: 1000 });
    if (page.length === 0) break;
    oldest = page[page.length - 1];        // newest-first => last item is oldest so far
    if (page.length < 1000) break;         // reached genesis
    before = oldest.signature;             // page further back
  }
  if (!oldest) return null;                 // never funded
  const tx = await conn.getTransaction(oldest.signature, { maxSupportedTransactionVersion: 0 });
  return parseFunder(tx, addr);             // who increased this account's balance first
}
```

`parseFunder` reads `meta.preBalances`/`postBalances` against `transaction.message.accountKeys`:
the account whose balance *dropped* by the amount this wallet *gained* is the funder. Capture
`{ funder, amount, fundedAt: blockTime }` — those are exactly the `funder`, `amount`,
`fundedAt` fields `sybil-scan` consumes.

**Enhanced path (faster, fewer calls).** Helius's parsed history collapses signatures +
transaction fetch + transfer parsing into one call. `getTransfersByAddress` returns
human-readable SOL/token transfers with native `direction`, `counterparty`, `amount`, and
`time` filters; `getTransactionsForAddress` (gTFA) adds reverse search so you can ask for the
*earliest* transfers directly instead of paging from the present. Prefer these over hand-rolling
`getSignaturesForAddress` loops — fewer round-trips, and gTFA supports keyset pagination
(`paginationToken` like `"315069220:308:2:1"`).

## Step 2 — Trace transfer edges and detect peeling chains

For one-hop fan-out (signal 1) the first-funder edge is enough. To catch **peeling chains**
(A→B→C→D, signal 6) walk forward from each funder, following outgoing transfers a bounded
number of hops:

```ts
async function traceChain(getTransfers, root, maxHops = 4, maxFanout = 200) {
  const edges = [];                         // {from, to, amount, t}
  let frontier = [root], seen = new Set([root]);
  for (let hop = 0; hop < maxHops && frontier.length; hop++) {
    const next = [];
    for (const node of frontier) {
      const outs = (await getTransfers(node, { direction: "out" })).slice(0, maxFanout);
      for (const x of outs) {
        edges.push({ from: node, to: x.counterparty, amount: x.amount, t: x.time });
        if (!seen.has(x.counterparty)) { seen.add(x.counterparty); next.push(x.counterparty); }
      }
    }
    frontier = next;                        // BFS, one hop per level
  }
  return edges;
}
```

**Peeling signature:** along a chain, each hop forwards (balance − fixed peel), so successive
amounts are near-constant or decrease by a fixed step, and each intermediate wallet has ~1
in / ~1 out with little else. Flag chains where consecutive `amount` values fall inside a
tight tolerance band — that's the "domino" pattern, distinct from a real wallet that fans
funds to many unrelated destinations over time.

**Bound the trace.** `maxHops` and `maxFanout` are not optional — without them a trace that
hits a CEX or DEX router explodes combinatorially and burns your entire credit budget on one
wallet (see cost section).

## Step 3 — Identify CEX deposit/withdrawal addresses

You must label exchange and infrastructure addresses, both to *tag* the CEX signal and to
*cut them out of the union-find edge set* (signal 6's trap — a shared hot wallet otherwise
merges all users into one blob).

- **Known-address lists.** Maintain a labeled set of CEX hot/withdrawal wallets and deposit
  ranges (Binance, Coinbase, Kraken, OKX, Bybit, …), bridge endpoints, DEX routers, and
  major mint authorities. Sources: provider label APIs (Helius, Nansen-style label sets),
  community-maintained lists, and your own observations. Treat it as a living allowlist of
  "hub" nodes.
- **Heuristics for unlabeled hubs.** Flag any node with extreme out-degree (thousands of
  distinct counterparties), high throughput, and a long, continuous history as a probable
  exchange/infra hub — *not* a sybil funder. A genuine sybil funder is young, funds a bounded
  set, and goes quiet; a CEX hot wallet is old, funds millions, and never stops.

Output two things per funding source: a `cex` tag (feeds the CEX signal) and an `isHub`
boolean (excludes the node from union-find edges).

## Step 4 — Union-find to form clusters

With hub nodes excluded, collapse connected components. Disjoint-set with path compression +
union by rank is O(α) per op and trivial at airdrop scale:

```ts
class DSU {
  p = new Map<string, string>(); r = new Map<string, number>();
  find(x: string): string {
    if (!this.p.has(x)) { this.p.set(x, x); this.r.set(x, 0); }
    let root = x; while (this.p.get(root) !== root) root = this.p.get(root)!;
    while (this.p.get(x) !== root) { const n = this.p.get(x)!; this.p.set(x, root); x = n; } // compress
    return root;
  }
  union(a: string, b: string) {
    const ra = this.find(a), rb = this.find(b); if (ra === rb) return;
    const da = this.r.get(ra)!, db = this.r.get(rb)!;
    if (da < db) this.p.set(ra, rb); else if (da > db) this.p.set(rb, ra);
    else { this.p.set(rb, ra); this.r.set(ra, da + 1); }
  }
}

const dsu = new DSU();
for (const e of edges) {
  if (isHub(e.from) || isHub(e.to)) continue;   // CRITICAL: never union through a hub
  dsu.union(e.from, e.to);
}
const clusters = new Map<string, string[]>();
for (const w of wallets) {
  const root = dsu.find(w.id);
  (clusters.get(root) ?? clusters.set(root, []).get(root)!).push(w.id);
}
```

Each component is a **candidate** cluster. Now hand it to the signals — compute burst, amount
uniformity, fingerprint sharing, and CEX sharing per component, and flag only on size ≥ N AND
≥ 2 corroborating signals, exactly as `tools/sybil-scan/sybil-scan.mjs` does. Union-find never
flags by itself; it only widens the candidate set so peeling chains and multi-funder masking
don't escape grouping. See [clustering-signals.md](./clustering-signals.md) for the scoring.

> Note: `sybil-scan.mjs` ships with the funder grouping built in and expects the funding
> edges pre-resolved in its input (`funder`, `fundedAt`, `amount`, `cex`, `fingerprint`).
> The graph code above is the upstream ETL that produces that input from raw chain data — the
> DSU step is what you add when you need to merge multi-hop / multi-funder components before
> handing clusters to the scorer.

## Cost & rate-limit reality (read before you trace 10,000 wallets)

Deep funding traces are where Helius credits evaporate. Concrete current costs: **gTFA =
100 credits/call**, `getTransfersByAddress` = **10 credits/call**, both inside your standard
RPC rate-limit group (so credits *and* req/s both bind). A naive recursive trace —
N wallets × deep history × forward fan-out — is easily millions of credits and will rate-limit
you long before it finishes.

Make it tractable:
- **Resolve, don't traverse.** For most wallets you only need the *first funder* (one
  earliest-transfer lookup), not the whole subtree. Compute the full graph only on the funders
  that already show high fan-out.
- **Bound every walk.** Hard caps on `maxHops` (3–4) and `maxFanout` (a few hundred). Abort a
  branch the instant it hits a labeled hub.
- **Batch & cache.** Use batched parsed-history calls; persist `(address → first funder)` and
  resolved transfer edges so reruns and threshold-tuning don't re-pay. Backfill once, query
  many times.
- **Prefer parsed/keyset endpoints** (gTFA reverse search, `getTransfersByAddress` filters)
  over paging `getSignaturesForAddress` from the present to genesis — fewer calls per wallet.
- **Snapshot at the cutoff.** Pin to the airdrop snapshot slot so the graph is reproducible
  and you don't re-scan live tails. See [data-sources.md](./data-sources.md) for archival
  backfill options.

The discipline: spend credits to find candidate hubs, then spend the expensive deep traces
only on those hubs — not uniformly across every participant.

## Sources

- Helius — `getSignaturesForAddress` (newest-first, `before` pagination), `getTransactionsForAddress` (gTFA: reverse search, keyset pagination, 100 credits/call), `getTransfersByAddress` (parsed transfers, native filters, 10 credits/call).
- Drift × Allium — tracing original source of funds; multiple-first-funder masking; cutting CEX hot wallets to avoid false-positive blobs.
- Allium / Wormhole — diffusion (radial) vs. sequential-diffusion (peeling-chain) funding patterns from archival-node analysis.

_Last verified: June 2026_
