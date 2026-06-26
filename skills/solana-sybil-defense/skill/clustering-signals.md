# Clustering Signals: What to Compute, and the Trap in Each

The core thesis of this skill, stated once and never violated: **no single signal is
sufficient to flag a wallet as sybil.** Every individual signal below has a benign
explanation that fires on real users. Detection is the *intersection* of signals, not the
union. This is the discipline `tools/sybil-scan/sybil-scan.mjs` enforces and that the
[../examples/planted-cluster](../examples/planted-cluster) proof demonstrates: a naive
same-funder rule false-flags 40 legitimate CEX-funded users; requiring ≥2 corroborating
signals flags 0 of them while still catching every planted farm.

For where the raw data comes from, see [funding-graph.md](./funding-graph.md) and
[data-sources.md](./data-sources.md). This file is the signal catalog and the
combination logic.

---

## (1) Common-funder fan-out (radial / diffusion)

**What it is.** One funding wallet sends SOL to N farm wallets — Wormhole's "diffusion
funding": *Wallet A funds B, C, D … Z*. On a transfer graph it's a star.

**Compute.** Resolve each wallet's *first funder* (the source of its genesis transfer —
see [funding-graph.md](./funding-graph.md)), then group wallets by funder. A funder with
an unusually large fan-out (≥ N leaves, where N is your `minCluster`) is a candidate. In
the engine this is the primary grouping key:

```js
const byFunder = new Map();
for (const w of wallets) (byFunder.get(w.funder) ?? byFunder.set(w.funder, []).get(w.funder)).push(w);
```

**False-positive trap.** A **CEX hot wallet** is the highest-fan-out funder on Solana and
funds millions of *legitimate* first-time users. So is a launchpad, a payroll dispenser, a
custody omnibus, or a popular faucet. High fan-out alone means nothing. This is why the
funder is only the *grouping key*, never the *flag*.

---

## (2) Funding timing bursts

**What it is.** Scripted farms fund (and first-act) in a tight window — Drift's tell was "a
sudden surge in wallets funded from the same CEX address … within a narrow timeframe."

**Compute.** Within a funder's cluster, take the spread of first-funding timestamps; if it
collapses into a short window it's bursty:

```js
const times = ws.map(w => w.fundedAt);
const spread = Math.max(...times) - Math.min(...times);
const burst = spread <= BURST;        // default 3600s; tighter => more suspicious
```

Refinements: inter-arrival regularity (near-constant gaps scream cron loop), and bursts
that coincide with a known farming event (a points snapshot, a mint open).

**False-positive trap.** Real bursts happen: a CEX processes a wave of withdrawals after a
listing; everyone rushes a hyped mint in the same hour. Timing alone over-flags any popular
moment. Burst is corroboration, not a verdict.

---

## (3) Identical / near-identical funding amounts (peeling)

**What it is.** Scripts send the same amount to every wallet (e.g. exactly 0.022 SOL), or
peel a fixed step down a chain (peeling chains, signal 6). Genuine users send arbitrary,
varied amounts.

**Compute.** Measure the *mode share* — the fraction of the cluster matching the most
common amount. High mode share = artificial uniformity:

```js
const modeShare = (ws, key) => {
  const counts = {}; for (const w of ws) { const v = w[key]; if (v != null) counts[v] = (counts[v]||0)+1; }
  return Object.keys(counts).length ? Math.max(...Object.values(counts)) / ws.length : 0;
};
const amountUniform = modeShare(ws, "amount") >= UNIF;   // default 0.7
```

Use a tolerance band (round to a tick, or cluster within ε) for "near-identical" — farmers
sometimes jitter amounts by a few lamports thinking it helps.

**False-positive trap.** Round numbers are natural: lots of people withdraw exactly 0.1 SOL
or the rent-exempt minimum. A cluster of "everyone sent 0.1" can be coincidence at small N.
Uniformity is strong *only* combined with a shared funder + burst.

---

## (4) Shared CEX deposit / withdrawal address

**What it is.** Many farm wallets either withdraw from the same exchange address or, on
cash-out, sweep back into the same deposit address. Same-deposit-on-exit is a particularly
strong tie because exchange deposit addresses are typically per-user.

**Compute.** Tag each funding/cash-out counterparty against a known-exchange address list
(see [funding-graph.md](./funding-graph.md) for sourcing + heuristics), then mode-share the
CEX tag across the cluster:

```js
const cexShared = modeShare(ws, "cex") >= UNIF;
```

**False-positive trap — the central one.** A CEX *withdrawal* hot wallet is shared by all
that exchange's users; "funded from Binance" describes a huge swath of honest Solana. The
engine treats CEX sharing as **just one signal** and explicitly refuses to flag on it
alone:

