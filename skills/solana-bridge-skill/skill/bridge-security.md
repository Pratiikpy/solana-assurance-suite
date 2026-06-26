# Bridge Security — The Pre-Deploy Checklist a Solana Integrator Must Pass

Bridges are the single most-exploited primitive in crypto: billions lost, and the largest individual exploits in the space are bridge hacks. The reason is structural — a bridge mint is an instruction that creates value on the destination chain *purely because an attestation says value was locked/burned on the source chain.* If the verification of that attestation is wrong by one check, the attacker mints unbacked supply from nothing. This file is the **pre-deploy security checklist**: a numbered, copy-pasteable gate where every item gives you (a) the check, (b) the real hack it maps to, and (c) the exact `examples/bridge-guards` function or test that proves it. The standing instruction: **write each failure case below as a test that passes against the broken behavior and fails against the fix** — see [../solana-testing/bug-class-playbook.md](../solana-testing/bug-class-playbook.md). A bridge bug that was never encoded as a failing test is a bug you have not defended against.

## The hacks, cited, and what each one is

**Wormhole — Feb 2, 2022 — ~$325M (120,000 wETH minted unbacked).** On Solana, the `verify_signatures` instruction used the **deprecated, unchecked** `load_instruction_at` instead of `load_instruction_at_checked`, and so **never verified that the instructions-sysvar account passed in was the real sysvar.** The attacker supplied a *fake* account in place of the instructions sysvar carrying fabricated data, which made signature verification "pass" against attacker-controlled bytes, producing a VAA that authorized minting 120k wETH on Solana with no real Guardian signatures backing it. Jump Trading backstopped the loss. **Root class: account substitution + a verification that trusted bytes instead of the account's identity/owner.**

**Nomad — Aug 2022 — ~$190M.** A contract upgrade initialized a **zero hash as a trusted Merkle root.** Because any message proves against a trusted root, *every* message was effectively pre-proved; once one attacker found it, the calldata was copy-pasted by hundreds — a "crowdsourced" replay drain. **Root class: broken/auto-passing verification + no per-message replay protection.**

**Ronin — Mar 2022 — ~$625M.** Not a code bug — **validator key compromise.** The bridge required **5 of 9** validator signatures; the attacker obtained **5 keys** (four Sky Mavis nodes plus the Axie DAO validator Sky Mavis had been authorized to sign for) and simply signed valid-looking withdrawals. **Root class: trust-model/key-management failure — the threshold was real but the keys weren't independent.**

## How to use this checklist

Each item is a gate: copy it into your PR/review, and don't ship until every box is checked with a passing test or a documented design sign-off. The column that matters is **"proven by"** — the `examples/bridge-guards` function and the named test (in `examples/bridge-guards/test/guards.test.mjs`, **6/6 passing**, run with `node --test`) that demonstrates the guard rejecting the attack. Where no unit test can prove it (key independence, upgrade authority), the item is a documented design-review sign-off, marked as such. Each item also maps to a numbered bug class in [../solana-testing/bug-class-playbook.md](../solana-testing/bug-class-playbook.md); write the negative test there.

---

### 1. Attestation / VAA signature verification — never roll your own

- [ ] **Check:** The VAA/attestation is verified against the **expected** signer set (Wormhole Guardian set / Circle Iris key), the signatures are read from a **checked, identity-verified** account (never an unchecked sysvar/account whose address you didn't constrain), and quorum is actually met. On Solana that means `load_instruction_at_checked`, explicit account-owner/address constraints, and using a **security-reviewed reference verifier** (Circle's CCTP programs, Wormhole NTT framework) — **do not hand-roll VAA verification.** If you must, get an audit and treat this whole checklist as your minimum, not your ceiling.
- **Hack it maps to:** **Wormhole 2022 (~$325M)** — `verify_signatures` trusted attacker bytes from a substituted "sysvar" account; the signature check "passed" against fabricated data and minted 120k unbacked wETH.
- **Proven by:** `makeEmitterAllowlist` is the testable surrogate for "only act on a message whose source you constrained" — `guards.test.mjs › "emitter allowlist accepts known, rejects unknown and chain-mismatched"` asserts a look-alike/unregistered source is rejected. The signature-verification step itself is delegated to the audited reference verifier; the guard proves the source-binding half. → bug class **#2 (account substitution)** + **#7 (program-id/account confusion)**.

### 2. Replay protection — every attestation consumable exactly once

- [ ] **Check:** Every attestation/VAA is consumable **at most once.** Track the consumed message hash/nonce in a PDA and reject re-submission; on the second submit the transaction must fail and total minted supply must be unchanged.
- **Hack it maps to:** **Nomad 2022 (~$190M)** — one trusted message proved infinitely; hundreds copy-pasted the same calldata to drain the bridge. No per-message replay protection.
- **Proven by:** `makeReplayGuard` — `guards.test.mjs › "replay guard consumes a message once and rejects the replay"` asserts `consume(h)` returns `true` once then `false` on the replay, and `size()` stays `1`. → bug class **#6 (re-initialization / idempotency)** + **#5 (conservation)**.

