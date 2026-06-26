# Human-Level QA — Test Like a Real Solana User, to the Highest Rigor

> The human layer of the gate. The other layers (static, unit, formal, load, secrets) prove the build is *correct*; this proves the **product** is correct from the only seat that matters — a real person driving a real wallet through the real UI. Automation lives in [e2e-realwallet.md](e2e-realwallet.md) (Playwright + Synpress/Phantom); roll-up in [release-gate.md](release-gate.md); program correctness delegates to [../solana-testing](../solana-testing/SKILL.md). The executable agent is **qa-orchestrator** (agents/).

## 0. Prime directive

**Test everything, to the highest rigor the product supports — not the minimum.**

- If a feature *can* be exercised through the UI, exercise it through the UI.
- Proving a flow needs N wallets? Use N — decide from the flow, never default to "one is enough."
- Every action is followed by **looking**: capture a screenshot, *read it*, confirm reality matches intent, then proceed. Acting blind is not testing.
- Default maximal (L3). Be adversarial — try to break it, not just confirm the happy path.
- **Evidence over intent.** "It compiled," "the click registered," "looks right" are NOT proof. Proof is observed behavior: a real signature reaching `confirmed`/`finalized` on the right cluster, a screenshot you audited, a synced second screen, a verified on-chain read (`getAccountInfo`/`getBalance`/`getTokenAccountBalance`).

If you can't reach the bar (locked Phantom, dead RPC, dry faucet), **stop and report the blocker.** Never silently downgrade and call it done.

## 1. REAL-USER MINDSET — be the user, not just the script

A green script still misses what a person notices in two seconds. Hold both hats: systematic QA engineer AND a first-time human who's never seen this dApp. Report what a human would *feel*, not just pass/fail.

- **Arrive cold.** Land on the app entry with no insider map. *Could I figure out how to do this?* Undiscoverable, ambiguous, or insider-knowledge-only flows are real defects.
- **Verify the wallet popup payload before approving (Solana-critical).** A careful human reads the Phantom popup before signing. Never blind-sign. Assert the popup shows the **correct cluster, program/instruction, accounts, and amounts** — and that they match what the app screen promised. For SIWS / Ed25519 message signing, assert the **statement, domain, and nonce** match the page. A mismatch between UI intent and the wallet payload is a severe defect, whatever the product does.
- **Follow one value across every surface.** Take one datum the product creates/changes (a transferred amount, a status, a name, a count) and confirm it reads identically *everywhere*: originating screen, counterparty screen, any detail/receipt view, any notification/side channel, and the source of truth (on-chain read / API). Same datum must agree on every surface. Inconsistency = defect.
- **Watch for feedback, not just outcome.** After each click, did the UI *immediately* acknowledge (spinner, disabled button, toast)? "I clicked and nothing happened, I thought it froze" is a real complaint. Flag dead time even if the action eventually succeeds.
- **Read the actual words.** Typos, broken/confusing labels, leftover `lorem ipsum`/"TODO", raw error dumps or stack traces shown to users instead of humanized copy.
- **Use it like a browser user.** Back button mid-flow, refresh on every screen, open a deep link in a new tab / while disconnected, bookmark and return, browser zoom, let password-manager/autofill touch inputs. These break dApps constantly.
- **Use it like a phone user.** Mobile viewport: does the on-screen keyboard cover the input or submit button? Tap targets big enough? Back gesture works? Tab backgrounded mid-transaction then resumed — does the signature flow survive? Does the Phantom deep-link / mobile-adapter hand-off work?
- **Come back later (returning user).** Reload/re-enter after a flow: session remembered, past activity present, picks up where it left off — or does it wrongly show empty/disconnected?
- **Check the side channels.** If a flow sends an email / push / notification (claim links, invoices, requests), confirm it arrives and its link/action works end to end.
- **Hold the product to its own promises.** Read the README / landing / docs, then verify the app does what it claims. Advertised-but-broken is high-severity.
- **Wander (exploratory pass).** After scripted flows, spend real effort doing the unexpected: odd click orders, abandon halfway, surprising input, revisit completed actions. Find what only emerges off-script.
- **Give a human verdict.** Beyond pass/fail: too many steps, confusing moments, where you hesitated, anything slow or untrustworthy. That qualitative read is part of testing like a human.

## 2. NO-COMPROMISE RULES — non-negotiable, every run

Violating any one means the testing is incomplete — say so rather than pretending otherwise.

