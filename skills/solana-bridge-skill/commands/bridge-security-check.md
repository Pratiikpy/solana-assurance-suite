---
description: Run the bridge-security.md pre-integration checklist against the user's integration; report pass/fail per item with the hack each item prevents, and the failure-case tests to write. Read-only audit.
argument-hint: "[path to the bridge integration module/dir, defaults to detected]"
---

# /bridge-security-check

Audit the bridge integration at `$ARGUMENTS` (or the detected transfer/redeem code) against the pre-integration checklist in [bridge-security.md](../skill/bridge-security.md). Use the `bridge-security-reviewer` conventions. This is **read-only** — find the missing check; do not move funds or edit code.

## 1. Locate the consume/redeem path
Grep for the load-bearing call sites: `receiveMessage`, `redeem`, `parseAndVerifyVM`, `verify_signatures`/`post_vaa`, `PostedVaa`, claim/used-nonce PDAs, `setPeer`/peer registration, source-domain checks, decimal scaling. The *integration's* call sites are what you audit — using Circle's CCTP programs or the Wormhole NTT framework is a signal, not a pass.

## 2. Run the checklist — pass/fail + the hack each prevents
For every item: **PASS / FAIL / NOT-VERIFIABLE-FROM-CODE**, evidence (`file:line`), and the hack it prevents.

| # | Check | Prevents | Maps to hack |
|---|---|---|---|
| 1 | Attestation/VAA verified vs **expected** signer set, read from **identity-checked** accounts (no unchecked sysvar/account) | Minting unbacked supply against attacker-controlled bytes | **Wormhole 2022** (~$325M; unchecked `load_instruction_at`) |
| 2 | **Replay protection** — consumed-message PDA / used-nonce; same attestation can't act twice; not relying solely on the bridge's claim PDA | Crowdsourced replay drain | **Nomad 2022** (~$190M) |
| 3 | **Finality** respected before mint (Fast V2 ⇒ Circle fronts soft-finality risk, accepted in writing) | Reorg-away-the-burn, keep-the-mint | hand-rolled-verifier class |
| 4 | **Rate limits + pause** (NTT) set; **pause/owner authority itself** access-controlled, multisig owner | Machine-speed drain through a slipped bug | blast-radius cap |
| 5 | **Source emitter / peer allowlist** enforced; `setPeer`/registration owner-gated | Attacker contract impersonating the source | **Wormhole** (substitution) |
| 6 | **Decimal normalization** explicit both ends — NTT 9-dp wire (trims), CCTP USDC 6-dp, EVM often 18; round-trips, no overflow | Minting orders of magnitude too much / silent truncation | precision class |
| 7 | In-payload **sender + recipient** validated before payout (DLN `dstChainTokenOutRecipient` included) | Executing an attacker's intent | substitution/authority |
| 8 | **Key independence** of any n-of-m signer set in the path; upgrade authority of every bridge program known/multisig'd/monitored | Correlated-key compromise; malicious upgrade | **Ronin 2022** (~$625M); **Nomad** upgrade |

## 3. Recommend the failure-case tests
For each FAIL or NOT-VERIFIABLE, name the exact negative test the dev must write (cross-link [testing-bridges.md](../skill/testing-bridges.md) and the bug-class catalogue [../solana-testing/bug-class-playbook.md](../solana-testing/bug-class-playbook.md)). The test must pass/drain against the broken behavior and reject against the fix, with coverage confirming the guard branch was reached. Must-haves:
- replayed VAA/nonce rejected (and supply unchanged);
- forged / wrong-signer attestation rejected;
- foreign source-domain / unregistered-emitter rejected;
- decimal round-trip conserves value across the 9-dp/6-dp/18-dp boundary;
- over-limit transfer queued/rejected; only owner can pause/raise limits.

These belong at Tier 1 (LiteSVM, self-signed attestation) — write them before the happy path.

## 4. Report — verdict, not vibes
Output the per-item pass/fail table with evidence and the hack each prevents, then a clear **ship / do-not-ship** verdict and the specific unmet items. If the malicious-VAA/attestation path is untested, the verdict is **do-not-ship** until it exists — say so plainly. Never claim PASS for a check that lives off-chain or on a dependency's config; mark it NOT-VERIFIABLE and put it on the design-review list.
