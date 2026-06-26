# Evasion and limits

Funding-cluster detection catches the cheap, scaled farms — one funder fanning SOL into
hundreds of wallets in a burst, identical amounts, identical on-chain behavior. It does not
catch a determined, well-funded adversary, and it never produces a verdict. Read this before
you trust a score. See [scoring-and-thresholds.md](./scoring-and-thresholds.md) for how scores
are derived and why the bar is set where it is.

## What the engine sees, and what that means

`sybil-scan` runs two passes. The first groups wallets by their first funder and flags a cluster
only when it is large (≥ `minCluster`) **and** shows ≥ 2 corroborating signals: a funding burst,
amount uniformity, shared behavioral fingerprint, or shared CEX tag. A single signal is never
enough — a CEX hot wallet funding many *legitimate* users trips only the `cexShared` signal and is
correctly left alone. The second pass ignores the funder entirely: it groups wallets by
`(fingerprint|amount)` and flags any tight-window burst of ≥ `cohortMin` (default 4) — the
**cross-funder behavioral-cohort** signal, which exists precisely to catch the farm that gives every
wallet its own funder. The detection surface is therefore the **funding graph, coarse behavior, and
behavioral cohorts across funders**. A sybil that shares none of these — no funder, no behavioral
cohort, no timing — is, by construction, invisible to it.

## How sophisticated sybils evade — and where the arms race now sits

The graph is only as connected as the adversary lets it be. Real evasion techniques, in
rough order of cost:

- **Unique funders.** Fund each wallet from a different source address. With no shared funder,
  the first pass sees only size-1 clusters — historically the single most effective evasion. **This
  alone is no longer sufficient:** if those wallets still share a behavioral fingerprint + amount in
  a tight window, the cross-funder cohort pass catches them anyway (see below). The adversary now has
  to randomize *behavior and timing too*, not just the funder.
- **CEX-routed funding.** Withdraw to each wallet directly from an exchange. The on-chain
  funding edge terminates at a shared deposit/withdrawal address used by thousands of real
  users, so the funder node is uninformative and we deliberately refuse to flag on it alone.
- **Organic-looking timing.** Spread funding over days or weeks instead of a burst. Defeats both the
  `burst` signal and the cohort window; the cluster, if any, looks like normal organic sign-up traffic.
- **Varied amounts.** Randomize funding amounts (and downstream activity) so no single value
  dominates a cluster — and so the `(fingerprint|amount)` cohort key never collides. Defeats
  `amountUniform` and the cohort grouping at once.
- **Diversified behavior.** Have each wallet touch a different program / mint / vote / stake so
  the behavioral fingerprint differs. Defeats `fpShared` and, again, the cohort key.
- **Aged wallets.** Pre-create and pre-fund wallets months ahead, sprinkle in incidental
  activity, then converge only at claim time. Age and history read as legitimate.

This is the arms race, stated honestly. Adding the cohort signal raised the bar: the cheap
"fresh funder per wallet" trick no longer works on its own, because a scripted farm that bothered
to vary the funder usually *didn't* bother to vary the behavior or stagger the timing — and that
laziness is exactly what the cohort pass exploits. To evade now, an operator must give each wallet a
unique funder **and** a distinct behavioral fingerprint **and** a non-colliding amount **and** spread
the timing. Stacking all of those reliably slips past a funding-graph detector — but each one costs
effort and shrinks the farm's economic edge. The engine is tuned to refuse easy false positives, and
that restraint, plus the breadth of behavior an evader must now fake, is precisely the remaining gap.

## The one it misses — measured, not asserted

The `planted-cluster` proof reports **precision 1.000, recall 0.985** on 305 wallets (65 planted
sybils, 240 legit). It flags all 60 wallets that belong to scaled single-funder farms, **plus the
4-wallet fresh-funder cohort** (`E300`–`E303`, caught by the cohort pass), and zero legit wallets.
The recall gap is exactly **1 evaded sybil** — `E304` in the dataset — and it is instructive
because it is engineered to share nothing with anyone:

| id   | funder (unique) | amount | cex    | fingerprint | why it evades                                  |
|------|-----------------|--------|--------|-------------|------------------------------------------------|
| E304 | F563046         | 0.15   | (none) | memo        | unique funder, unique behavior, spread timing  |

For contrast, the four wallets that *used* to evade and are now caught share an identical
`(vote\|0.09)` fingerprint+amount and fired within 361s of each other — a behavioral cohort across
four distinct funders, which the cohort pass flags despite there being no common funder.

`E304` has a **distinct funder**, sits below `minCluster`, routes through no CEX, and carries a
behavioral fingerprint it shares with no other sybil within a window. There is no cluster *and* no
cohort to find. A funding-graph detector cannot recover it without either off-chain identity signals
or a different graph (e.g. claim-time co-spending, downstream consolidation), both out of scope here.
This is the honest ceiling: **catching scaled farms and lazy fresh-funder farms is tractable;
catching a careful operator running a single hand-built wallet that mimics organic behavior is not,
from funding data alone.**

## Why precision must dominate

Recall and precision trade off, and we deliberately spend recall to buy precision. The reason is
asymmetric harm:

- A **missed sybil** dilutes an airdrop by one share. Annoying, bounded, recoverable.
- A **false-flagged legit user** is denied funds they earned, often with no recourse, sometimes
  publicly branded a cheater. That is a real person harmed by an automated guess.

The naive baseline makes this concrete. "Same funder ≥ 5 ⇒ sybil" would have **false-flagged 40
legitimate CEX-funded users** in this dataset — every real person who happened to withdraw from
the same exchange hot wallet. The multi-signal detector false-flags **zero**. The right way to
close the recall gap is an *orthogonal* signal that doesn't touch the funder threshold — exactly
what the cross-funder cohort pass is, and why it lifted recall to 0.985 with FP still 0. Lowering
the funder threshold to chase the last lone evader, by contrast, would reintroduce exactly that
class of harm. We do not make that trade. Bias to precision, and surface the one missed sybil as a
known, quantified limit rather than pretending it doesn't exist.

## What this is not

- **Not a verdict.** A flag is decision-support — a prioritized list for human review, not a
  conviction. Treat the score as "look here," never "deny this."
- **Not identity.** The engine sees funding and coarse behavior. It does not know who controls a
  wallet, and it must never request, infer, or store PII to find out.
- **Not legal or financial advice.** Eligibility, forfeiture, and clawback decisions carry legal
  and financial consequences that are the operator's responsibility, made with counsel — not
  delegated to a heuristic.
- **Not a substitute for human review.** Every flagged cluster, and every appeal, gets a human.
  Publish the methodology, provide an appeals path, and let people contest the machine.

The engine is a filter that removes obvious, scaled abuse cheaply and without collateral damage.
It is not, and cannot be, a complete defense. Anyone selling a funding-graph tool as
sybil-proof is selling false positives.

_Last verified: June 2026_
