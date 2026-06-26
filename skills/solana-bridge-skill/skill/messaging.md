# Arbitrary cross-chain messaging (Wormhole core + VAAs)

Token bridges move value; **messaging moves intent**. The Wormhole **Core Contract** lets a Solana program emit an arbitrary byte payload that any chain can verify and act on. Reach for messaging — not a token bridge — for **cross-chain governance** (vote on Solana, execute on EVM), **state sync** (mirror an oracle/registry), and **intent fulfillment** (lock on A, instruct a solver on B). If all you're moving is a token, use [wormhole-ntt.md](wormhole-ntt.md) or [cctp.md](cctp.md) instead — they're built *on top of* this layer.

## The guardian / VAA model

1. A contract calls the Core Contract's publish/post-message instruction with a payload + `consistencyLevel`.
2. The Core Contract emits an event keyed by **(emitterChain, emitterAddress, sequence)**; `sequence` increments per emitter.
3. The **Guardians** (a permissioned 19-node set) observe the event once it reaches the requested finality and each sign the message body.
4. Their collected signatures form a **VAA — Verifiable Action Approval** (≥13/19 quorum). A VAA is a self-contained, portable proof: header (guardian set index + signatures) + body (timestamp, nonce, emitterChain, emitterAddress, sequence, consistencyLevel, payload).
5. **Anyone** submits the VAA to the destination, which verifies the signatures against the known guardian set and runs the payload. Guardians don't deliver — that's the relayer's job (or yours).

Trust assumption: you trust the guardian set's honesty/liveness (≥13/19), *not* any single relayer — relayers are untrusted couriers; the signatures are the security.

## Mainnet Core Contract addresses

- **Solana:** `worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth`
- **Ethereum:** `0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B`
- **Relayer (Executor framework):** Solana `execXUrAsMnqMmTHj5m7N1YQgsDz3cwGLYCYyuDRciV` · Ethereum `0x84EEe8dBa37C36947397E1E11251cA9A06Fc6F8a`

## Emitting from a Solana program

Use `wormhole-anchor-sdk` (crate **`0.30.1-alpha.3`**, June 2026 — alpha; pin it). You CPI into the Core Contract's `post_message`. The Core requires a **message fee** (paid to the `fee_collector` PDA), and your program's **emitter PDA** must sign, which is what authenticates the message's origin. `sequence` auto-increments per emitter.

```rust
use anchor_lang::prelude::*;
use wormhole_anchor_sdk::wormhole;

#[derive(Accounts)]
pub struct EmitMessage<'info> {
    #[account(mut)] pub payer: Signer<'info>,
    /// CHECK: Core Contract global config (seed b"Bridge").
    #[account(mut)] pub wormhole_bridge: Account<'info, wormhole::BridgeData>,
    /// CHECK: collects the message fee (seed b"fee_collector").
    #[account(mut)] pub wormhole_fee_collector: Account<'info, wormhole::FeeCollector>,
    /// CHECK: your program's emitter authority (seed b"emitter") — signs the message.
    #[account(seeds = [b"emitter"], bump)] pub wormhole_emitter: SystemAccount<'info>,
    /// CHECK: per-emitter sequence tracker (seeds b"Sequence", emitter).
    #[account(mut)] pub wormhole_sequence: Account<'info, wormhole::SequenceTracker>,
    /// CHECK: fresh PDA the posted message is written to.
    #[account(mut)] pub wormhole_message: UncheckedAccount<'info>,
    pub wormhole_program: Program<'info, wormhole::program::Wormhole>,
    pub clock: Sysvar<'info, Clock>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
}

pub fn emit_message(ctx: Context<EmitMessage>, payload: Vec<u8>) -> Result<()> {
    // 1) Pay the Core message fee.
    let fee = ctx.accounts.wormhole_bridge.fee();
    if fee > 0 {
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.wormhole_fee_collector.to_account_info(),
                },
            ),
            fee,
        )?;
    }

    // 2) CPI post_message, signed by the emitter PDA + the message account.
    let emitter_seeds: &[&[&[u8]]] = &[&[b"emitter", &[ctx.bumps.wormhole_emitter]]];
    wormhole::post_message(
        CpiContext::new_with_signer(
            ctx.accounts.wormhole_program.to_account_info(),
            wormhole::PostMessage {
                config: ctx.accounts.wormhole_bridge.to_account_info(),
                message: ctx.accounts.wormhole_message.to_account_info(),
                emitter: ctx.accounts.wormhole_emitter.to_account_info(),
                sequence: ctx.accounts.wormhole_sequence.to_account_info(),
                payer: ctx.accounts.payer.to_account_info(),
                fee_collector: ctx.accounts.wormhole_fee_collector.to_account_info(),
                clock: ctx.accounts.clock.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
            },
            emitter_seeds,
        ),
        0,                       // batch_id / nonce
        payload,                 // your serialized message
        wormhole::Finality::Finalized,  // == consistency_level 32 (Confirmed == 1)
    )?;
    Ok(())
}
```

