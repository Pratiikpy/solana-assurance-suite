# Credentials & Schemas

> **In this skill**: [sas-overview.md](sas-overview.md) · [issuing.md](issuing.md) · [verification.md](verification.md) · [hardened-verifier.md](hardened-verifier.md) · back to [SKILL.md](SKILL.md)

Before any attestation exists you need two setup accounts: a **credential** (the issuer namespace) and a **schema** (the typed layout under it). Both are one-time per `(authority, name)` / `(credential, name, version)`. Get them right — a schema's `layout` is effectively immutable, and a wrong layout means every attestation you ever issue under it deserializes to garbage.

All code below uses `sas-lib` (the SAS client, `@solana/kit` 6.x compatible). Examples assume a `sendIxs(payer, [...])` helper that builds, signs, and confirms a v0 transaction — the standard kit `pipe` flow (`createTransactionMessage` → set fee payer + blockhash → `appendTransactionMessageInstructions` → `signTransactionMessageWithSigners` → `sendAndConfirmTransactionFactory`).

```ts
import {
  getCreateCredentialInstruction, getCreateSchemaInstruction,
  getChangeAuthorizedSignersInstruction, getChangeSchemaStatusInstruction,
  deriveCredentialPda, deriveSchemaPda, fetchCredential, fetchSchema,
} from "sas-lib";
import { generateKeyPairSigner, type TransactionSigner, type Address } from "@solana/kit";
```

## 1. Register a credential (the issuer authority)

The `authority` is the root controller; `signers` are the keys actually allowed to sign attestations. Keep them distinct — the authority is your cold/governance key, signers are hot issuing keys you can rotate.

```ts
const issuer: TransactionSigner = await generateKeyPairSigner();      // root authority (cold)
const hotSigner: TransactionSigner = await generateKeyPairSigner();   // day-to-day issuer

const [credential] = await deriveCredentialPda({ authority: issuer.address, name: "ACME-KYC" });

const createCredential = getCreateCredentialInstruction({
  payer,
  credential,
  authority: issuer,                 // MUST sign — proves control of the namespace
  name: "ACME-KYC",                  // only first 32 bytes are used in the PDA seed
  signers: [hotSigner.address],      // authorizedSigners[]
});
await sendIxs(payer, [createCredential]);
```

The resulting `Credential` account: `{ authority, name, authorizedSigners[] }`.

### Governance & signer rotation

Rotate the hot signer set without touching the namespace — only the `authority` may do this. The call **replaces** the array, it does not append, so always pass the full intended set.

```ts
const newSigner = await generateKeyPairSigner();
const rotate = getChangeAuthorizedSignersInstruction({
  payer,
  authority: issuer,                                   // root authority must sign
  credential,
  signers: [hotSigner.address, newSigner.address],     // full set, replaces existing
});
await sendIxs(payer, [rotate]);
```

> Treat the `authority` key like a program upgrade authority: multisig it, store it cold. Anyone holding it can add a signer and issue arbitrary attestations under your credential. The hot signers are the keys exposed to your issuing service — if one leaks, rotate it out immediately; existing attestations stay valid (they recorded the old `signer`), but the leaked key can no longer mint new ones.

## 2. Author a typed schema

A schema is a **compact byte layout** (one type code per field) plus parallel `fieldNames`. The type codes (`sas-lib` `compactLayoutMapping`):

| code | type | code | type | code | type |
|---|---|---|---|---|---|
| 0 | u8 | 5 | i8 | 10 | bool |
| 1 | u16 | 6 | i16 | 11 | char (4-byte) |
| 2 | u32 | 7 | i32 | 12 | **String** |
| 3 | u64 | 8 | i64 | 13–24 | `Vec<...>` of the above |
| 4 | u128 | 9 | i128 | 25 | char |

Schema PDA is keyed by `(credential, name, version)`, so a new version is a new account.

```ts
const SCHEMA_LAYOUT = Uint8Array.from([12, 0, 12]);          // String, u8, String
const SCHEMA_FIELDS = ["fullName", "ageBracket", "country"]; // must align 1:1 with layout

const [schema] = await deriveSchemaPda({ credential, name: "kyc-basic", version: 1 });

const createSchema = getCreateSchemaInstruction({
  payer,
  authority: issuer,                 // the credential's authority signs schema creation
  credential,
  schema,
  name: "kyc-basic",
  description: "Basic KYC: legal name, age bracket, residency",
  layout: SCHEMA_LAYOUT,
  fieldNames: SCHEMA_FIELDS,
});
await sendIxs(payer, [createSchema]);
```

The `Schema` account: `{ credential, name, description, layout, fieldNames, isPaused, version }`. Attestation `data` is later (de)serialized against this exact layout — see [issuing.md](issuing.md) for `serializeAttestationData`.

### Pre-submit layout validator

`layout` and `fieldNames` must be the same length and every byte must be a known type code. The program will reject mismatches, but catching it client-side saves a failed tx and an opaque error. Validate before you ever sign:

```ts
const MAX_LAYOUT_CODE = 25;

function assertValidSchema(layout: Uint8Array, fieldNames: string[]): void {
  if (layout.length !== fieldNames.length) {
    throw new Error(`layout/fieldNames length mismatch: ${layout.length} vs ${fieldNames.length}`);
  }
  layout.forEach((code, i) => {
    if (code > MAX_LAYOUT_CODE) {
      throw new Error(`field "${fieldNames[i]}" has invalid layout code ${code} (max ${MAX_LAYOUT_CODE})`);
    }
  });
  if (new Set(fieldNames).size !== fieldNames.length) {
    throw new Error("duplicate field names — deserialization keys would collide");
  }
}

assertValidSchema(SCHEMA_LAYOUT, SCHEMA_FIELDS);   // run before getCreateSchemaInstruction
```

### Versioning & retiring

`layout` cannot be edited in place — a schema's shape is fixed once created. To evolve the data model, **bump `version`** and create a fresh schema PDA; old attestations keep deserializing against the old schema. To stop new issuance under a schema (e.g. it's deprecated or compromised), pause it — verifiers should treat `isPaused` as fail-closed (see the verify pattern, which checks `schema.isPaused` before trusting any attestation):

```ts
const pause = getChangeSchemaStatusInstruction({
  authority: issuer,
  credential,
  schema,
  isPaused: true,
});
await sendIxs(payer, [pause]);
```

## Gotchas

- **Layout is immutable; version is your only migration path.** Plan fields generously up front. Adding a field later = a v2 schema + reissuing or dual-reading both versions.
- **`name` PDA seeds are truncated to 32 bytes.** Two credential/schema names sharing a 32-byte prefix collide to the same PDA. Keep names short and distinct.
- **`fieldNames` order is load-bearing.** Borsh (de)serialization is positional against `layout`; reordering fields silently corrupts every attestation. Treat the `(layout, fieldNames)` pair as frozen.
- **`isPaused` is advisory at the data layer** — the program blocks new attestations under a paused schema, but a careless *verifier* that doesn't check `isPaused` will still honor old ones. Always gate on it (see [verification.md](verification.md)).
- **Authority vs signer confusion.** Schema/credential admin instructions require the `authority`; *issuing* attestations requires an `authorizedSigner`. Mixing them up yields a confusing "missing required signature" failure.

Next: issue records against this schema → [issuing.md](issuing.md). Verify them → [verification.md](verification.md) · [hardened-verifier.md](hardened-verifier.md).

_Last verified: June 2026_
