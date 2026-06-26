# The Sybil Landscape: Airdrop & Mint Farming on Solana

Sybil farming is one operator masquerading as many independent users. On Solana the unit
of identity is a keypair, and keypairs are free — `Keypair.generate()` mints a fresh
"user" in microseconds. Any reward that pays per-wallet (airdrop, points program, NFT
allowlist, gas rebate, testnet incentive) is therefore a target: a farmer who can look
like 5,000 users captures 5,000x the allocation of an honest one. The defender's job is
to find the wallets that share a single hidden operator and exclude them **without
punishing the legitimate users who happen to look superficially similar.**

This skill is the detection engine for that problem. Read this file for the threat model,
then route into the mechanics:
- [clustering-signals.md](./clustering-signals.md) — the signals, how to compute each, and the false-positive trap of each.
- [funding-graph.md](./funding-graph.md) — building the on-chain funding graph and running union-find to form clusters.
- [data-sources.md](./data-sources.md) — where the raw transaction data comes from.

## Why airdrops, mints, and points get farmed

Token distributions are large and per-wallet. Jupiter's Jupuary 2025 airdrop distributed
~700M JUP; Wormhole's April 2024 drop sent 617M W (6.17% of supply) to ~400K wallets;
Kamino, Jito, Drift, Kamino, and Backpack all ran multi-hundred-million-token drops. When
the marginal cost of an extra "user" is ~0.002 SOL of rent plus a few signatures, and the
marginal reward is hundreds to thousands of dollars, farming is rational and industrial.
An entire tooling economy exists for it: multi-wallet managers, antidetect browsers,
residential-proxy pools, and "how not to get flagged" guides that explicitly teach
operators to vary funding sources and randomize behavior.

The scale is not hypothetical. Jupiter publicly reported **over 750,000 wallets flagged**
as bot/sybil/inorganic in Jupuary 2025. Wormhole and Drift both partnered with Allium and
Trusta Labs specifically to cluster farm wallets out of their distributions. This is now a
standard, expected line item in any serious Solana token launch.

## The attacker playbook

A mature farming operation runs an assembly line. The stages below are what leave
detectable structure on-chain — each maps to a signal in
[clustering-signals.md](./clustering-signals.md).

1. **Bulk wallet generation.** Generate hundreds to thousands of keypairs from one script.
   No on-chain trace yet, but downstream the wallets will share funding and behavior.
2. **Single-funder fan-out (radial / "diffusion").** The cheap, lazy pattern: one funding
   wallet sends SOL to all the farm wallets — "funded 50 wallets from one source." On a
   transfer graph this is a star: one hub, many leaves. Wormhole named this *diffusion
   funding* ("Wallet A funds B, C, D … Z"). It is the single most common and most
   detectable mistake farmers make.
3. **Peeling chains (sequential / "sequential diffusion").** To hide the star, the operator
   chains funding: A→B, B→C, C→D, each hop peeling off a near-identical amount to a new
   wallet and forwarding the remainder. This produces a "domino" of linked wallets with
   characteristic decreasing or fixed-step balances. Still one connected component under
   graph traversal.
4. **CEX-deposit reuse.** The sophisticated move: fund every farm wallet directly from a
   centralized-exchange withdrawal. Now the apparent funder is a Coinbase/Binance/Kraken
   hot wallet shared by **millions of legitimate users**, so naive source-tracing
   collapses — this is exactly where single-signal detection produces mass false
   positives. Defeating it requires *additional* signals (timing burst, amount uniformity,
   shared behavior), not the funder alone.
5. **Scripted identical behavior.** Because the wallets are driven by one program, they
   tend to touch the same Solana programs in the same order (e.g. swap → stake → claim),
   with the same instruction shapes — a behavioral fingerprint. Wormhole used a Louvain
   community-detection pass over a transaction-similarity matrix to catch exactly this.
6. **Timing bursts.** Scripts loop fast. The whole farm gets funded, or makes its first
   protocol interaction, inside a tight window — Drift's giveaway tell was "a sudden surge
   in the number of wallets funded from the same CEX address, depositing their first
   amounts within a narrow timeframe."
7. **Rent/gas uniformity.** Wallets created by the same script share account-creation
   patterns: identical rent-exempt funding amounts, identical leftover balances, the same
   priority-fee settings. Cheap to detect, cheap to spoof — useful only as corroboration.