1. **The UI is the product.** People use the interface, not the program. Broken, wrong, confusing, or ugly *from the UI* = NOT done, no matter how correct the on-chain program is. UI correctness from every angle (§7) is the bar.
2. **Test every feature.** Nothing in the inventory is skipped as "too small." Every page, button, state.
3. **Never act blind.** Every action → capture AND *read* the screenshot. An unread screenshot is not verification.
4. **Real path only.** No mocks, no fake injected provider, no stubbed results on the human-like suite. Real browser, real **Phantom** (or Backpack/Solflare via the wallet adapter), real cluster (devnet/testnet, or a surfpool/local-validator fork).
5. **Happy path is half the job.** Every flow also gets its negative, edge, and failure cases. A feature only "works" if it also fails gracefully.
6. **Multi-party means multi-context.** Never fake a multi-user flow with one account switching. One real isolated user per party.
7. **Every viewport, every cluster the app targets.** Desktop passing never implies mobile; devnet passing never implies the app behaves on mainnet-beta config. Prove each.
8. **Verify the source of truth.** The UI can lie — confirm real state via RPC, not just what the screen says.
9. **Evidence or it didn't happen.** Every pass carries proof: audited screenshots, recordings, the finalized signature, the on-chain read.
10. **No silent downgrade.** Blocked from required depth → STOP and report. Never quietly weaken a check, add a blind `sleep`, or call a weaker result "done."

## 3. The core loop — ACT → CAPTURE → AUDIT → DECIDE

The heartbeat of every test. Never chain actions blind.

```
for each step in a flow:
  1. ACT      — one meaningful interaction (fill, click, approve in Phantom)
  2. CAPTURE  — screenshot immediately (fullPage), auto-named per step
  3. AUDIT    — actually READ the screenshot (vision) + assert the DOM:
                • did the expected state appear? (success text, new value)
                • clipped / overlapping / off-canvas / mis-rendered?
                • amounts/addresses correct, not truncated? lamports↔SOL right?
                • error toast, infinite spinner, blank region?
  4. DECIDE   — audit passes → next step; fails → capture context, log defect, stop that flow
```

The audit step is non-negotiable — a saved-but-unread screenshot is not verification. Minimum transition shots per flow: `pre-action → input-filled → wallet-popup (payload visible) → submitting → pending → post-confirm → final-result`. Record **video** of the whole flow (set at context creation) so a mid-flow failure is reviewable frame by frame. **Never `sleep` for chain results** — poll the signature status (`processed→confirmed→finalized`) or wait on the visible success value.

## 4. Wallet & persona strategy — decide N yourself

**Provision as many wallets as the hardest flow requires.** Each persona is its own keypair + its own `BrowserContext` (isolated localStorage/IndexedDB/cookies, so identities never bleed). One context per persona — never share.

| Flow type | Wallets | Solana examples |
|---|---|---|
| Solo / read-only | 1 | dashboard, balance, settings, profile, tx history, draft |
| Two-party value transfer | 2 | SOL/SPL send, request→pay, claim-link create→claim, P2P swap |
| Three-party | 3 | escrow with arbiter, group split with a third member |
| N-party | 4–N | group settle, multi-contributor crowdfund, marketplace with multiple buyers |
| Mixed wallet types | as needed | one Phantom EOA + Backpack/Solflare users in the same flow |

Rules:
- **Deterministic pinned keypairs** per persona so addresses, signatures, and share URLs are identical across runs (replayable). **Devnet/testnet only — never fund a mainnet key in a test.**
- If a flow *could* be done by one user switching accounts, **don't** — use distinct concurrent contexts so the multi-user path is actually proven.
- **Faucet/seed** fresh wallets before a flow (devnet airdrop / pre-funded persona transfer). Faucet rate-limited or dry → try the next funding path; if none works, report it as a blocker — don't fake balances.
- Provision the full persona set at run start (Alice, Bob, Carol, Dave, …). Keep ordering sequential (`workers:1`) so blockhashes/balances/shared PDAs stay deterministic across open contexts.
- Pass real artifacts between contexts like a conversation: read the actual share URL / signature from Alice's UI, drive it into Bob's context, verify both screens + the chain (§6 sync). Mechanics: [e2e-realwallet.md](e2e-realwallet.md).

## 5. Coverage dimensions — what "everything" means

For **every feature** in the inventory:

**Functional** — happy path end-to-end through the UI to a real outcome; every input variant (valid, boundary, invalid, empty, max-length, unicode, huge numbers, zero, negative, decimal/precision — esp. lamports↔SOL and SPL `decimals`); every UI branch (each tab, mode, toggle, option).

**State** — empty, loading/skeleton, success, error, partial, "nothing yet"; reload mid-flow (persist or recover sanely); back/forward integrity; deep-link straight into a sub-route.

**Multi-user / sync** (§6) and **cluster-switch** (in-app and in Phantom — devnet↔mainnet-beta).

**Public surfaces** — open every generated URL (claim, invoice, shop, verify, profile) in a fresh context (disconnected, and as a different persona).