### 3. Source emitter / peer allowlisting — only consume from the known source

- [ ] **Check:** The destination accepts messages **only** from the known emitter on the known source chain — the registered NTT peer / `TokenMessengerMinter` / emitter address. A message from an unregistered emitter (or `setPeer`/registration left open or misconfigured) must be rejected before any mint. The `setPeer`/registration path is owner-gated and reviewed.
- **Hack it maps to:** The forged-message class generally, and the **Wormhole 2022** lesson specifically: an attacker-controlled source must never be treated as canonical.
- **Proven by:** `makeEmitterAllowlist` — `guards.test.mjs › "emitter allowlist accepts known, rejects unknown and chain-mismatched"` asserts a valid-format message from the wrong emitter, or the right emitter on the wrong chain, is rejected (`{chain, address}` keyed, case-insensitive). → bug class **#3 (authority/access-control)** + **#2 (substitution)**.

### 4. Finality before mint — don't release off a reorg-able source event

- [ ] **Check:** Do not mint/release on the destination off a source event that can still be rolled back. For CCTP, respect `minFinalityThreshold` — **Standard/Finalized (2000)** waits hard finality; **Fast (≤1000)** mints on confirmed/soft finality only because **Circle fronts the reorg risk**, not you (per [cctp.md](cctp.md)). If you build your own verification, minting before source finality lets an attacker reorg away the burn and keep the mint.
- **Hack it maps to:** Reorg double-spend — the structural risk behind every premature-mint design; the reason CCTP exposes a finality threshold at all.
- **Proven by:** `finalityMet` + `CCTP_FINALITY` (`FAST: 1000`, `FINALIZED: 2000`) — `guards.test.mjs › "finality gate blocks release below the required threshold"` asserts `finalityMet(FAST, FINALIZED) === false` (fast is below finalized) and `finalityMet(FINALIZED, FINALIZED) === true`. → bug class **#5 (conservation)**: model a source rollback after a premature mint; assert supply is not inflated.

### 5. CCTP domain routing — domain ≠ chainId, reject identical/unknown

- [ ] **Check:** CCTP addresses chains by a **numeric domain**, *not* the EVM chainId or Wormhole chainId — **Solana = 5** (per [cctp.md](cctp.md)). Resolve the route from a known domain table, reject an identical source/destination, and reject an unknown chain name. A wrong/identical domain burns funds you can't mint back. Never hardcode an unverified domain — read Circle's table at integration time.
- **Hack it maps to:** Unrecoverable burns from misrouting — funds sent to the wrong destination domain are gone, not exploitable but irreversible.
- **Proven by:** `resolveCctpRoute` + `CCTP_DOMAINS` — `guards.test.mjs › "CCTP route resolves Solana(5) and rejects identical/unknown domains"` asserts `CCTP_DOMAINS.solana === 5`, that `resolveCctpRoute("solana","base")` returns `{sourceDomain:5,destinationDomain:6}`, and that identical (`solana→solana`) and unknown (`dogechain`) domains both throw. → bug class **#7 (program-id/account confusion)**.

### 6. Decimal normalization — verify normalize/denormalize at both ends

- [ ] **Check:** Solana mints are commonly 6–9 decimals; EVM ERC-20s are often 18. NTT normalizes amounts to an **8-decimal wire format** and "trims" the un-representable remainder as dust; CCTP USDC is 6 everywhere. Verify the exact normalize on send and denormalize on receive: a round-trip must conserve value and never overflow. A wrong scaling factor either mints orders of magnitude too much or silently truncates value.
- **Hack it maps to:** Silent **1000× mis-credit** — naively copying a raw 9-decimal amount into a 6-decimal credit mints `1000.000009` where `1.000000` was due.
- **Proven by:** `trimToWire` / `untrimFromWire` (`NTT_WIRE_DECIMALS = 8`) — `guards.test.mjs › "decimal normalization conserves value and isolates dust (9dp → 8dp wire → 6dp)"` sends `1.000000009` of a 9-dp token to the 8-dp wire (`wire = 100_000_000`, `dust = 9`), credits exactly `1.000000` on a 6-dp chain, asserts `untrimFromWire(wire,9) + dust === amount` (conservation), and asserts the naive raw copy would *not* equal the correct credit (the 1000× bug). The companion test `"… scales up when destination has more decimals (6dp → 9dp)"` covers the no-dust scale-up. → bug class **#4 (arithmetic overflow/precision)**.

### 7. In-payload sender & recipient validation

- [ ] **Check:** Beyond *which contract* sent it (allowlisting, item 3), verify the **payload's claimed sender/recipient** is what your logic assumes before acting — especially for generic messaging and for DLN `dstChainTokenOutRecipient`/`dstChainOrderAuthorityAddress` (see [debridge.md](debridge.md)). Acting on an unvalidated sender is how a generic-messaging integration executes an attacker's intent; a wrong-format recipient is how funds misdeliver.
- **Hack it maps to:** Generic-messaging intent-execution attacks — the class where the transport is sound but the payload's claimed actors are taken on faith.
- **Proven by:** `makeEmitterAllowlist` proves the *transport-source* binding; the *in-payload* sender/recipient check is integration-specific and belongs in your handler test (forge the in-payload sender; assert reject or correct scoping) per [../solana-testing/bug-class-playbook.md](../solana-testing/bug-class-playbook.md). → bug class **#2/#3**.