Sophisticated operators deliberately break stages 2–7: unique funders per wallet, random
delays, varied amounts, decoy program calls, residential proxies for the RPC layer. A farm
that breaks *only* the funder link — a fresh funder per wallet — is still caught, because the
engine cross-checks a **behavioral cohort** across funders (identical fingerprint + amount in a
tight window); it takes breaking funder, behavior, amount, and timing *together* to evade. Such a
truly-lone wallet **will evade** funding-graph detection — and that is acceptable. The goal is not
to catch every sybil; it is to catch the cheap industrial farms (which are the bulk of the
volume) at zero cost to legitimate users. The proof in this skill honestly reports
recall 0.985 precisely because one hand-crafted, share-nothing evasive sybil slips through.

## The defender's goal: fairness, not maximal flagging

The asymmetry that defines this problem: **a false negative costs the protocol a few
tokens; a false positive tells a real user "you're a bot" and disqualifies them.** The
second is reputationally and ethically far worse, and it is the easy mistake to make. The
canonical trap is the CEX hot wallet: thousands of genuine users withdraw their first SOL
from the same Binance address, so "they share a funder" is true and meaningless. A detector
that flags on shared funder alone will disqualify all of them.

Drift's own writeup states the rule plainly: *"Disqualifying wallets based on surface-level
analysis of deposit sizes, trading volumes, or transaction patterns often leads to false
positives, as traders frequently use multiple wallets for security reasons."* The correct
posture is **require multiple corroborating signals before flagging**, and bias toward not
flagging when in doubt. Pair detection with an appeals path (Jupiter let flagged users
appeal with one CEX email or two Web2 emails) and, where possible, with positive
proof-of-personhood (see [../solana-attestations](../solana-attestations) for
attestation-based proof-of-human, which raises the floor so detection only has to catch
what attestation misses).

## How this skill implements that

`tools/sybil-scan/sybil-scan.mjs` is the runnable engine. Its design is the whole lesson
made executable:

- **Group by funder** (the funding edge), then for each candidate cluster compute four
  independent signals: timing **burst** (all funded inside a window), amount **uniformity**
  (a dominant funding amount), behavioral-**fingerprint** sharing, and **CEX** sharing.
- **Flag only on size ≥ N AND ≥ 2 corroborating signals.** A CEX-only cluster (one signal —
  many users share the exchange) is **not** flagged. A farm (one funder + burst + identical
  amounts + same behavior) is.
- **Then run a cross-funder behavioral-cohort pass** that ignores the funder and groups by
  `(fingerprint|amount)`, flagging any tight-window burst of ≥ 4 wallets across distinct funders —
  catching the fresh-funder farm that funder-clustering structurally misses.

The verified proof in [../examples/planted-cluster](../examples/planted-cluster) plants 3
single-funder farms (60 wallets), a 4-wallet fresh-funder cohort, 1 truly-lone evasive sybil, 40
legit users all funded from one CEX hot wallet, and 200 independent legit users, then runs the engine:

```
precision=1.000  recall=0.985  f1=0.992   FP=0   evaded=1
cross-funder behavioral cohorts caught: 1 (vote|0.09 x4)
naive "same-funder" baseline would FALSE-FLAG 40 legit wallets; multi-signal FP=0
```

The naive same-funder baseline disqualifies all 40 CEX-funded real users. The multi-signal
engine flags zero of them while recovering every single-funder farm wallet *and* the fresh-funder
cohort. That gap — 40 wrongly punished users vs. 0 — is the entire reason this skill requires
signal combination rather than any single rule.

## When to use this skill

Use it whenever you are deciding who is a real user for a per-wallet reward:
- Building an airdrop or points-program eligibility list.
- Gating an NFT mint allowlist or a fair-launch participant set.
- Auditing a completed distribution for farm capture.
- Investigating a suspected wallet cluster for governance or grants.

Do **not** use it as the sole gate for high-stakes identity (KYC, financial limits) — it is
a probabilistic clustering tool, not proof of personhood. Combine with attestations
([../solana-attestations](../solana-attestations)) for that, and test detection changes
against a labeled fixture before shipping ([../solana-testing](../solana-testing)).

## Sources

- Drift × Allium, *Sybil Analysis and Detection* — funding-source clustering, multiple-first-funder masking, the CEX false-positive problem.
- Allium / Wormhole, *From Eligibility to Sybil Detection* — diffusion vs. sequential-diffusion funding, Louvain on a transaction-similarity matrix, "spectrum of aggressiveness."
- Jupiter Jupuary 2025 anti-sybil criteria and appeal process (>750K wallets flagged).
- Trusta Labs funding-source + time-weighted clustering used in the Wormhole drop.

_Last verified: June 2026_
