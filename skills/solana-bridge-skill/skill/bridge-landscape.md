# Bridge Landscape — Choosing a Bridge on Solana (2026)

The router spine. Most "bridge a token" requests are one of four jobs. Pick the job, not the brand. Picking wrong is how you end up with a stranded wrapped asset no one will take, or a custom verifier you now have to secure yourself (the most-exploited primitive in crypto — see [bridge-security.md](bridge-security.md)).

## Decision tree

1. **Moving native USDC (or EURC) across chains?** → **Circle CCTP**. Burn-and-mint of the canonical issuer's own token. No wrapped USDC, no liquidity pool, no third-party trust beyond Circle. This is the default for stablecoin movement; do not route USDC through a generic bridge and mint a wrapped variant. → [cctp.md](cctp.md)

2. **Making *your own* SPL token canonical across chains?** (you control the mint, you want one fungible token everywhere, not `wETH`-style wrappers) → **Wormhole NTT** (Native Token Transfers). Burn-and-mint if you own the mint authority; hub-and-spoke (lock-and-mint) if you can't touch the existing contract. You keep the token standard and add rate-limits/pause yourself. → [wormhole-ntt.md](wormhole-ntt.md)

3. **Sending an arbitrary message / cross-chain state, governance, or a call** (not just value — e.g. "vote on Solana executes on Base", cross-chain mint authority, oracle push) → **generic messaging** (Wormhole Core / LayerZero-class). You're verifying a payload, not moving a registered asset; everything in [bridge-security.md](bridge-security.md) about VAA verification and replay is on you. → [messaging.md](messaging.md)

4. **Best-price asset swap-and-bridge, or you don't control either token** (bridge SOL→ETH, jitoSOL→USDC-on-Arbitrum, any asset pair, one transaction, market rate) → **deBridge DLN** (intent/solver liquidity network). No wrapped asset is created — a single solver delivers the real destination asset and you pay market price. → [debridge.md](debridge.md)

5. **Want the best route across *many* bridges without committing to one** (you don't know which rail is cheapest/fastest for this pair, or you want automatic fallback) → **LI.FI / aggregator-intent** layer. It quotes and routes across CCTP, NTT, DLN and dozens of other bridges+DEXs, picking (and chaining) the best per request. Use it when route *selection* across protocols is the value; reach for a single named rail above when you already know the right one. → an aggregator sits one level *above* the four jobs, not beside them.

> Rule of thumb: **issuer-native rail if one exists (CCTP for USDC, NTT for your token); intents (DLN) for arbitrary asset pairs; generic messaging only when you're moving a *message*, not an asset.** Reach for a classic lock-and-mint wrapped bridge essentially never in 2026 — it's the worst trust/liquidity tradeoff of the options below.

## Comparison

| Bridge | What it moves | Trust model | Finality / latency | When to use |
|---|---|---|---|---|
| **CCTP** (Circle) | Native USDC/EURC only | **Native issuer** — Circle's off-chain *Iris* attestation service signs the burn; Circle is the trusted party (and the token's issuer anyway) | Standard ~13–19 min (hard finality); **Fast V2 ~8–20 s** (Circle fronts soft-finality risk) | Any USDC movement. Don't reinvent it. |
| **Wormhole NTT** | Your own SPL/ERC-20 token, kept canonical | **Guardians** — 19-node Guardian set signs a VAA; integrator adds rate-limits, pause, Global Accountant | Solana → EVM gated by Solana finality (~13 s) + Guardian quorum; minutes total | You issue a token and want one fungible supply across chains without wrappers |
| **Generic messaging** (Wormhole Core / LayerZero) | Arbitrary bytes (calls, state, governance) | **Guardians / DVN oracle+relayer set** — you verify the attestation and the sender yourself | Source finality + attestation quorum | Cross-chain logic, not a registered asset |
| **deBridge DLN** | Any asset → any asset (swap-and-bridge) | **Intents / solvers** — a solver ("taker") fronts the destination asset and is reimbursed after source-side settlement; **0-TVL**, no pooled honeypot | Seconds when a solver fills; bounded by order expiry | Arbitrary pairs, market price, you don't control the tokens |
| **LI.FI / aggregator** | Best route across many bridges+DEXs (multi-bridge aggregation) | **Inherited** — you take on the trust model of whichever underlying bridge(s) it routes through, plus the aggregator's quoting/relayer layer | Best-of-N across rails; varies by chosen route | You want route *selection*/fallback across protocols, not a single committed rail. (Contrast: **DLN** is a *single*-solver intent fill on one network; an **aggregator** picks among many bridges, DLN possibly being one.) |

