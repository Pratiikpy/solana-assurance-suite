# Scoring & Thresholds — From Signals to a Decision (June 2026)

Detection produces signals; a launch needs a *decision*: claim or deny. This file is about that conversion, and about the one asymmetry that dominates every other choice — **a false positive (denying a real user) is far more expensive than a false negative (letting one sybil through).** A missed sybil costs you a few tokens. A wrongly-denied legitimate user costs you a public "this airdrop is a scam" thread, screenshots of the denial, and a refund process. Bias hard toward precision.

## How the engine scores

[`scan()`](../tools/sybil-scan/sybil-scan.mjs) clusters wallets by `funder`, evaluates four boolean signals per cluster, then scores (a separate cross-funder cohort pass, below, catches farms that defeat funder-clustering):

```
suspicious = size >= MIN (default 5) AND signalCount >= 2
risk       = suspicious ? min(100, 40 + min(size, 30) + signalCount * 8)
           : size >= MIN ? 20 : 0
```

The four signals (each must clear a threshold over the cluster):
- **`burst`** — funding spread ≤ `burstWindow` (default 3600s). Real users don't all get funded in the same hour.
- **`amountUniform`** — ≥ `uniformity` (default 0.7) of the cluster shares the modal funding amount. Farms script identical amounts.
- **`fpShared`** — ≥ 0.7 share the same behavioral `fingerprint`. Farms run identical instruction sequences.
- **`cexShared`** — ≥ 0.7 trace to the same exchange.

## The cross-funder cohort pass — past the funder-clustering ceiling

Funder-clustering has a structural blind spot: a farm that uses a **fresh funder per wallet** produces only size-1 clusters, so no funder ever clears `MIN` and the four signals above never even run on it. The engine closes this with a second, orthogonal pass that ignores the funder entirely — it groups by `(fingerprint|amount)` and flags any tight-window burst of `>= COHORT_MIN` (default 4) wallets, **even when every funder is distinct**:

```
group wallets by `${fingerprint}|${amount}`
within each group, slide a COHORT_WINDOW (default 900s) window over sorted fundedAt
if any window holds >= COHORT_MIN wallets -> flag them all (record distinctFunders)
```

The false-positive guard is the conjunction: a benign population does not share an *exact* behavioral fingerprint **and** an exact amount **and** fire inside a 15-minute window. In the proof the cohort's amount (0.09 SOL) appears in no legit set, and the four cohort wallets land within 361s — a coincidence that legit users, with their diverse amounts and spread timing, structurally cannot produce at `COHORT_MIN`. This is what lifts recall from 0.923 (funder-clustering alone) to **0.985** with FP still 0. Full signal mechanics in [clustering-signals.md](clustering-signals.md).

## Why two signals, not one — the precision lever

The single most important design choice: **`size >= MIN` alone is not enough, and any *one* signal alone is not enough.** Requiring `signalCount >= 2` is what separates this from a naive detector.

The canonical trap is a CEX hot wallet that funds thousands of *real* users. It trivially satisfies `size` and `cexShared` — a naive "same funder ⇒ sybil" or "same funder + CEX" rule flags every one of them. But real users have diverse timing (`burst` false), diverse amounts (`amountUniform` false), and diverse behavior (`fpShared` false), so they never reach two signals. A farm — one funder, scripted in a burst, identical amounts, identical behavior — lights up three or four.

This is exactly the [planted-cluster proof](../examples/planted-cluster/): 200 independent legit + 40 CEX-funded legit decoys + 60 single-funder farmed sybils + a 4-wallet fresh-funder cohort + 1 truly-lone evader. Verified result:

```
precision=1.000  recall=0.985  f1=0.992  (TP=64 FP=0 FN=1 TN=240)
cross-funder behavioral cohorts caught: 1 (vote|0.09 x4)
naive "same-funder" baseline would FALSE-FLAG 40 legit wallets; multi-signal FP=0
```

**Precision 1.0** — zero legit users denied. **Recall 0.985** — and this is the honest part: **recall is never 1.0.** The one missed wallet is a *truly-lone* sybil with a unique funder, unique behavior, and spread timing — it shares nothing with anyone, so there is neither a funder-cluster nor a behavioral cohort to find. (The 4-wallet fresh-funder cohort that funder-clustering alone would have missed is now caught by the cross-funder cohort pass above — that is the 0.923 → 0.985 jump.) Funding-graph analysis cannot catch a sybil that doesn't cluster *and* doesn't share a behavioral cohort. Anyone promising 100% recall is either over-flagging (destroying precision) or lying. Closing that last gap needs orthogonal signals — proof-of-humanity (see [integration.md](integration.md) and `../solana-attestations`), device/biometric attestation, or graph methods (chain-like transfer graphs, à la Trusta TrustScan) — not a tighter threshold here.

This matches the industry consensus: Trusta Labs' published framework is explicitly **two-phase** — graph mining to find coordinated communities, then behavioral refinement to *cut false positives* — for the same reason. Catching clusters is easy; not punishing innocents is the hard part, and it's where precision is won or lost.

## The cost asymmetry, quantified

Make the bias explicit by pricing the two error types, then tune to minimize *expected cost*, not raw error rate:

