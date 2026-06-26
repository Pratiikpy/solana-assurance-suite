# Circle CCTP — native USDC between Solana and EVM

CCTP moves **native USDC** (not a wrapped/bridged variant) by **burn-on-source → Circle attestation → mint-on-dest**. 1:1, no liquidity pools, no fillers, no slippage. This is the cleanest USDC path on Solana — if you're moving USDC, use this, not [wormhole-ntt.md](wormhole-ntt.md) or a wrapped bridge.

## v2 is live on Solana

**CCTP v2 launched on Solana in Oct 2025** — the first non-EVM v2 deployment. As of 2026 CCTP is live on 13+ mainnet chains (Ethereum, Base, Arbitrum, OP, Polygon PoS, Avalanche, Unichain, Linea, World Chain, Sonic, Codex, **Solana**, plus v1-era Sui/Aptos/Noble). v2 features on Solana:

- **Fast Transfer** — Circle attests at the *confirmed* level before hard finality: cross-chain USDC settlement in **~8–30s** vs ~13–19 min for v1 hard finality. (Fast transfers carry a small on-mint fee, capped by `maxFee`.)
- **Hooks** — attach a payload that triggers an arbitrary call on the destination *in the same tx as the mint*. On Solana the hook invokes a destination program via **CPI**; on EVM the recipient implements `IMessageHandlerV2`.

## Solana programs

Two programs, with per-message state in PDAs:

| Program | v1 (mainnet) | v2 (mainnet) |
|---|---|---|
| MessageTransmitter | `CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd` | `CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC` |
| TokenMessengerMinter | `CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3` | `CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe` |

`TokenMessengerMinter` burns/mints USDC; `MessageTransmitter` emits the cross-chain message and verifies the attestation on receive. Solana has **programs + accounts**, not EVM contracts: nonces, used-nonce records, and message state are **PDAs** you must derive (Circle's `solana-cctp-contracts` repo / IDL provides the seed derivations).

## Domain IDs

CCTP addresses chains by a **numeric domain**, *not* the EVM chainId or Wormhole chainId:

`Ethereum 0 · Avalanche 1 · OP 2 · Arbitrum 3 · Noble 4 · Solana 5 · Base 6 · Polygon PoS 7` (… more for newer chains — check Circle docs).

## The flow

1. **Burn on source** — call `depositForBurn` (v2: on `TokenMessengerMinterV2`). Key params: `amount`, `destinationDomain`, `mintRecipient` (**32-byte, left-padded** — an EVM address is right-aligned in 32 bytes; a Solana pubkey is its 32 raw bytes), `burnToken`, `maxFee`, `minFinalityThreshold`. (`depositForBurnWithCaller` adds `destinationCaller` to restrict who may mint.)
2. **Attestation (Iris)** — poll Circle's API with the source domain + source tx hash until `status: "complete"`; you get back the `message` bytes and `attestation` signature.
3. **Mint on dest** — submit `message` + `attestation` to the destination `MessageTransmitter.receiveMessage`, which CPIs/calls `TokenMinter` to mint native USDC to `mintRecipient`.

### Finality thresholds (v2)

`minFinalityThreshold` selects speed vs hard finality. **≤1000 ⇒ Fast** (confirmed-level attestation), **2000 ⇒ Standard/Finalized**. Values below 1000 are clamped to 1000; above 1000 to 2000. v2 EVM recipients distinguish `handleReceiveUnfinalizedMessage` (<2000) vs `handleReceiveFinalizedMessage` (≥2000).

### Iris attestation API

- Mainnet: `https://iris-api.circle.com` · Testnet: `https://iris-api-sandbox.circle.com`
- v2: `GET /v2/messages/{sourceDomain}?transactionHash={txHash}` (also `POST /v2/reattest` to upgrade a soft-final message to finalized; `GET /v2/publicKeys` to validate signatures).
- Rate limit ~35 req/s (429 → 5-min block). Poll with backoff.

```bash
# Poll until status == "complete"; sourceDomain=5 for Solana origin.
curl -s "https://iris-api.circle.com/v2/messages/5?transactionHash=$SOL_TX_SIG" \
  -H "Content-Type: application/json"
# → { "messages": [ { "status": "complete", "message": "0x..", "attestation": "0x.." } ] }
```

## Solana → EVM USDC transfer (runnable shape)

No first-party npm SDK; use Circle's `solana-cctp-contracts` IDL with Anchor, then fetch the attestation and mint on EVM with ethers. Skeleton:

```ts
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ethers } from "ethers";

const SOLANA_DOMAIN = 5, ETH_DOMAIN = 0;
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); // mainnet USDC
const TOKEN_MESSENGER_V2 = new PublicKey("CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe");

// 1) BURN on Solana. mintRecipient must be the 32-byte form of the EVM address.
const evmRecipient = "0xRecipient...";
const mintRecipient = Buffer.from(
  ethers.zeroPadValue(evmRecipient, 32).slice(2), "hex"); // left-padded to 32 bytes
const provider = new AnchorProvider(connection, wallet, {});
const tm = new Program(tokenMessengerIdl, provider);      // load from Circle IDL
const sig = await tm.methods
  .depositForBurn({
    amount: new BN(1_000_000),          // 1 USDC (6 decimals)
    destinationDomain: ETH_DOMAIN,
    mintRecipient: [...mintRecipient],
    maxFee: new BN(500),                // cap fast-transfer fee
    minFinalityThreshold: 1000,         // 1000 = Fast; 2000 = Standard/finalized
  })
  .accounts({/* messageTransmitter, tokenMinter, senderAta, eventAuthority, … PDAs */})
  .rpc();

// 2) ATTESTATION from Iris (poll until complete).
async function getAttestation(srcDomain: number, txSig: string) {
  const url = `https://iris-api.circle.com/v2/messages/${srcDomain}?transactionHash=${txSig}`;
  for (;;) {
    const r = await (await fetch(url)).json();
    const m = r.messages?.[0];
    if (m?.status === "complete") return { message: m.message, attestation: m.attestation };
    await new Promise(s => setTimeout(s, 2000));   // backoff; respect 35 req/s
  }
}
const { message, attestation } = await getAttestation(SOLANA_DOMAIN, sig);

