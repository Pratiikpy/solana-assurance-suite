# The live review loop (what the scanner can't see)

The static scanner catches the patterns that show in source. The most damaging deceptions only show when the app runs: a write that paints green on a revert, a badge that stays green during an outage, a CTA dead only on mobile. Those need the running product, driven the way a skeptical user would, and judged against the source of truth — not against "it looked fine."

## ACT → OBSERVE → AUDIT

For every flow that claims success, liveness, or verification:

1. **ACT.** Do the real action. Submit the form, send the transaction, trigger the state change. Then do the adversarial version: reject the wallet signature, submit with insufficient balance, kill the network mid-flow, refresh mid-confirmation, switch to the wrong chain, open it on a 360px mobile viewport.
2. **OBSERVE.** Capture what the UI claims (the toast, the badge, the success screen, the number) **and** capture ground truth in parallel: the transaction receipt / `value.err`, the on-chain read, the API response vs the database, the actual health of the dependency.
3. **AUDIT.** Compare. The UI's claim must match ground truth in every state, not just the happy path. If the tx reverted and the screen says "confirmed," that's an optimistic-success defect. If the badge says LIVE while the RPC is stale, that's a hardcoded badge. Advance only on proof, never on appearance.

## The source-of-truth hierarchy

When the UI and a lower layer disagree, the lower layer wins. Trust, in order:

`on-chain read  >  transaction receipt  >  recomputable cryptography (re-derive the Merkle root / re-hash)  >  indexer/subgraph  >  app API  >  rendered UI`

A number on screen is true only if it traces up this chain to a receipt, a contract read, or something you recompute. Anything that doesn't is either bound to a real source or labeled illustrative — never shown as fact.

## The states that hide deceptions

Most fake-success and dead-CTA defects live in the states a happy-path demo never visits. Drive each one:

- loading / pending / success / **error** / empty / disconnected
- signature **rejected** / insufficient balance / **wrong network** / **refresh mid-flow** / back-button
- **mobile viewport** (a dead mobile CTA reaches 100% of mobile users) and desktop

## What does not count as proof

- "The toast said success." (Did the receipt confirm? Did `value.err` come back null?)
- "The badge is green." (Is it derived from a live check, or a literal?)
- "The number looks right." (Does it trace to a source, or is it typed in?)
- "It worked on desktop." (Did you drive it on mobile, disconnected, and after a rejected signature?)
- "The verified badge is showing." (Was the proof actually recomputed before it rendered?)

A flow is clear only when its claim has been reconciled against ground truth in every state. Then it ships.
