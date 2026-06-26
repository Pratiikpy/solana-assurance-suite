# deBridge DLN — Intent-Based Liquidity Bridging from Solana

DLN (deBridge Liquidity Network) is an **intent/solver** bridge: you don't lock funds in a pool and you don't mint a wrapped asset. You post a *cross-chain order* ("I give X on Solana, I want ≥ Y of asset Z on chain C, before time T"), a competing **solver** (a "taker") fronts asset Z on the destination chain from its own inventory, and the protocol reimburses that solver out of your locked input after the source side settles. **0-TVL** — there is no shared honeypot to drain; the solver's own capital is at risk, not a pooled vault. Routing rationale and how this compares to issuer-native rails is in [bridge-landscape.md](bridge-landscape.md).

> The sendaifun `debridge` skill (and a `LI.FI` skill) cover deeper single-protocol mechanics — exhaustive quote/route params and SDK calls; **this skill owns selection + safety** (picking DLN over the alternatives and not getting drained doing it), the layer above those wrappers.

## Why this shape matters

Lock-and-mint bridges give you a **wrapped IOU** at a **pool-derived rate**, and the pool is an exploit target. DLN gives you the **real destination asset** at a **market rate set by competing solvers**, **fast** (a fill is one destination-chain tx the moment a solver takes the order), with **no new wrapped token** and **no pooled TVL**. The tradeoff is liveness/price: if no solver finds your order profitable it sits unfilled until expiry, then your input is refundable. This is the right tool when you don't control either token and want best execution (decision tree case **(d)** in [bridge-landscape.md](bridge-landscape.md)).

## API surface (verified)

Base URL `https://dln.debridge.finance`. The endpoint that matters returns a ready-to-sign transaction *and* the quote in one call:

```
GET https://dln.debridge.finance/v1.0/dln/order/create-tx
```

Key query params (verified against deBridge API reference):

