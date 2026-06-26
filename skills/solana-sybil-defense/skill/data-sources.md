# Data Sources — Where the Signals Come From (June 2026)

The engine in [`tools/sybil-scan/sybil-scan.mjs`](../tools/sybil-scan/sybil-scan.mjs) is signal-agnostic: it consumes a flat list of `{ id, funder, fundedAt, amount, cex, fingerprint }` and clusters on it. This file is about the hard part — **producing those rows from chain.** The funding edge (`funder`, `fundedAt`, `amount`) is the most expensive and most discriminating field; how you source and cache it determines whether a scan costs $5 or $5,000. See [funding-graph.md](funding-graph.md) for the trace algorithm itself.

## The three layers

| Layer | Tool | What you get | Use for |
|---|---|---|---|
| Holdings / snapshot | Helius **DAS API** (`getAssetsByOwner`) | who holds the mint/NFT, balances, Token-2022 | the candidate set (who even claims) |
| Raw history | JSON-RPC `getSignaturesForAddress` + `getTransaction` | every signature, pre/post balances, the **first** funding tx | the funding edge — `funder`, `fundedAt`, `amount` |
| Decoded history | Helius **Enhanced Transactions** (`getTransactionsByAddress`) | human-readable transfers, source/dest, `nativeTransfers` | cheaper funding trace, behavioral `fingerprint` |
| Live | Helius **Webhooks** | push on new claims/funding | ongoing monitoring after launch |

## 1. The candidate set — DAS API

Endpoint: `https://mainnet.helius-rpc.com/?api-key=KEY` (devnet: `devnet.helius-rpc.com`). `getAssetsByOwner` is the fastest way to enumerate a wallet's fungible + NFT holdings; paginate with `page`/`limit` (max 1000).

```js
// @solana/kit 6.10.x RPC client. Pure JSON-RPC POST also works (see funding-graph.md).
import { createSolanaRpc } from "@solana/kit";
const rpc = createSolanaRpc(`https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_KEY}`);

// DAS methods are not in the kit RPC typemap; call them by raw fetch.
async function das(method, params) {
  const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "1", method, params }),
  });
  const { result, error } = await r.json();
  if (error) throw new Error(`${method}: ${error.message}`);
  return result;
}

async function* holders(owner) {            // wallet's fungible holdings (the claim candidates)
  for (let page = 1; ; page++) {
    const { items, total } = await das("getAssetsByOwner", {
      ownerAddress: owner, page, limit: 1000,
      displayOptions: { showFungible: true, showNativeBalance: true },
    });
    yield* items;
    if (items.length < 1000) break;
  }
}
```

For "everyone who holds mint X" you typically invert this: snapshot the mint's token accounts (`getTokenAccounts` by mint, or DAS `searchAssets` with a `grouping`/`tokenType` filter) to get the owner set, then enrich each owner with a funding trace.

## 2. The funding edge — `getSignaturesForAddress` + `getTransaction`

This is the signal the engine clusters on. `getSignaturesForAddress` returns signatures **newest-first**; the *oldest* page holds the wallet's birth. Walk backwards with `before` until the page is short, then take the last signature — that transaction is the first inbound SOL transfer (the funder).

```js
async function firstFundingTx(rpc, address) {
  let before = undefined, oldest = null;
  for (;;) {                                                  // paginate to genesis
    const sigs = await rpc.getSignaturesForAddress(address, { before, limit: 1000 }).send();
    if (sigs.length === 0) break;
    oldest = sigs[sigs.length - 1];
    if (sigs.length < 1000) break;
    before = oldest.signature;
  }
  if (!oldest) return null;
  const tx = await rpc.getTransaction(oldest.signature, {
    maxSupportedTransactionVersion: 0,                        // REQUIRED or v0 txs error
    encoding: "jsonParsed",
  }).send();
  return parseFundingEdge(tx, address);                       // -> { funder, fundedAt, amount }
}
```

Notes that bite people:
- **`maxSupportedTransactionVersion: 0` is mandatory.** Omit it and any v0 transaction throws instead of returning. There is no "all versions" — bump it as you add support.
- Pagination is by signature, not slot. Store the newest signature you've processed and resume from there for incremental rescans.
- Derive `funder`/`amount` from `meta.preBalances`/`postBalances` keyed by `transaction.message.accountKeys`, **not** from the instruction list — CEX withdrawals and program-routed funding hide the real payer inside inner instructions. The account whose balance went *up* is your wallet; the largest matching debit is the funder.

## 3. Cheaper trace + behavior — Enhanced Transactions