// 3) MINT on Ethereum via MessageTransmitterV2.receiveMessage(message, attestation).
const eth = new ethers.Wallet(PK, new ethers.JsonRpcProvider(ETH_RPC));
const mt = new ethers.Contract(ETH_MESSAGE_TRANSMITTER_V2, MT_ABI, eth);
await (await mt.receiveMessage(message, attestation)).wait();
```

EVM→Solana is the mirror image: `depositForBurn` on the EVM `TokenMessengerV2`, poll Iris with `sourceDomain=0`, then call Solana `MessageTransmitter.receiveMessage` (derive the used-nonce PDA so the mint can't be replayed). On Solana, after the message is fully processed there's a window before `reclaim_event_account` reclaims the per-message account's rent.

## v1 vs v2

- **v1:** hard finality only (~13–19 min), no fast transfer, no hooks, no `maxFee`. Programs `CCTPmb…` / `CCTPi…`. Some chains (Sui, Aptos, Noble) remain v1-only.
- **v2:** Fast Transfer + Hooks + `maxFee`/`minFinalityThreshold`, `…V2…` programs, `IMessageHandlerV2` finalized/unfinalized split. **Use v2 on Solana.**

## Gotchas

- **`mintRecipient` is 32 bytes, always.** EVM addresses left-pad; Solana pubkeys are raw 32 bytes. Wrong padding silently mints to the wrong account.
- **Domain ≠ chainId ≠ Wormhole chainId.** Triple-check the domain table.
- **Decimals:** USDC is 6 decimals on every chain — but don't assume; verify the mint.
- **Attestation latency** is the wall: fast ~seconds, standard waits source finality (ETH ~13–19 min). Build idempotent polling; the burn tx is your durable handle.
- **`destinationCaller`** (via `depositForBurnWithCaller`) restricts who can mint — set it if you relay yourself; leave unset (zero) for permissionless mint.
- **v1 vs v2 programs are distinct deployments** — don't mix a v2 burn with a v1 receive.

Integration tests (burn → mock/poll attestation → mint) belong in [testing the integration](../solana-testing/SKILL.md).

## Unverified / verify-before-shipping

- Exact `depositForBurn` account list and PDA seeds on Solana — derive from Circle's current `solana-cctp-contracts` IDL, not memory.
- The precise `maxFee` units/scaling for Solana fast transfers — confirm against Circle docs for the live fee schedule.
- Newer chains' domain IDs — read Circle's domain table at integration time.

Related: [wormhole-ntt.md](wormhole-ntt.md) (your own multichain token) · [messaging.md](messaging.md) (arbitrary messaging).

_Last verified: June 2026_
