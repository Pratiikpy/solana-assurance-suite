---
description: Wire a SAS attestation requirement into a claim, payment, or access path — off-chain for UX, on-chain for the boundary — composing with sybil-defense where eligibility = graph-clean AND attested.
argument-hint: <flow: claim|payment|access> [--credential <pda>] [--schema <pda>]
---

Add an attestation gate to a real decision path. Mirror the hardened verifier off-chain (UX, routing) and enforce it on-chain on anything value-bearing (the actual security boundary). Compose with `../solana-sybil-defense` so eligibility becomes **graph-clean AND attested-human**. Follow [skill/integration.md](../skill/integration.md) and [skill/hardened-verifier.md](../skill/hardened-verifier.md).

Argument: `$ARGUMENTS` — the flow type (`claim` / `payment` / `access`) plus the credential and schema the gate requires. SAS program ID `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG` — confirm per cluster.

## Steps

1. **Decide where the boundary is.** Value-bearing (claim, mint, settlement) ⇒ the gate **must** be on-chain; the off-chain check is only for UX. Pure access/rate-gating with no on-chain value can be off-chain, but know that a backend-only gate is forgeable the moment the backend is bypassed. Never let an off-chain verdict be the only gate on value.
2. **Wire the on-chain gate** (claim/payment). In the program, take the attestation as an `UncheckedAccount` and run `require_valid_attestation` *before* acting: owner == SAS program (first), then credential, schema, subject == the acting wallet, revocation, expiry — deserializing defensively (no borsh `unwrap` on untrusted bytes). The Anchor sketch is in [skill/integration.md](../skill/integration.md).
3. **Wire the off-chain mirror.** In the UI/backend, `attestationGate(subject, { credential, schema })` runs the same checks via `sas-lib` so a doomed transaction is never built, and a missing attestation **routes the user into issuing** (`/issue-attestation`, [skill/proof-of-human.md](../skill/proof-of-human.md)) rather than dead-ending a real human.
4. **Compose with sybil-defense.** If this is an airdrop/mint, eligibility = `inMerkleTree(wallet)` **AND** `attestationGate(wallet, …)`. The merkle root (from `../solana-sybil-defense`) is the sybil gate; the attestation is the humanity gate; `claim_status` `init` is replay protection. All three in one instruction. See `../solana-sybil-defense`'s integration note for the merkle half.
5. **For payment flows (x402),** carry both requirements in the 402 challenge (pay X to Y **and** present an attestation for the payer), and bind the attestation subject to the **payer** — otherwise one attested wallet pays while another is gated.
6. **Test the gate adversarially.** Port the attack matrix into `../solana-testing`: valid passes; spoofed owner, wrong credential, wrong schema, wrong subject/reuse, revoked, expired, fake issuer all rejected; malformed account bytes don't panic. Run `node --test examples/attestation-verify/` as the local model. A gate is exactly as good as its rejection tests.

## Output

- The on-chain gate (program change) and/or off-chain gate (UI/backend) wired in, with the check sequence behind an owner check.
- For airdrops: both gates composed (`graph-clean AND attested`) plus replay protection.
- The adversarial test cases added to `../solana-testing`, with evidence each attack is rejected.

Commit the decision on-chain, not the trust in a backend. To audit the resulting verifier before shipping, hand off to the `verifier-reviewer` agent.