Helius's Enhanced Transactions API (`helius.enhanced` namespace in `helius-sdk` v2.x; or REST) returns decoded `nativeTransfers` / `tokenTransfers` with `fromUserAccount`/`toUserAccount` already resolved — no `pre/postBalances` arithmetic. `getTransactionsByAddress` pulls a full decoded history in one call. This is also where you cheaply build the `fingerprint` field (the ordered set of program/instruction types a wallet touched), which the engine treats as a corroborating signal alongside timing and amount.

```js
import { Helius } from "helius-sdk";                 // v2.2.x
const helius = new Helius(process.env.HELIUS_KEY);
const txs = await helius.enhanced.getTransactionsByAddress({ address, limit: 100 });
const fingerprint = txs.map(t => t.type).slice(0, 8).join(">");   // e.g. "TRANSFER>SWAP>NFT_MINT"
```

## 4. Ongoing monitoring — Webhooks

After launch, sybils keep arriving. Register a Helius webhook (`createWebhook`, `helius.webhooks` namespace) on the claim program / distributor address to push new claims to your endpoint; re-run [`scan()`](../tools/sybil-scan/sybil-scan.mjs) on the rolling window and flag clusters before they finish draining. Webhooks bill **1 credit/event** — cheap enough to leave on indefinitely.

## Known-CEX-address lists

The engine's `cex` field requires labelling the funder. Maintain a curated map of exchange hot/deposit wallets (Coinbase, Binance, Kraken, OKX, …). Sources, in order of trust:
- Helius/Solscan address labels (programmatic, but coverage is partial).
- Community label sets (e.g. Solscan's public labels, Arkham/Nansen if licensed) — pull, then **pin a local snapshot**; labels change and you do not want a scan's verdict to drift between runs.
- Your own backfill: any funder that fans out to thousands of unrelated wallets with diverse behavior is almost certainly a CEX/custodian — promote it to the list so it stops looking like a farm. This is exactly the false-positive trap the engine is built to survive (the 40 CEX-funded legit decoys in [`examples/planted-cluster`](../examples/planted-cluster/), all correctly *not* flagged).

CEX-funded ≠ sybil. The engine deliberately treats `cexShared` as **one** signal of four and never flags on it alone — see [scoring-and-thresholds.md](scoring-and-thresholds.md).

## Cost & credit reality

Helius credit costs (June 2026): **Standard RPC = 1, DAS = 10, Enhanced Txns = 100, Webhooks = 1/event**; overage $5 per million credits.

The deep funding trace is what hurts. A naive scan of N candidate wallets, each needing a backwards walk to genesis, is the dominant cost:
- A wallet with a long history can take 5–50 `getSignaturesForAddress` pages (1 credit each) + 1 `getTransaction` (1 credit) to find its funder. Call it ~10–50 RPC credits/wallet.
- Doing the same with one Enhanced `getTransactionsByAddress` call is 100 credits but one round-trip — *more* credits, *fewer* requests/less latency. Use Enhanced for behavior, raw RPC for the funding edge, and pick per your rate limits.
- A 100k-wallet airdrop scan is therefore **1M–5M credits** of trace — real money. Budget it.

**Cache aggressively. The funding edge is immutable.** A wallet's first funding transaction never changes once it exists, so it is the perfect cache key:

```js
// content-addressed, never-expires cache for the one expensive call
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
const DIR = ".cache/funding"; mkdirSync(DIR, { recursive: true });
async function cachedFundingEdge(rpc, address) {
  const f = `${DIR}/${address}.json`;
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));   // immutable hit
  const edge = await firstFundingTx(rpc, address);
  writeFileSync(f, JSON.stringify(edge));
  return edge;
}
```

Cache holdings/behavior with a TTL (they change); cache the funding edge **forever**. On a rescan you pay only for wallets you have never traced. This turns a $5,000 re-run into a $50 one.

## Output contract

Whatever the source, normalize to the engine's row shape and hand it to `scan()`:

```json
{ "id": "claimerWalletPubkey", "funder": "payerPubkey", "fundedAt": 1719300000,
  "amount": 0.02, "cex": "binance", "fingerprint": "TRANSFER>SWAP>CLAIM" }
```

`id` is the candidate wallet, `funder`/`fundedAt`/`amount` come from layer 2, `cex` from the label list, `fingerprint` from layer 3. Then: [funding-graph.md](funding-graph.md) for clustering, [scoring-and-thresholds.md](scoring-and-thresholds.md) for the verdict.

_Last verified: June 2026_