**Cross-cutting UI** — copy-to-clipboard actually copies (the right base58 address!), QR codes render and scan, share links resolve, modals open/close/trap focus, toasts appear/dismiss.

## 6. Data sync, freshness & realtime — what most suites miss

After a state-changing action, prove the data **propagates and is fresh** everywhere it should be:

- **Same user, post-tx**: balance/history/status updates without a manual hard reload (or after the app's expected refresh). Stale UI = defect. Account for RPC commitment lag — the UI shouldn't show stale `confirmed` data the user already saw `finalized`.
- **Second user, live**: with Bob's context open, when Alice pays him, Bob's screen updates (websocket `accountSubscribe`/`logsSubscribe` / SSE / poll). Capture both screens before/after.
- **Cross-tab / cross-session**: same user in two tabs stays consistent.
- **Optimistic vs confirmed**: optimistic UI later reconciles to real on-chain state, and **rolls back on a dropped/expired-blockhash failure**.
- **Concurrency**: two users act near-simultaneously — no lost update, no duplicate, no corrupted shared PDA (group balance, campaign total, escrow account).
- **Freshness on revisit**: navigate away and back — refetch, or stale cache?
- **Ordering**: activity feed shows entries in correct order, correct counterparties, correct amounts.

Verify sync **visually on both screens** AND against RPC — not just one source.

## 7. UI from every angle — the most important surface

For **every screen**, read these off the **actual screenshot**, not assumptions:

**Visual correctness** — nothing overlapping/clipped/cut off/off-canvas/z-fighting; no truncation mid-word, no overflow, readable contrast, no `lorem ipsum`/"TODO"/placeholder; images/icons/avatars/QR load (no broken-image, no infinite shimmer); alignment/spacing/theme consistent, dark/light both correct if present; numbers formatted (lamports vs SOL, SPL decimals), dates sane, long base58 addresses ellipsised not broken, empty lists show a real empty state.

**Interaction** — every button/link/tab/toggle/dropdown/modal/accordion works; hover/focus/active/disabled states visible and correct; forms validate with inline errors, disabled-until-valid, submit feedback; loading/skeleton→content transition happens (no stuck spinner, no flash of empty); toasts and modals appear, dismiss, trap focus.

**Responsive** — desktop (1280×800) and mobile (375×812) minimum; mobile nav reachable; on-screen keyboard doesn't cover inputs/submit; tap targets big enough; no horizontal scroll.

**Navigation & continuity** — every route reachable through the UI (not just by typing the URL); back/forward/refresh/deep-link keep correct state; active-nav highlight correct; no dead links, no internal 404s.

**Feedback & honesty** — every action gives immediate acknowledgement; errors humanized, never raw stack traces or `[object Object]` or a raw `SendTransactionError`/program-error code; the screen never lies (matches §9 source of truth).

## 8. Adversarial, negative & edge cases

For every state-changing flow, map these onto whatever the product does:

- **Invalid / boundary input** — empty, zero, negative, over-balance send, below-rent-exempt minimum, over-limit, max-length, wrong format, unicode; insufficient SOL for fee + rent.
- **Wallet failure paths** (not just approvals) — **user rejects** the signature/connection (clean cancel, no stuck spinner, retry works); **wrong cluster** in Phantom (app prompts switch and recovers); **insufficient SOL for fees/rent** (humanized error, no broken state); **Phantom locked / disconnected mid-flow** (graceful re-auth); **stale/expired blockhash** or transaction dropped (clear retry, no phantom success).
- **Authorization** — a party who shouldn't be allowed acts (wrong claimant, non-arbiter, non-member, disconnected access to private data); a signer who isn't an account's authority.
- **Lifecycle / reuse** — act on something expired, already-consumed, cancelled, closed (already-claimed link, re-submit a closed item, double-init a PDA).
- **Idempotency** — double-submit / rapid double-click → no duplicate tx, no duplicate record.
- **Interruption** — reload mid-action; navigate away while pending; offline then back.
- **Tampering** — edited URL params / account addresses; forged or replayed inputs.
- **Time-based** — act exactly at an expiry/start boundary; before/after a scheduled time.

Each must surface a **humanized error** and leave the app in a sane state — no white screen, no infinite spinner, no UI-vs-chain inconsistency.

## 9. Web3 verification depth — the chain doesn't lie

For state-changing features, verify the real source of truth (apply whichever the product uses):

- **Read the program account directly** for post-state — `getAccountInfo` and **decode the account** (Anchor/Borsh layout): balance, status, owner, counter, mapping/PDA entry — not just the UI's claim. Token balances via `getTokenAccountBalance`; native via `getBalance`.
- **Confirm the signature** reached the required commitment: `getSignatureStatuses` → `confirmed`/`finalized`, **`err == null`**, and the expected program logs / CPI events emitted (`getTransaction` with parsed logs).
- **Compute units / fees / rent** — if relevant, confirm the tx fit its CU budget and the account is rent-exempt; confirm who paid (fee payer) and that a sponsored/relayed tx actually landed — not just that the UI said "sent."
- **Value precision** — on-chain value equals displayed value: no lamports↔SOL mismatch, no SPL-decimals drift, no rounding error.
- **Authorities/delegations** — token approvals, PDA authorities, mint/freeze authority actually set/consumed as claimed; nothing dangling the app said it revoked.
- **Finality** — wait for the commitment level the app relies on before asserting (don't assert `finalized` behavior off a `processed` read).

## 10. Anti-patterns — these do NOT count as proof

- "It compiled" / typecheck passed.
- "The selector matched" / the click registered.
- "Looks like it works" from a connect-only or screenshot-only run.
- A saved screenshot you never actually read.
- "Tests pass in CI" with no signature + audited screenshot + URL artifact.
- A LiteSVM/local-validator task standing in for the real wallet path on the human-like suite.
- A mocked wallet / injected fake provider instead of real Phantom.
- One user switching accounts to fake a multi-party flow.
- Asserting `finalized` outcomes off a `processed`/`confirmed` read, or calling a dropped tx "sent."
- Proving on devnet and assuming mainnet-beta config behaves identically.

## 11. Definition of Done (human layer)

A feature is **covered** only with ALL of:
1. A finalized signature on the correct cluster's explorer (**Solscan / Solana Explorer**) for state-changing features.
2. Audited screenshots at each transition (incl. the wallet popup payload).
3. A reachable URL artifact for any public surface.
4. Evidence on **both viewports** (+ each cluster the app targets).
5. Multi-user sync proven where the feature is multi-party.
6. A recorded proof line tying signature + screenshot + URL + cluster together (idempotent on `(feature, cluster, signature)`), feeding the manifest in [release-gate.md](release-gate.md).

A **coverage audit** cross-checks the inventory against recorded proofs and **fails the run on any missing (feature, cluster, viewport).**

## 12. LAUNCH-READY gate — the one bar that matters

Call the product **launch-ready** only when ALL are true; if any item is unmet, it is NOT launch-ready — say exactly which item failed.

- [ ] **Every** feature in the discovered inventory tested through the UI — none skipped.
- [ ] Each feature passes its **happy path** end-to-end to a real, verified outcome.
- [ ] Each feature passes its **negative / edge / failure** cases with humanized errors and a sane recovered state.
- [ ] **UI from every angle (§7)** passes on every screen: visual, interaction, responsive, navigation, feedback.
- [ ] Proven on **both viewports** and each cluster the app targets.
- [ ] **Multi-user flows** proven with real isolated parties, and **data stays synced/fresh** across them (§6).
- [ ] **Wallet flows** work via real Phantom: connect, sign/approve, AND reject / wrong-cluster / locked handled cleanly; the popup showed the correct instruction/accounts/amounts (and SIWS statement+nonce) before signing.
- [ ] **Source of truth verified (§9)** — decoded on-chain state matches the UI, signatures `finalized` with `err == null`.
- [ ] **No console errors, no failed network/RPC calls** on passing flows; no broken links; no dead buttons.
- [ ] **Security/privacy invariants** hold — no keypair/seed/secret in DOM, console, localStorage, or network payloads; the app talks only to expected RPC/API origins.
- [ ] **Returning-user / refresh / deep-link** continuity works.
- [ ] **Proof artifact + coverage audit** complete with **zero gaps** (the [release-gate.md](release-gate.md) manifest passes).
- [ ] All **Critical and High** defects fixed and **re-verified** (re-test fixes; don't take them on faith).

Launch-ready only when this list is fully green and backed by evidence. Anything less → report "NOT launch-ready" with the exact gaps.

## 13. Defect reporting & flake discipline

- **Severity** — Critical (corrupts data / produces a wrong on-chain effect / drains funds / blocks a core flow / breaks a security invariant) → High → Medium → Low (cosmetic). Lead with the worst; classify by *this product's* purpose, not a fixed assumption.
- **Repro** — exact route, persona, cluster, viewport, inputs — replayable. **Expected vs actual** with screenshot/video/trace attached. **Evidence** — signature, console error, failed RPC call, the audited screenshot.
- A wrong/inconsistent result (UI vs other surface vs on-chain) outranks pure cosmetics.
- **Flaky vs real bug** — on failure, re-run that one flow once: consistent = real bug; intermittent = flake. Distinguish **app bug** from **harness bug** (bad selector/timing) from **external flake** (RPC throttle / faucet dry / devnet congestion). External = a blocker to report, not a feature failure, and never something to fake past. **Never** weaken an assertion or add a blind `sleep` to make a test pass — fix the wait condition or report the real defect.

_Last verified: June 2026_