| Param | Meaning |
|---|---|
| `srcChainId` | Source chain. **Solana = `7565164`** (deBridge's internal id, not an EVM chainId) |
| `srcChainTokenIn` | Input token mint on Solana (use the wrapped-SOL mint `So111…1112` for native SOL) |
| `srcChainTokenInAmount` | Input amount (base units), or `auto` when pinning the output |
| `dstChainId` | Destination chain id (EVM chainId for EVM chains) |
| `dstChainTokenOut` | Desired output token address on destination |
| `dstChainTokenOutAmount` | Desired output amount, or `auto` to let the input drive it |
| `dstChainTokenOutRecipient` | Who receives on the destination chain |
| `senderAddress` | Source-chain submitter (your Solana wallet) |
| `srcChainOrderAuthorityAddress` | Authority that can cancel/refund on source |
| `dstChainOrderAuthorityAddress` | Authority on destination (cancel/patch) |
| `referralCode`, `affiliateFeePercent`, `prependOperatingExpenses`, `dlnHook` | Referral/affiliate, expense prepayment, and post-fill hook (execute a call on arrival) |

Response carries an `estimation` block (rates, fees, expected `dstChainTokenOut` amount) and a `tx` object. **For a Solana source, `tx.data` is a base64 serialized Solana transaction** you deserialize, (optionally) co-sign, and submit — not EVM calldata. (For EVM sources `tx` is `{to,data,value,gasLimit}`.) Solana addresses/amounts are passed as their native string/decimal forms.

Order lifecycle/status is queryable via the DLN order API by the order id returned at submission; a filled order emits the fulfillment on the destination chain, after which the solver claims your locked input on the source.

## Runnable snippet (quote → sign → submit from Solana)

```ts
import {
  Connection, Keypair, VersionedTransaction,
} from "@solana/web3.js";

const DLN = "https://dln.debridge.finance/v1.0";
const SOLANA = 7565164;                  // deBridge internal id for Solana
const WSOL = "So11111111111111111111111111111111111111112";
const ARBITRUM = 42161;                  // EVM chainId
const USDC_ARB = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

// 1) Get the quote + ready-to-sign tx in one call (create-tx)
const url = new URL(`${DLN}/dln/order/create-tx`);
Object.entries({
  srcChainId: SOLANA,
  srcChainTokenIn: WSOL,
  srcChainTokenInAmount: "1000000000",   // 1 SOL (lamports)
  dstChainId: ARBITRUM,
  dstChainTokenOut: USDC_ARB,
  dstChainTokenOutAmount: "auto",        // let the input drive output (market rate)
  dstChainTokenOutRecipient: "0xYourEvmRecipient",
  senderAddress: wallet.publicKey.toBase58(),
  srcChainOrderAuthorityAddress: wallet.publicKey.toBase58(),
  dstChainOrderAuthorityAddress: "0xYourEvmRecipient",
}).forEach(([k, v]) => url.searchParams.set(k, String(v)));

const res = await fetch(url).then(r => r.json());
// res.estimation -> rates/fees/expected output; inspect BEFORE signing
// res.tx.data    -> base64 serialized Solana tx for a Solana source

// 2) Deserialize, sign, submit on Solana
const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const tx = VersionedTransaction.deserialize(
  Buffer.from(res.tx.data, "base64"),
);
tx.sign([wallet as Keypair]);
const sig = await conn.sendTransaction(tx);
await conn.confirmTransaction(sig, "confirmed");
// Order is now open; a solver fills it on Arbitrum, then claims your locked SOL.
```

> Verify field names against the live response before shipping — the `tx.data` encoding (base64 serialized tx) and the `7565164` Solana id are the load-bearing, non-obvious bits.

## SDK / tooling

- **API-first is the stable surface.** The HTTP `create-tx` endpoint above is what you should build on; it abstracts contract addresses and works identically for any supported pair.
- **`@debridge-finance/dln-client`** (npm) — TypeScript client over the DLN contracts on Solana + EVM, built on deBridge messaging. *Exact current version is unverified:* registry results conflicted (one listing showed `17.6.x`, another referenced `8.7.0`), and the most recent publish appeared stale relative to June 2026. **Pin and audit the version you install (`npm view @debridge-finance/dln-client version`) — do not assume.** Related scope packages: `@debridge-finance/dln-taker` (reference solver/taker engine) and `@debridge-finance/dln-profitability`.
- **`@debridge-finance/debridge-mcp`** — official MCP server for agents: searches 40k+ tokens, returns quotes and transaction data, generates shareable signing links. Stateless proxy over the public API, no API key, ~50 req/min. Useful for agentic flows; the user still signs.

## DLN vs lock/mint bridges

| | DLN (intents) | Lock/mint (wrapped) |
|---|---|---|
| Output asset | **Real** destination asset | Wrapped IOU |
| Price | Market, solver-competitive | Pool-derived |
| Protocol TVL at risk | **None** (solver capital) | Pooled honeypot |
| Speed | Seconds on fill | Confirmation + mint |
| Failure mode | Unfilled → refund at expiry | Pool/verifier exploit |

## Gotchas

- **Slippage / `auto` amounts.** With `dstChainTokenOutAmount: auto` you accept the solver-quoted output. Always read `estimation` and enforce your own minimum before signing; don't sign blind on a stale quote.
- **Order expiry & refunds.** Orders are time-bounded. If no solver fills before expiry, nothing was bridged — reclaim your input via the `srcChainOrderAuthorityAddress`. Build the cancel/refund path; don't assume fill.
- **Recipient correctness.** `dstChainTokenOutRecipient` and `dstChainOrderAuthorityAddress` are on the **destination** chain (EVM address for EVM dest, base58 for Solana dest). A wrong/format-mismatched recipient is the easy way to misdeliver. This maps directly to "validate the message sender/recipient" in [bridge-security.md](bridge-security.md).
- **Supported chains move.** Solana plus 20+ chains, but the set and per-pair liquidity change. Treat the chain/token list as runtime data from the API, not a constant baked into your build.
- **Solver liveness ≠ guaranteed.** Thin or exotic pairs may sit unfilled. For guaranteed USDC movement, CCTP ([cctp.md](cctp.md)) is the issuer-native path; for your own canonical token use NTT ([wormhole-ntt.md](wormhole-ntt.md)).

_Last verified: June 2026_