> *"cex-only (1 signal) is not enough — that's the CEX-funded-legit case."* — `sybil-scan.mjs`

This is exactly the 40-wallet decoy set in the proof: all share `CEX_HOT_WALLET`, all
tagged `binance`, and the engine correctly leaves every one eligible.

---

## (5) Behavioral fingerprint (program-interaction sequence)

**What it is.** Wallets driven by one script touch the same programs in the same order with
the same instruction shapes — swap→stake→claim, identical compute-budget, identical
account layouts. Wormhole caught this by running **Louvain community detection on a
similarity matrix of transaction sequences** across ownership clusters.

**Compute.** Reduce each wallet's history to an ordered fingerprint — e.g. the sequence of
program IDs (or named actions) it invoked. Cheap version: a canonical string/hash of the
ordered action set, then mode-share it. Stronger version: pairwise Jaccard similarity over
(timestamp, program, params) sequences feeding DBSCAN or Louvain — but beware cost (every
wallet needs full history).

```js
const fpShared = modeShare(ws, "fingerprint") >= UNIF;   // fingerprint = ordered programs touched
```

**False-positive trap.** Honest users of one protocol all do the protocol's happy path —
of course Drift traders all "deposit → trade." A fingerprint that *is* the product's
intended flow proves nothing. Discriminating power comes from sequences that are unusual
*and* shared across a funding cluster.

---

## (6) Graph connectivity (union-find over funding edges)

**What it is.** Funder grouping (signal 1) only catches one-hop stars. Peeling chains
(A→B→C→D) and multi-funder masking (operator uses several first-funders) hide the star, but
the wallets remain **one connected component** in the transfer graph. Union-find recovers
the whole component.

**Compute.** Add an edge for every funding/transfer relationship, then union endpoints; each
disjoint set is a candidate cluster. See [funding-graph.md](./funding-graph.md) for the full
implementation. The point here: connectivity *expands* a candidate cluster beyond a single
funder — you then run signals 2–5 *on the whole component* before judging it.

**False-positive trap.** Components grow without bound through shared hubs. Route everyone's
funding through one CEX hot wallet and union-find merges the entire chain's users into a
single blob. **You must cut high-degree hub nodes (CEX, bridges, DEX routers, mint
authorities) out of the edge set before unioning**, or the graph collapses into one
meaningless mega-cluster. Connectivity is a candidate generator, never a flag.

---

## (7) Gas / rent patterns

**What it is.** Same-script wallets share creation mechanics: identical rent-exempt funding
(e.g. the exact ATA rent), identical leftover dust, identical priority-fee / compute-budget
settings, the same "create N token accounts then act" prologue.

**Compute.** Mode-share the rent/fee/leftover values across the cluster, same `modeShare`
helper. Treat as a weak corroborating signal — fold it into the fingerprint if you want.

**False-positive trap.** Rent-exempt minimums are protocol constants — *everyone* pays the
same ATA rent; default priority fees are wallet-software defaults shared by millions. This
signal is the easiest to spoof and the easiest to false-positive on. Use it only to nudge
an already-multi-signal cluster, never to originate a flag.

---

## (8) Cross-funder behavioral cohort (the fresh-funder-farm signal)

**What it is.** Signals 1–7 all hang off the funding graph: group by funder, then corroborate.
That has a structural blind spot — a farm that uses a **fresh funder per wallet** produces only
size-1 funder-clusters, so nothing ever clears `minCluster` and signals 2–5 never even run on it.
This is the cheapest evasion an operator can buy, and funder-clustering is, by construction, blind
to it. But the wallets still betray themselves: a *script* that bothered to randomize the funder
usually did **not** bother to randomize behavior, amount, and timing. They share an identical
behavioral fingerprint + funding amount and fire in a tight window — a cohort that is invisible on
the funder axis but obvious on the behavior axis.

**Compute.** Ignore the funder entirely. Group wallets by `(fingerprint|amount)`, sort each group
by `fundedAt`, and slide a window; flag any window holding `>= COHORT_MIN` wallets — *even when
every funder is distinct*:

```js
const byBehavior = new Map();
for (const w of wallets) {
  const k = `${w.fingerprint}|${w.amount}`;
  (byBehavior.get(k) ?? byBehavior.set(k, []).get(k)).push(w);
}
for (const [key, ws] of byBehavior) {
  if (ws.length < COHORT_MIN) continue;                 // default 4
  const sorted = [...ws].sort((a, b) => a.fundedAt - b.fundedAt);
  let i = 0;
  for (let j = 0; j < sorted.length; j++) {
    while (sorted[j].fundedAt - sorted[i].fundedAt > COHORT_WINDOW) i++;  // default 900s
    if (j - i + 1 >= COHORT_MIN) { /* flag sorted[i..j]; record distinctFunders */ break; }
  }
}
```