### 8. Rate limits & pause controls (NTT) — cap the blast radius

- [ ] **Check:** A correct verifier can still be drained at machine speed if a bug slips through; rate-limits and a pause switch are the blast-radius cap. NTT gives you a configurable outbound limit and per-chain inbound limits (epoch window, refilled per-second, with backflow — see [wormhole-ntt.md](wormhole-ntt.md)), plus owner/pause authority. **Set them**, hold `pauser` on a hot key separate from `owner`, and assert only the owner can pause/raise limits and that an over-limit transfer is **queued/rejected, not silently minted.**
- **Hack it maps to:** The general post-exploit lesson — every drained bridge that lacked a circuit breaker lost the *full* balance instead of one epoch's worth.
- **Proven by:** Access-control and limit behavior is integration-specific (NTT manager config), proven in your deployment test: assert non-owner pause/limit-raise reverts and an over-limit transfer queues. Wire it alongside the pure guards. → bug class **#3 (authority/access-control)**.

### 9. Upgrade-authority hygiene — a flipped root is a backdoor

- [ ] **Check (design sign-off):** The **upgrade authority** of every bridge program in your path is known, multisig'd, and monitored. An upgrade is a code-swap that can silently disable any check above.
- **Hack it maps to:** **Nomad 2022** — a routine upgrade flipped the trusted Merkle root to zero, auto-passing every message.
- **Proven by:** *No unit test* — this is a documented design-review sign-off (record the authority, its multisig threshold, and the monitoring). Treat an unverified/single-key upgrade authority on any program in your path as a failing gate.

### 10. Key independence in any n-of-m signer set (the Ronin lesson)

- [ ] **Check (design sign-off):** If your design or a dependency relies on an n-of-m signer set, the *m* keys are genuinely independent — not co-located, not all controlled by one operator, no party signing on another's behalf. A threshold is only as strong as the least-correlated key.
- **Hack it maps to:** **Ronin 2022 (~$625M)** — a real 5-of-9 threshold defeated because one operator effectively controlled 5 keys.
- **Proven by:** *No unit test* — documented design-review sign-off. Enumerate each signer, its operator, and its custody; flag any correlation as a failing gate.

---

## Ship gate (summary)

Do not move value on mainnet until **all** of the following hold — the first six are proven by `examples/bridge-guards` (6/6 passing, `node --test`); the rest are integration tests or documented sign-offs:

- [ ] **1. Signatures** verified against the expected signer set from identity-checked accounts — using an audited reference verifier, **never a hand-rolled one** *(Wormhole 2022)*.
- [ ] **2. Replay** blocked — consumed-message PDA; same attestation can never mint twice — `makeReplayGuard` *(Nomad)*.
- [ ] **3. Emitter/peer allowlist** enforced; `setPeer`/registration owner-gated — `makeEmitterAllowlist` *(forged source)*.
- [ ] **4. Finality** met before mint; if CCTP Fast, you've accepted Circle fronts soft-finality reorg risk — `finalityMet`/`CCTP_FINALITY` *(reorg double-spend)*.
- [ ] **5. CCTP domain** resolved from a verified table (Solana = 5), identical/unknown rejected, nothing hardcoded — `resolveCctpRoute`/`CCTP_DOMAINS` *(unrecoverable burn)*.
- [ ] **6. Decimal normalization** verified both ends (NTT 8-dp wire/trim; CCTP 6-dp); round-trip conserves value, no overflow — `trimToWire`/`untrimFromWire` *(1000× mis-credit)*.
- [ ] **7. In-payload sender & recipient** validated before any state change or payout.
- [ ] **8. Rate limits + pause** configured (NTT) and the pause/owner authority itself access-controlled and tested.
- [ ] **9. Upgrade authority** of every program in the path known, multisig'd, monitored *(Nomad)*.
- [ ] **10. Key independence** confirmed for any n-of-m signer set in the trust path *(Ronin)*.
- [ ] **Every item above written as a failing test** per [../solana-testing/bug-class-playbook.md](../solana-testing/bug-class-playbook.md): it passes (drains/over-mints) against the vulnerable behavior, rejects against the fix, and coverage confirms the guard branch was actually reached.

> The single highest-leverage rule sits above the list: **pick the right bridge for the job** ([bridge-landscape.md](bridge-landscape.md)) — issuer-native (CCTP/NTT) over generic wrapped, the smallest blast radius that does the job — and **never roll your own VAA/attestation verification.** The cheapest bridge bug to fix is the one you didn't build.

Note: the relative paths above assume sibling skill directories `solana-bridge-skill/` and `solana-testing-skill/` under the same parent; adjust the `../../solana-testing-skill/...` prefix if the layout differs.

_Last verified: June 2026_
