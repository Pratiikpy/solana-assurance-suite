# planted-cluster — does the detector actually work?

A self-checking proof. `generate.mjs` builds a seeded synthetic dataset with **known**
ground-truth labels; `verify.mjs` runs `sybil-scan` and asserts it recovers the planted
sybil farms with high precision/recall **without** flagging the legit decoys — exiting
non-zero on failure (CI-gateable).

## The dataset (deterministic, seed 1337)

- **200 legit** independent wallets — unique funders, diverse timing/amounts/behavior
- **40 legit funded by one CEX hot wallet** — the false-positive trap: same funder, but real
  users, so diverse timing/amounts/fingerprints
- **3 sybil farms** — one funder → 20 wallets each, burst timing, identical amount + fingerprint + CEX
- **4 fresh-funder cohort sybils** — a *unique* funder per wallet (so funder-clustering sees only
  size-1 clusters), but an identical behavioral fingerprint + amount (`vote` / 0.09 SOL) fired in a
  tight window — caught by the cross-funder behavioral-cohort signal
- **1 truly-lone evasive sybil** — unique funder, unique behavior, spread timing; shares nothing
  with anyone, so it has no cluster or cohort (expected to evade — honest recall < 1.0)

## Run

```bash
node generate.mjs   # writes dataset.json
node verify.mjs     # asserts precision/recall; exit 0 = PASS
```

## Verified output

```
flagged 64 wallets | TP=64 FP=0 FN=1 TN=240
precision=1.000  recall=0.985  f1=0.992
cross-funder behavioral cohorts caught: 1 (vote|0.09 x4)
naive "same-funder" baseline would FALSE-FLAG 40 legit wallets; multi-signal FP=0
PASS ✅
```

## Why it's not a toy

The decoy group is the whole point: a naive "same funder ⇒ sybil" filter — what a rushed
team actually ships — would deny all 40 legit CEX-funded users. The multi-signal detector
gets **FP=0**. The fresh-funder cohort is the other half of the lesson: it gives every wallet
its own funder, so funder-clustering is structurally blind to it — yet the cross-funder
behavioral-cohort signal catches all four on their shared `(vote|0.09)` fingerprint+amount in a
tight window, lifting recall from 0.923 to **0.985**. And recall is honestly **0.985**, not 1.0:
one truly-lone sybil still evades, because a determined adversary who shares *nothing* always can
(see [../../skill/evasion-and-limits.md](../../skill/evasion-and-limits.md)). The skill is
decision-support with appeals, not an oracle.

_Last verified: June 2026 — Node 22._
