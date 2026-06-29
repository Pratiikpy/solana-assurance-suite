---
name: deception-defense
description: Catch the deception defect class before a judge or user does — code and UI that claim success, liveness, or verification they can't back up. Use when prepping a demo, hackathon submission, audit, mainnet launch, or any release where the screen must not lie. Universal to any optimistic-UI app, with deep web3/Solana instances. Triggers — "is anything on screen faking it", "pre-demo check", "does this actually do what it says", "review before launch", "fake success", "dead button", "fake verified badge".
---

# deception-defense

The most embarrassing defects aren't crashes — they're the lies the UI tells. A write that paints green on a reverted transaction. A hardcoded `LIVE` badge that stays green while the backend is down. A "Verified" / proof-of-reserves badge nobody recomputes. An admin "transfer ownership" button wired to a method that exists on no contract. A dead CTA shipped to 100% of mobile users. A headline metric typed in by hand.

These pass tests, pass a glance, and pass code review — then a judge clicks the button, or a user trusts the badge, and the product is caught lying. **deception-defense is a focused review pass that hunts exactly this class.** It ships a runnable static scanner and a manual methodology, and it leads with the outcome: nothing on screen claims success, liveness, or verification it can't prove.

## The seven deception patterns

| Pattern | The lie | One-line tell |
|---|---|---|
| **optimistic-success** | green before the write is confirmed | success state set before the awaited receipt/`res.ok`/`value.err` check |
| **hardcoded-status-badge** | `LIVE`/`Operational`/`Verified` that can't go red | a literal status word, not derived from a check |
| **no-op-ceremony** | admin/transfer/upgrade that does nothing | an empty or stub-body handler on a transfer/upgrade/setAuthority name |
| **fabricated-metric** | a stat that isn't real data | a `$`/`%`/users number hardcoded in the UI, not bound to a source |
| **dead-cta** | a control that goes nowhere | `onClick={() => {}}`, `href="#"`, empty route |
| **fake-verification** | "verified" nobody verified | a proof/audit/verified badge with no verify/recompute call near it |
| **mock-as-real** | fixtures shipped as truth | mock/stub data imported into a runtime path, or a `USE_MOCK` flag left on |

Full catalog with web3 + universal instances, detection, and fixes: **[patterns.md](patterns.md)**.

## How to run it

1. **Scan.** Run the static scanner over the codebase — it flags the seven patterns with file:line evidence and a fix. See **[scanner.md](scanner.md)**.
   ```bash
   node tools/deception-scan/deception-scan.mjs <path-to-app>
   ```
2. **Review the live flows.** The scanner is static; the highest-value catches need the running app. Drive each money/state-changing flow and judge the result against the source of truth (not against "it looked fine"). See **[review-loop.md](review-loop.md)**.
3. **Fix and re-verify.** Apply the per-pattern fix, re-run the scan, re-drive the flow. A claim of "fixed" is a re-run, not an assertion.

## Operating rule

A success, liveness, or verification claim ships only when it is **derived from a real check that can fail**. If the badge can't go red, the number isn't bound, the button has no handler, or the proof is never recomputed — it's a deception defect, reported on line one with its file:line and the fix.

## Proof

`examples/planted-deception` plants all seven patterns in a fixture app alongside clean controls, then scores the scanner **on those fixtures: precision 1.000, recall 1.000, FP 0**. (That's its score on the planted shapes — a static scanner can't be a completeness or accuracy guarantee on arbitrary code; pair it with `review-loop.md`.) Run it:
```bash
( cd examples/planted-deception && node verify.mjs )
```
