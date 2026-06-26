---
description: Get a live cross-chain quote (deBridge DLN create-tx quote, or a CCTP fee/finality estimate) for a given source/dest/amount. Read-only — inspects rates, fees, and latency; moves no funds and signs nothing.
argument-hint: "[src chain] [dst chain] [token] [amount]  e.g. \"solana arbitrum SOL 1.5\""
---

# /quote-bridge

Return a live cross-chain quote for `$ARGUMENTS`. **Read-only**: fetch the estimate, report rates/fees/latency, and stop. Do not build a signable transaction to submit, do not sign, do not move funds. (The DLN endpoint returns a tx alongside the quote — you fetch it for the `estimation`, you do **not** submit it.)

## 1. Route the quote to the right rail
- **Arbitrary asset pair / swap-and-bridge** (the usual "what will I get out") → **deBridge DLN** live quote. [debridge.md](../skill/debridge.md)
- **Native USDC** → **CCTP** fee + finality estimate (there is no market price — it's 1:1 burn/mint; the variables are the fast-transfer fee and the finality wait). [cctp.md](../skill/cctp.md)
- Your own NTT token has no market quote either; if asked, report the transfer is 1:1 minus the relay/Executor quote and gated by finality + any rate-limit queue. [wormhole-ntt.md](../skill/wormhole-ntt.md)

## 2a. deBridge DLN quote (asset pairs)
```
GET https://dln.debridge.finance/v1.0/dln/order/create-tx
```
Key params: `srcChainId` (**Solana = `7565164`**, deBridge internal id — not an EVM chainId), `srcChainTokenIn` (mint; wrapped-SOL `So111…1112` for native SOL), `srcChainTokenInAmount` (base units), `dstChainId` (EVM chainId for EVM dest), `dstChainTokenOut`, `dstChainTokenOutAmount` (`auto` to let input drive output at market rate), `dstChainTokenOutRecipient`, `senderAddress`.

Report from the response **`estimation`** block: expected `dstChainTokenOut` amount, the implied rate, fees (protocol/solver/operating expenses), and any min-receive. Flag if no solver route is quoted (thin/exotic pair) and that an unfilled order is refundable at expiry. **Do not submit `tx.data`.**

## 2b. CCTP fee / finality estimate (native USDC)
No market price — report instead:
- **Path**: burn on source (domain) → Iris attestation → mint on dest (domain). Solana domain `5`; confirm both domains from Circle's table (domain ≠ chainId ≠ Wormhole chainId).
- **Speed/fee tradeoff**: Fast V2 (`minFinalityThreshold ≤ 1000`) ≈ **~8–30s**, carries a small on-mint fee capped by `maxFee`, and Circle fronts the soft-finality reorg risk; Standard (`2000`) waits hard finality (ETH ~13–19 min), no fast fee.
- USDC is 6 decimals everywhere — state the amount in base units and confirm the mint.

## 3. Report
Source/dest/amount, the rail chosen, and the numbers: for DLN the expected output + rate + fees (from `estimation`); for CCTP the fee/finality tradeoff per threshold. State explicitly that **no funds were moved and nothing was signed**, and that the quote is live/stale-on-arrival — re-quote immediately before any real transfer. Hand off to `/add-bridge` to build the transfer.