`consistency_level`/`Finality`: **Confirmed (1)** is fast but reorg-exposed; **Finalized (32)** is what cross-chain value movement should use. Guardians wait for the requested level before signing.

## Consuming a VAA on EVM

Verify with `parseAndVerifyVM`, then enforce **emitter allow-list + replay protection** yourself — the Core only proves the VAA is genuine, not that *you* should accept it.

```solidity
function receiveMessage(bytes calldata encodedVaa) external {
    (IWormhole.VM memory vm, bool valid, string memory reason)
        = wormhole.parseAndVerifyVM(encodedVaa);
    require(valid, reason);

    // 1) Only accept from the Solana emitter you registered (chainId 1 = Solana).
    require(registeredEmitter[vm.emitterChainId] == vm.emitterAddress, "bad emitter");
    // 2) Replay protection — VAAs are public & re-submittable.
    require(!consumed[vm.hash], "replayed");
    consumed[vm.hash] = true;

    _handle(vm.payload);   // your logic
}
```

## Consuming a VAA on Solana

The pattern mirrors EVM: the Core verifies guardian signatures (`verify_signatures` then `post_vaa`) producing a **`PostedVaa<T>` account** your program reads. Replay protection is structural: derive a **claim PDA** from `(emitter_chain, emitter_address, sequence)` and `init` it inside the handler — a second delivery fails because the PDA already exists. Always check `posted_vaa.emitter_chain()`/`emitter_address()` against your registered peer before acting.

## Standard relaying

Three delivery options, increasing convenience:

- **Manual:** you fetch the signed VAA from a guardian RPC / Wormholescan and submit it yourself. Most control, you pay dest gas.
- **Executor / standard relayer:** request delivery at emit time and pay a quote; the Executor network submits the VAA to your dest contract automatically. The Executor framework supersedes the older "generic relayer."
- **Specialized relayer:** your own off-chain process watching for your emitter's VAAs.

Fetching a VAA off-chain (TS):

```ts
import { Wormhole, signSendWait } from "@wormhole-foundation/sdk";   // 6.1.0
import solana from "@wormhole-foundation/sdk/platforms/solana";
import evm from "@wormhole-foundation/sdk/platforms/evm";
const wh = new Wormhole("Mainnet", [solana.Platform, evm.Platform]);
const [whm] = await wh.getChain("Solana").parseTransaction(solanaTxSig);
const vaa = await wh.getVaa(whm!, "Uint8Array", 120_000);   // raw bytes → submit on dest
```

## Ordering & finality assumptions

- **No cross-emitter ordering.** `sequence` is monotonic *per emitter* only. Across emitters/chains there is no global order — never assume message N+1 arrives after N. If you need ordering, encode a nonce/version in the payload and enforce it in the handler.
- **Out-of-order delivery is normal** — relayers are independent; a later VAA can land first. Make handlers commutative or gate on explicit sequence.
- **Finality is the latency floor.** Solana Finalized ≈ ~13s+; Ethereum finality ≈ ~15 min. A round trip is bounded by the *slower* chain's finality plus guardian signing.
- **Exactly-once is on you** — VAAs are replayable; the claim-PDA / consumed-hash check is mandatory, not optional.

## Alternatives (brief)

- **LayerZero** — endpoint + configurable DVN/executor stack; app picks its own security (incl. a Wormhole DVN). Solana support exists; good if you want per-app verifier choice.
- **Hyperlane** — permissionless interchain messaging with pluggable **ISMs** (interchain security modules); deploy your own route without core-team gating.

Choose Wormhole for the broadest chain coverage + mature guardian set and the NTT/CCTP/Settlement stack built on the same VAAs. Choose LayerZero/Hyperlane when you specifically want to own the verification policy.

## Unverified / verify-before-shipping

- `wormhole-anchor-sdk` is **alpha (0.30.1-alpha.3)** — field/seed names (`BridgeData`, `SequenceTracker`, `PostMessage`) match the scaffolding hello-world but **confirm against the pinned crate's docs.rs** before building; the API still moves.
- The Executor relayer's request API and quote shape — verify against current Wormhole docs; it replaced the older generic relayer recently.
- Guardian set size/quorum (19 / ≥13) is current but governance-mutable — don't hardcode assumptions in security-critical paths.

End-to-end emit→relay→consume flows should be exercised in [testing the integration](../solana-testing/SKILL.md).

Related: [wormhole-ntt.md](wormhole-ntt.md) · [cctp.md](cctp.md).

_Last verified: June 2026_
