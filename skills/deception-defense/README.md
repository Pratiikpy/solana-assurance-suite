# deception-defense

**Stop shipping fake-green checkmarks.** Catch the deception defect class — code and UI that claim success, liveness, or verification they can't back up — before a judge or user does.

The most embarrassing defects aren't crashes. They're the lies the screen tells: a write that paints green on a **reverted** transaction, a hardcoded `LIVE` badge that stays green during an outage, a "Verified" / proof-of-reserves badge **nobody recomputes**, an admin "transfer ownership" button whose handler does nothing, a **dead CTA** that can be served to 100% of mobile users, a headline metric **typed in by hand**. These pass tests, pass a glance, and pass code review — then someone trusts them.

deception-defense is a focused review pass that hunts exactly this class. It ships a runnable static scanner **and** a live-review methodology, and it leads with one outcome: **nothing on screen claims something it can't prove.** Universal to any optimistic-UI app, with web3/Solana instances throughout.

## The seven patterns

| Pattern | The lie |
|---|---|
| optimistic-success | green before the write is confirmed |
| hardcoded-status-badge | a `LIVE`/`Verified` badge that can't go red |
| no-op-ceremony | an admin/transfer/upgrade that does nothing |
| fabricated-metric | a stat hardcoded in the UI, not real data |
| dead-cta | a button/link that goes nowhere |
| fake-verification | a "verified" badge nobody verified |
| mock-as-real | fixtures shipped as truth |

Full catalog (detection + fixes, web3 + universal): [`skill/patterns.md`](skill/patterns.md).

## Use it

```bash
# scan a codebase
node tools/deception-scan/deception-scan.mjs <path-to-app>

# CI gate: fail on any high-severity deception
node tools/deception-scan/deception-scan.mjs ./src --json   # see skill/scanner.md
```

Then drive the live flows against ground truth ([`skill/review-loop.md`](skill/review-loop.md)) — the highest-value catches only show at runtime. Or hand the job to the [`deception-hunter`](agents/deception-hunter.md) agent.

## Proof

`examples/planted-deception` plants all seven patterns in a fixture app alongside clean controls, then scores the scanner:

```bash
( cd examples/planted-deception && node verify.mjs )
# on the bundled fixtures: precision 1.000 · recall 1.000 · FP 0   (7 classes, zero false alarms on the clean controls)
```

Evidence over claims — see [EVAL_REPORT.md](EVAL_REPORT.md).

## Install

```bash
./install.sh        # copies skill/ into ~/.claude/skills/deception-defense
```

Part of the [Solana Assurance Suite](../../README.md). MIT.