**False-positive guard — the conjunction is the whole point.** The cohort key is `fingerprint`
**and** `amount` together, and the trigger additionally requires `COHORT_MIN` of them inside
`COHORT_WINDOW`. A benign population does not share an *exact* behavioral fingerprint **and** an
*exact* amount **and** converge inside a ~15-minute window — legit users have diverse amounts and
spread timing precisely where a farm has neither. In the [planted-cluster proof](../examples/planted-cluster/)
the cohort amount (0.09 SOL) appears in **no** legit set, the four wallets land within 361s, and
they use four distinct funders — so the cohort pass flags all four (`vote|0.09 x4 across 4 distinct
funders`) while touching zero legit wallets. This is what catches the fresh-funder farm that funder
fan-out (signal 1) structurally cannot, and it is why recall rises from 0.923 (funder-clustering
alone) to **0.985** with FP still 0. Keep `COHORT_MIN` ≥ 4 and `COHORT_WINDOW` tight, and treat an
off-distribution amount as a strong corroborator — loosening either is how this signal would start
catching popular-mint waves.

## The combination logic (the part that matters)

Every signal above is individually defeatable by a benign explanation. The engine's rule:

```js
const signals = { burst, amountUniform, fpShared, cexShared };
const signalCount = Object.values(signals).filter(Boolean).length;

// size gate + at least TWO independent corroborating signals.
const suspicious = size >= MIN && signalCount >= 2;

const risk = suspicious
  ? Math.min(100, 40 + Math.min(size, 30) + signalCount * 8)   // monotone in size & signals
  : size >= MIN ? 20 : 0;
```

Why this works, in one line per axis:
- **Size gate (`MIN`)** — a handful of wallets sharing a funder is noise; farms are bulk.
- **`signalCount >= 2`** — defeats every single-signal trap. CEX-only? one signal, not
  flagged. A coincidental burst? one signal, not flagged. A farm is burst + uniform +
  shared-behavior simultaneously — multiple independent signals lining up, which benign
  populations do not do at scale.
- **Risk is monotone** in both cluster size and signal count, so triage naturally surfaces
  the biggest, most-corroborated farms first.

The funder-cluster rule above is one of two passes. The cross-funder cohort pass (signal 8) runs
independently and adds its own flags — a wallet is in the deny set if it is in a suspicious funder
cluster **or** in a flagged behavioral cohort.

**Tunable aggressiveness.** Wormhole framed detection as lying "on a spectrum via parameters
that tune the aggressiveness of the filtering." Here those parameters are explicit:
`minCluster` (size floor), `burstWindow` (timing tightness), `uniformity` (mode-share
threshold), the `signalCount` requirement, and — for the cohort pass — `cohortMin` (cohort size
floor) and `cohortWindow` (cohort timing tightness). Loosen them and you catch more sophisticated
sybils at the cost of false positives; tighten them and you protect legit users at the cost
of recall. The default (`MIN=5, BURST=3600, UNIF=0.7, signals≥2, COHORT_MIN=4, COHORT_WINDOW=900`)
is biased toward precision — **never punish a real user** — which is why the proof reports precision
1.000, FP 0, and honestly accepts recall 0.985 (one truly-lone evasive sybil escapes; the
fresh-funder cohort is caught by signal 8).

**What this does not catch, by design.** A truly-lone sophisticated sybil with a unique funder,
jittered timing, a varied amount, **and** a behavioral fingerprint it shares with no one presents
neither ≥2 funder signals nor a behavioral cohort, and passes. The cheap "fresh funder per wallet"
trick no longer evades on its own — signal 8 catches it the moment the wallets share behavior +
amount + timing. That is the correct trade: combine with proof-of-personhood
([../solana-attestations](../solana-attestations)) to raise the floor, and validate any threshold
change against the labeled fixture ([../solana-testing](../solana-testing)) before shipping.

## Sources

- Allium / Wormhole — Louvain community detection on a transaction-similarity matrix; aggressiveness-as-a-spectrum.
- Drift × Allium — CEX-funded false-positive problem; "narrow timeframe" funding surge as the tell.
- Clustering-based sybil detection — radial vs. sequential transfer patterns, similarity + density clustering, combining funding-flow and dApp-activity signals.

_Last verified: June 2026_
