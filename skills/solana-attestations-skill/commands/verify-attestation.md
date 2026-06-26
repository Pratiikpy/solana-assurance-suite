---
description: Verify a SAS attestation off-chain (sas-lib) and on-chain, running the full hardened checklist — owner, credential, schema, subject, revocation, expiry, issuer.
argument-hint: <attestation-pda | subject-wallet> [--credential <pda>] [--schema <pda>]
---

Verify a Solana Attestation Service attestation against what a verifier *requires* of it, running the complete hardened checklist. Off-chain with `sas-lib` + `@solana/kit` 6.x; and the on-chain path (defensive deserialize behind an owner check) where a program gates on it. Follow [skill/verification.md](../skill/verification.md) and [skill/hardened-verifier.md](../skill/hardened-verifier.md). The reference implementation is [`tools/sas-verify/verify.mjs`](../tools/sas-verify/verify.mjs).

Argument: `$ARGUMENTS` — an attestation PDA, or a subject wallet (derive its PDA from `--credential` + `--schema`). Pass the credential and schema you *trust*; the whole point is checking the account matches your expectations, not whatever the account claims about itself.

SAS program ID `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG`.

## Steps

1. **Fetch the account.** Derive the PDA if given a subject; `fetchAttestation` it. Missing account = fail (`no-attestation`), not an error to swallow.
2. **Run the checklist, fail closed, in order:**
   - **owner == SAS program** — *first*. A look-alike account the attacker owns passes nothing without this. If it fails, stop; the rest is meaningless.
   - **credential** == the authority you trust.
   - **schema** == exactly the schema you expect (not just "some attestation exists").
   - **subject** == the wallet the decision is about (stops reuse / lending).
   - **revoked** == false.
   - **expiry** — `0` is non-expiring; otherwise compare against an explicit clock, never implicit wall-clock.
   - **issuer** == an authorized signer, if you pin one.
3. **On-chain check (if a program gates on it).** Confirm the gate deserializes defensively (no borsh `unwrap` on untrusted bytes) behind the owner check, and mirrors the same sequence. See [skill/integration.md](../skill/integration.md).
4. **Cross-check with the offline verifier.** Shape the fetched account into the `verifyAttestation(att, expected, nowUnix)` input and run [`tools/sas-verify/verify.mjs`](../tools/sas-verify/verify.mjs) — and `node --test examples/attestation-verify/` — so the verdict is reproduced by code that already proves it rejects every attack.

## Output

- `VALID` / `INVALID`, and if invalid, **every** reason that fired (not just the first) — a multi-failure attestation is more informative than a single rejection.
- The exact `expected` set checked against (credential, schema, subject, issuer) so the verdict is auditable.
- For on-chain gates: confirmation the program runs the same sequence behind an owner check and deserializes defensively.

Never honor an attestation on a partial check, and never substitute an off-chain verdict for an on-chain attestation on a value flow. To wire a passing attestation into a real path, run `/gate-with-attestation`; to have the verifier code itself audited, hand off to the `verifier-reviewer` agent.
