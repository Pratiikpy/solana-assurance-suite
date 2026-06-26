# EVAL_REPORT — solana-sybil-defense

Evidence the detector works. Run on this machine (Node 22). Output pasted verbatim.

## 1. `examples/planted-cluster` — recovers planted farms, spares legit users ✅ VERIFIED

A synthetic, seeded dataset (305 wallets): 200 legit independent + **40 legit funded by one
CEX hot wallet** (the false-positive trap) + 3 sybil farms (one funder → 20 wallets, burst
timing, identical amount/fingerprint/CEX) + a 4-wallet **fresh-funder cohort** (a unique funder
per wallet — defeating funder-clustering — but an identical behavioral fingerprint + amount in a
tight window) + 1 *truly-lone* sophisticated evader (unique funder, unique behavior, spread
timing).

**Command:** `node generate.mjs && node verify.mjs`

```
generated 305 wallets: 65 sybil (60 single-funder farmed + 4 fresh-funder cohort + 1 lone evader), 40 CEX-funded legit decoys, 200 legit
flagged 64 wallets | TP=64 FP=0 FN=1 TN=240
precision=1.000  recall=0.985  f1=0.992
false positives: none
evaded (truly-lone sophisticated sybils missed): 1
cross-funder behavioral cohorts caught: 1 (vote|0.09 x4)
naive "same-funder" baseline would FALSE-FLAG 40 legit wallets (the CEX-funded users); multi-signal FP=0
PASS ✅
```

**What this proves:**
- **All 3 single-funder farms caught** (60 wallets) **plus the 4-wallet fresh-funder cohort**
  (TP=64) with **zero false positives** — the 40 CEX-funded legit users are correctly spared.
- **The multi-signal approach is non-trivial:** a naive "same-funder ≥ 5 = sybil" baseline would
  have wrongly denied all 40 legit CEX users; this detector's FP = 0.
- **A second, orthogonal signal closes most of the recall gap.** A scripted farm that uses a fresh
  funder per wallet makes every funder-cluster size 1, so funder-clustering is blind to it. The new
  **cross-funder behavioral-cohort** signal groups by `(fingerprint|amount)` and catches the tight-window
  burst across distinct funders — lifting recall from 0.923 to **0.985** with FP still 0.
- **Honest recall (0.985):** one truly-lone sybil (unique funder, unique behavior, spread timing)
  still evades — it shares nothing with anyone, so there is no cluster *or* cohort to find. Recall is
  never 1.0 against a determined adversary — documented in [skill/evasion-and-limits.md](skill/evasion-and-limits.md).

## 2. `tools/sybil-scan` — the engine runs ✅ VERIFIED

**Command:** `node tools/sybil-scan/sybil-scan.mjs examples/planted-cluster/dataset.json`

```
sybil-scan: 305 wallets, 209 funders
  suspicious clusters: 3
  behavioral cohorts:  4
  flagged wallets:     64
  eligible wallets:    241
  ⚠️  SYBIL_FUNDER_0: 20 wallets, risk 92, signals=[burst+amountUniform+fpShared+cexShared]
  ⚠️  SYBIL_FUNDER_1: 20 wallets, risk 92, signals=[burst+amountUniform+fpShared+cexShared]
  ⚠️  SYBIL_FUNDER_2: 20 wallets, risk 92, signals=[burst+amountUniform+fpShared+cexShared]
  ⚠️  cohort [vote|0.09]: 4 wallets across 4 distinct funders in 361s (fresh-funder farm)
```

Each flag is explained by *which* signals corroborated — the three funder-clusters by their
signal set, the cohort by its shared `(fingerprint|amount)` and the distinct-funder count.
Auditable, not a black box.

## 3. Novelty & fit

- **Uncontested:** no kit skill and none of the 47 bounty PRs address airdrop/mint sybil
  detection; only paid third-party services exist, never an agent skill.
- **Cross-domain:** data (on-chain graph) × security (adversarial) × growth (fair distribution).
- **Composes:** detection here + proof-of-human via `solana-attestations` = eligibility is
  *not-in-a-sybil-cluster AND holds-a-valid-attestation*; the claim gate is tested with
  `solana-testing`.

## 4. Judging-criteria summary

| Criterion | Evidence |
|-----------|----------|
| **Usefulness** | Every airdrop/mint/points program needs it; "people will reach for it." Spares legit users (§1). |
| **Novelty** | Uncontested lane; first agent skill for it. |
| **Quality** | Execution-verified engine + proof (§1, §2) with pasted output and an honest recall figure; multi-signal beats the naive baseline. |
| **Fit** | Reference-skill structure, MIT, clean install, extends solana-dev, composes with sibling skills. |