```js
// Per-error cost model. FP (deny a real user) is 50-100x an FN (pay one extra sybil).
const COST_FP = 1000;   // reputational + support + refund: a screenshotted denial
const COST_FN = 10;     // one extra allocation leaked to a sybil
const expectedCost = (fp, fn) => fp * COST_FP + fn * COST_FN;

// On the planted set: multi-signal (fp=0, fn=1) vs naive same-funder (fp=40, fn=0)
expectedCost(0, 1);    // = 10      <- ship this
expectedCost(40, 0);   // = 40000   <- 4000x worse, despite "catching everything"
```

The naive detector has *better recall* and is catastrophically worse. Recall optimization without this cost lens is how teams ship airdrops that deny their most loyal CEX-funded users. Pick `COST_FP/COST_FN` for your launch's stakes; the higher the brand sensitivity, the more you push the signal requirement up.

## Tuning the knobs

| Knob | Default | Direction | Effect |
|---|---|---|---|
| `minCluster` | 5 | ↑ | fewer, larger clusters considered; misses small farms, lowers FP risk |
| `burstWindow` | 3600s | ↓ | tighter timing; more precise, may miss slow-drip farms |
| `uniformity` | 0.7 | ↑ | demands tighter amount/behavior match; ↑ precision, ↓ recall |
| signal requirement | `>= 2` | ↑ to 3 | near-zero FP, recall drops as you demand more corroboration |
| `cohortMin` | 4 | ↑ | larger cross-funder cohort required; misses small fresh-funder farms, lowers FP risk |
| `cohortWindow` | 900s | ↓ | tighter cohort window; more precise, may miss slow-drip fresh-funder farms |

**Tune on labelled data, not vibes.** Use [`examples/planted-cluster/verify.mjs`](../examples/planted-cluster/verify.mjs) as the template: hold a ground-truth set, sweep the knobs, and pick the point that keeps **precision at 1.0** while recall is as high as it'll go. The CI gate there enforces `precision >= 0.95 && recall >= 0.95 && fp < naiveBaseline && freshFunderCohorts >= 1` — copy that gate; never let a config change regress precision, or silently lose the cross-funder cohort catch.

## From `risk` to a verdict

`risk` is 0–100 but the engine's `flagged` set is already the binary decision (`suspicious === true`). Treat `risk` as the *triage ordering*, not a second threshold to re-litigate:

```js
import { scan, eligibility } from "../tools/sybil-scan/sybil-scan.mjs";
const result = scan(wallets);                              // result.flagged is the deny set
const eligible = eligibility(wallets, result);            // ids that pass

// Risk bands for human workflow, NOT for auto-denial beyond `flagged`:
for (const c of result.clusters) {
  if (c.risk >= 70)      c.action = "deny";                // high-confidence farm
  else if (c.risk >= 40) c.action = "deny + log";          // flagged, review on appeal
  else if (c.risk >= 20) c.action = "watch";               // big-but-clean funder; monitor
  else                   c.action = "allow";
}
```

Do not invent a "risk > 35" auto-deny that flags clusters the engine deemed *not* suspicious — that re-introduces the single-signal false positives the design eliminated.

## Overrides — allowlist / denylist

Policy beats statistics. Two override sets, applied *after* scoring, both auditable:

```js
const ALLOWLIST = new Set([/* known team, partners, audited contracts, public goods */]);
const DENYLIST  = new Set([/* confirmed bad funders / wallets from manual investigation */]);

function decide(walletId, funder, result) {
  if (ALLOWLIST.has(walletId)) return { eligible: true,  reason: "allowlist" };
  if (DENYLIST.has(funder) || DENYLIST.has(walletId)) return { eligible: false, reason: "denylist" };
  return { eligible: !result.flagged.has(walletId), reason: "scan" };
}
```

- **Allowlist** is your precision insurance for known-good entities the heuristics might catch (e.g. a treasury that funds many wallets, a multisig). It always wins.
- **Denylist** captures what statistics miss — confirmed sybils surfaced by investigation, leaked farm lists, the lone evader once you identify it out-of-band.
- Keep both in version control with a one-line justification per entry. When someone asks "why was I denied," you need an answer that isn't "the algorithm."

## Appeals & manual review — non-negotiable

Because recall < 1.0 cuts both ways (and your label data is imperfect), **ship an appeals path before you ship the airdrop.** A denied legitimate user with no recourse is the PR disaster precision was supposed to prevent.

- **Publish the cluster, not just the verdict.** For any flagged wallet, surface *why*: funder, cluster size, which signals fired (`burst+amountUniform+fpShared`). Opaque denials read as arbitrary.
- **Human review queue.** Route appeals (and the `risk 40–69` band) to a reviewer who can see the cluster and the wallet's full history. Most genuine appeals are wallets caught in a cluster they didn't coordinate — easy to clear with the funding graph in front of you.
- **Override is an allowlist add**, recorded with the reviewer and reason. This both fixes the case and improves future tuning data.
- **Rate-limit and authenticate appeals** (e.g. require a signature from the wallet) so the appeals queue isn't itself farmed.

## The honest summary to publish

When you announce methodology (see [eligibility-export.md](eligibility-export.md)), state it plainly: *"We cluster by funding source and require multiple corroborating signals before excluding a wallet, plus a cross-funder behavioral-cohort check that catches farms using a fresh funder per wallet. On our validation set this denied zero legitimate users (precision 1.0) and caught 98.5% of planted sybils (recall 0.985). A sophisticated, well-funded sybil that shares no funder, behavior, or timing with anyone can still evade funding-graph analysis; we layer proof-of-humanity to raise the bar. Denied? Appeal here."* Honest beats heroic. Claiming you stopped 100% invites someone to prove you didn't — publicly.

_Last verified: June 2026_
