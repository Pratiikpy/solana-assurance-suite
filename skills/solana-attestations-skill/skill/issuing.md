# Issuing Attestations

> **In this skill**: [sas-overview.md](sas-overview.md) · [credentials-and-schemas.md](credentials-and-schemas.md) · [verification.md](verification.md) · [hardened-verifier.md](hardened-verifier.md) · back to [SKILL.md](SKILL.md)

Issuing turns an **off-chain fact** (a Civic verdict, a KYC pass, an allowlist decision) into an **on-chain attestation PDA** about a subject. The subject is bound by the `nonce` in the PDA derivation. An attestation is created by an **authorized signer** of the credential, carries serialized `data` matching the schema, and an `expiry`. To revoke, you **close** it.

Prerequisite: a credential + schema from [credentials-and-schemas.md](credentials-and-schemas.md). Code uses `sas-lib` (`@solana/kit` 6.x), with the same `sendIxs(payer, [...])` confirm helper.

```ts
import {
  getCreateAttestationInstruction, getCloseAttestationInstruction,
  deriveAttestationPda, deriveEventAuthorityAddress,
  serializeAttestationData, fetchSchema,
  SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
} from "sas-lib";
import { type Address, type TransactionSigner } from "@solana/kit";
```

## 1. Off-chain fact → on-chain attestation

The flow: derive the subject's attestation PDA → fetch the schema (to serialize against its layout) → build the create instruction with the issuer's authorized signer.

```ts
// subjectWallet = the wallet this attestation is ABOUT. It does NOT sign.
async function issueAttestation(
  payer: TransactionSigner,
  hotSigner: TransactionSigner,   // must be in credential.authorizedSigners[]
  credential: Address,
  schema: Address,
  subjectWallet: Address,
  fact: Record<string, unknown>,  // e.g. { fullName: "Ada", ageBracket: 21, country: "gb" }
  expiryDays: number,
) {
  const [attestation] = await deriveAttestationPda({
    credential, schema, nonce: subjectWallet,   // nonce IS the subject binding
  });

  const { data: schemaAccount } = await fetchSchema(rpc, schema);
  if (schemaAccount.isPaused) throw new Error("schema paused — refusing to issue");

  const expiry = Math.floor(Date.now() / 1000) + expiryDays * 86_400;   // unix seconds; 0 = never

  const ix = getCreateAttestationInstruction({
    payer,
    authority: hotSigner,                                   // authorized signer must sign
    credential,
    schema,
    attestation,
    nonce: subjectWallet,
    expiry,
    data: serializeAttestationData(schemaAccount, fact),    // Borsh, positional against layout
  });

  await sendIxs(payer, [ix]);
  return attestation;
}
```

The resulting `Attestation` account: `{ nonce, credential, schema, data, signer, expiry, tokenAccount }`. Note `signer` records *which* authorized key issued it — useful for audit and for revoking everything a leaked key signed.

### Subject binding — the thing people get wrong

The subject is the `nonce`, and it appears **only** in the PDA seeds, not as a signer. Two consequences:

- The subject **does not sign** the issuance — the issuer asserts a fact *about* them. (This is correct: KYC is the issuer's claim, not the user's self-attestation.)
- Verification must **recompute** the PDA from `(credential, schema, expected_subject)` and confirm the account address matches. Trusting an attestation's `nonce` field read from an attacker-supplied account — without re-deriving — lets an attacker present an attestation about wallet A to authorize wallet B. See [hardened-verifier.md](hardened-verifier.md).

Use a **random nonce** instead of the subject wallet only when you deliberately want multiple attestations of the same schema for one subject (e.g. repeated credentials), and store the mapping yourself. For the standard one-credential-per-wallet gate, `nonce = subjectWallet`.

## 2. Expiry policy

`expiry` is unix seconds. `0` means never expires; any positive value is a hard cutoff verifiers must enforce (`now < expiry`). Pick by credential semantics:

- **KYC / accreditation** — re-verify periodically; 6–12 months is typical. Don't set `0`.
- **Proof-of-human** — humanity doesn't lapse, but liveness signals stale; a 12-month expiry forces periodic re-proof and limits the blast radius of a compromised humanity provider.
- **Event / session access** — short, hours to days.

Expiry is enforced at *read* time, not by the chain — an expired attestation account still exists until closed. Your verifier (and any gating program) must check it. See [verification.md](verification.md).

## 3. Batch issuance

No native batch instruction — pack multiple `getCreateAttestationInstruction`s into one transaction (subject to the ~1232-byte tx size limit and compute budget). Derive each PDA, serialize each subject's data, append all, send once.

```ts
async function issueBatch(
  payer: TransactionSigner, hotSigner: TransactionSigner,
  credential: Address, schema: Address,
  subjects: { wallet: Address; fact: Record<string, unknown> }[],
  expiry: number,
) {
  const { data: schemaAccount } = await fetchSchema(rpc, schema);
  const ixs = await Promise.all(subjects.map(async ({ wallet, fact }) => {
    const [attestation] = await deriveAttestationPda({ credential, schema, nonce: wallet });
    return getCreateAttestationInstruction({
      payer, authority: hotSigner, credential, schema, attestation,
      nonce: wallet, expiry, data: serializeAttestationData(schemaAccount, fact),
    });
  }));
  // Chunk to fit tx limits — ~5-10 attestations per tx depending on data size.
  for (let i = 0; i < ixs.length; i += 6) await sendIxs(payer, ixs.slice(i, i + 6));
}
```

For large airdrops, prefer short expiries and idempotent re-runs (a re-issue to an existing PDA fails — catch "account already in use" and skip).

## 4. Revocation / close

Revoking an attestation = **closing** the account. The PDA disappears, rent is refunded to `payer`, and verification fails closed (the account no longer exists). Only an authorized signer of the credential may close.

```ts
async function revoke(
  payer: TransactionSigner, hotSigner: TransactionSigner,
  credential: Address, attestation: Address,
) {
  const eventAuthority = await deriveEventAuthorityAddress();   // SAS emits a close event
  const ix = getCloseAttestationInstruction({
    payer,
    authority: hotSigner,                                       // authorized signer
    credential,
    attestation,
    eventAuthority,
    attestationProgram: SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
  });
  await sendIxs(payer, [ix]);
}
```

Two ways an attestation stops being valid: **expiry** (passive, time-based, account remains) and **close** (active revocation, account removed). A robust verifier handles both — see [verification.md](verification.md). There is no "update" — to change data, close and reissue (or issue a new `version` schema).

## Operational concerns

- **Rent.** Each attestation is a rent-funded account paid by `payer`. Closing refunds it. For large cohorts this is real SOL outstanding — budget it, and reclaim via close when credentials retire.
- **Who can issue.** Only keys in `credential.authorizedSigners[]`. Issuing is a hot-path key — isolate the signing service, rate-limit it, and rotate on suspicion (see signer rotation in [credentials-and-schemas.md](credentials-and-schemas.md)). The root `authority` should not be the issuing key.
- **Idempotency.** PDA is deterministic from `(credential, schema, nonce)`. Re-issuing the same triple fails; design your pipeline to detect existing PDAs (`fetchAttestation` and catch the not-found) before attempting.
- **Expiry is policy, not enforcement.** The chain won't auto-expire; long-lived credentials with `expiry: 0` are a standing liability if the signer is ever compromised. Prefer finite expiries.
- **`tokenAccount`** is populated only for tokenized attestations (Token-2022 / `getCreateTokenizedAttestationInstruction`); for standard attestations it's the default address and you can ignore it.

Next: verify what you issued, defensively → [verification.md](verification.md) and the full attacker checklist in [hardened-verifier.md](hardened-verifier.md).

_Last verified: June 2026_