> **Deeper single-protocol mechanics live in dedicated wrappers.** For exhaustive quote/route params and SDK calls of one protocol, the sendaifun `debridge` skill and a `LI.FI` skill go deeper than this file does. **This skill owns the choice + safety layer above those wrappers** — picking the right rail and not getting drained; the wrappers own the per-protocol call surface.

## Vocabulary you must keep straight

**Wrapped vs canonical vs native.**
- **Native** — the asset is issued natively on the destination chain by its real issuer (CCTP USDC on Solana *is* Circle's USDC). No bridge IOU.
- **Canonical** — one blessed representation the ecosystem agrees to treat as *the* token (e.g. an NTT token where every chain's balance is the same fungible asset, governed by one issuer). There is exactly one.
- **Wrapped** — a bridge-minted IOU (`wBTC`, old `wormhole-wETH`) whose value depends entirely on the bridge staying solvent and unhacked. Multiple incompatible wrappers of "the same" asset are the classic liquidity-fragmentation trap. Avoid creating new ones.

**Lock-mint vs burn-mint.**
- **Lock-and-mint (hub-and-spoke)** — lock the asset in a custody contract on the source/hub chain, mint a representation on the destination. Total supply lives on the hub; the lockbox is a honeypot. Used when you *can't* modify the original token (NTT hub-and-spoke mode).
- **Burn-and-mint** — burn on source, mint on destination; supply is distributed across chains and conserved by construction. No growing lockbox. Requires mint authority on every chain (CCTP; NTT burning mode). Preferred when available.

**Liquidity bridges vs verification bridges.** Two fundamentally different risk surfaces:
- **Verification (mint/burn) bridges** — CCTP, NTT, messaging. Security = "is the attestation valid and unreplayed, and does the message authorize *this* mint?" A verification bug mints unbacked supply from nothing (Wormhole 2022). The asset is custodied/minted by the protocol.
- **Liquidity (intent) bridges** — deBridge DLN. No protocol-minted asset and no pooled TVL to drain; a **solver** uses its own capital to fill your order and is repaid on settlement. Risk shifts to *order construction* (slippage, expiry, recipient) and solver liveness, not signature-verification of a mint. Strictly smaller blast radius — there is no single contract holding everyone's funds.

## Anti-patterns

- **Don't route USDC through a generic/wrapped bridge** and mint a `wUSDC` IOU — CCTP ([cctp.md](cctp.md)) is the issuer-native burn/mint path and exists for exactly this. A wrapped USDC is a strictly worse, fragmenting, exploit-prone substitute.
- **Don't roll your own VAA/attestation verification.** Use a security-reviewed reference verifier (Circle CCTP programs, Wormhole NTT framework); the single most-expensive bridge hack ([bridge-security.md](bridge-security.md), Wormhole 2022 ~$325M) was a hand-rolled signature check trusting attacker bytes.
- **Don't mint/release before required finality.** Minting off a reorg-able source event is a double-spend; respect the CCTP finality threshold (and accept that only CCTP *Fast* lets Circle, not you, front the soft-finality risk).
- **Don't hardcode unverified program IDs or CCTP domains.** Domain ≠ chainId ≠ Wormhole chainId (Solana = 5); read Circle's table and pin program IDs from [resources.md](resources.md), confirming against official docs before mainnet.
- **Don't create a new wrapped representation** when an issuer-native rail (CCTP / your own NTT token) exists — multiple incompatible wrappers of "the same" asset are the classic liquidity-fragmentation trap.

Whatever you pick, the failure modes and the pre-integration checklist in [bridge-security.md](bridge-security.md) are mandatory, and every failure case should be written as a test (cross-domain: [../solana-testing/bug-class-playbook.md](../solana-testing/bug-class-playbook.md)).

_Last verified: June 2026_
