---
description: Register a SAS credential and schema if needed, then issue an attestation PDA to a subject wallet with an optional expiry.
argument-hint: <subject-wallet> [schema-name] [--expiry <days|0>]
---

Issue a Solana Attestation Service attestation. If the credential and schema don't yet exist, register them first; then derive and create the attestation PDA for the subject. Uses `sas-lib` + `@solana/kit` 6.x. Follow [skill/issuing.md](../skill/issuing.md) and [skill/credentials-and-schemas.md](../skill/credentials-and-schemas.md).

Argument: `$ARGUMENTS` — the subject wallet to attest about, an optional schema name, and an optional `--expiry` in days (`0` or omitted = non-expiring).

SAS program ID `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG` — confirm per cluster before issuing on anything but devnet.

## Steps

1. **Resolve / register the credential.** Derive the credential PDA for your authority. If it doesn't exist, `createCredential` under a keypair you control — this authority is the root of trust every verifier will pin. Record the PDA.
2. **Resolve / register the schema.** Derive the schema PDA under that credential. If absent, `createSchema` with explicit fields and a **versioned name** (`proof_of_human_v1`, not `proof_of_human`) — the schema *is* the meaning of the claim; a vague or reused schema is what lets a verifier later check the wrong thing. Record the PDA.
3. **Issue the attestation.** Derive the attestation PDA for `(credential, schema, subject)`. Set expiry deliberately from `--expiry` (a non-expiring humanity proof is a different risk profile than a 30-day one; default to a finite expiry unless the claim is genuinely permanent). `createAttestation` signed by the credential's authorized signer, bound to the **correct subject** — the wallet the downstream flow is actually about.
4. **Verify what you issued.** Immediately fetch it back and run the hardened check sequence ([skill/verification.md](../skill/verification.md)) to confirm it passes every check from the verifier's perspective — owner, credential, schema, subject, revocation, expiry. Issuing without verifying the readback is how silent encoding mistakes ship.

## Output

- The credential and schema PDAs (registered or reused), and the issued attestation PDA.
- The subject, schema name, and expiry actually set.
- Confirmation the readback passes the verifier checklist, plus the transaction signatures.

Issue to the correct subject and pick the right schema — these are the two choices a verifier can't fix for you. To verify an attestation independently afterward, run `/verify-attestation`. To gate a real flow on it, run `/gate-with-attestation`.
