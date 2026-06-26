# SAS Overview — the Credential Primitive

> **In this skill**: [credentials-and-schemas.md](credentials-and-schemas.md) · [issuing.md](issuing.md) · [verification.md](verification.md) · [hardened-verifier.md](hardened-verifier.md) · back to [SKILL.md](SKILL.md)

The **Solana Attestation Service (SAS)** is the Solana Foundation's canonical, permissionless standard for on-chain verifiable credentials — live on **mainnet since 2025**. It answers one question durably and trustlessly: *"has a party I trust vouched something about this wallet?"* — KYC pass, proof-of-human, allowlist membership, DAO role, accreditation. One on-chain program (`sas-lib` / `solana-attestation-service-client`), one account model, reused across every app instead of each dApp rebuilding its own credential store.

It is the Solana answer to EVM's **EAS** (Ethereum Attestation Service) + **Verax**, but designed for Solana's stateless, account-centric runtime: where EAS leans on a stateful registry contract, SAS encodes each credential, schema, and attestation as a **PDA** the program owns. No global mutable registry; the address *is* the lookup.

### Why the EAS precedent matters

EAS proved the pattern out: a *single* neutral attestation standard, not one credential contract per app, is what makes credentials composable across an ecosystem. Wallets, DeFi protocols, DAOs, and gating UIs all read the same schema/attestation shape, and a verdict issued for one app is reusable by the next. Verax layered a registry + module system on top for shared discoverability. SAS imports that lesson and adapts the storage model to Solana: attestations are PDAs (cheap, parallel-readable, ownable by the program), schemas are typed byte layouts rather than ABI-encoded structs, and lookups are deterministic address derivations instead of event-log scans. Practically: if you've built on EAS, the credential→schema→attestation triad and "issuer vouches, consumer verifies" trust flow map 1:1; what changes is that you derive a PDA and read an account instead of querying a registry contract.

### When to reach for SAS (and when not)

Use SAS when a fact about a wallet must be **durable, portable, and trustlessly verifiable by code you don't control** — KYC pass, proof-of-human, allowlist/whitelist membership, DAO role, accreditation, region eligibility. Don't use it for ephemeral or purely off-chain state (a session token, a UI preference), for self-asserted data with no trusted issuer (it's only as meaningful as the authority behind it), or where a private database is genuinely sufficient and you want no on-chain footprint. The value is composability and trustless reads; if nothing else will ever read the credential, SAS is overkill.

## The mental model: Credential → Schema → Attestation

Three account types, derived in order. Each lower level references the one above by address.

```
Credential   (an issuer/namespace)        PDA["credential", authority, name]
  └─ authority + authorizedSigners[]       who may issue under it
       │
       ▼
Schema       (a typed data layout)          PDA["schema", credential, name, version]
  └─ layout[] + fieldNames[] + isPaused     the shape every attestation must match
       │
       ▼
Attestation  (one issued record)            PDA["attestation", credential, schema, nonce]
  └─ data + signer + expiry + nonce         a fact about a subject, revocable
```

- **Credential** — the *issuer identity / namespace*. Has an `authority` (root controller, can rotate signers) and `authorizedSigners[]` (the keys actually allowed to sign attestations). One org = one credential; it can host many schemas. See [credentials-and-schemas.md](credentials-and-schemas.md).
- **Schema** — the *typed layout* under a credential: a compact byte `layout` (one type code per field) + `fieldNames`. Immutable shape, `version`-bumped to evolve, `isPaused` to retire. This is the contract attestation data is (de)serialized against. See [credentials-and-schemas.md](credentials-and-schemas.md).
- **Attestation** — *one issued, on-chain record* conforming to a schema, about a subject. The subject is bound via the `nonce` (typically the subject's wallet address). Carries serialized `data`, the `signer` that issued it, and an `expiry` (unix seconds; `0` = never). Closable to revoke. See [issuing.md](issuing.md).

The subject binding lives in the **PDA derivation itself**: `deriveAttestationPda({ credential, schema, nonce })`. Pass the subject wallet as `nonce` and the address is deterministic — anyone can recompute it and check "does an attestation exist for *this* wallet under *this* credential+schema?" without an index.

## SAS vs per-wallet bot-detection APIs

A common confusion: SAS is **not** a proof-of-human API. Services that score "is this wallet a bot?" (Civic Pass, the `verify-humanity-poh` style of API) produce **one off-chain signal at one point in time**. SAS is the **durable on-chain credential layer** those signals should be *attested into*.

| | per-wallet detection API | SAS attestation |
|---|---|---|
| Lives | off-chain, queried live | on-chain PDA, owned by the SAS program |
| Lifetime | a momentary verdict | persistent until expiry/revocation |
| Trust model | trust the API at read time | trust the issuer at *issue* time; verify the record at read time |
| Composability | each consumer re-calls the API | any program/client reads one account |
| Who can act on it | only systems with API access | any on-chain program via CPI/read |

Right architecture: run Civic (or any humanity check) **once**, then have an authorized signer **issue a SAS attestation** capturing that verdict. Downstream code — your claim program, another dApp — trusts the on-chain attestation, never a live API call. Proof-of-human is therefore *one schema instance*, not the whole story; the same primitive carries KYC, region eligibility, or reputation equally. This skill is the **SAS primitive lifecycle**, not a humanity API.

## The account/PDA model at a glance

Everything is a PDA off the SAS program. Program address (verify against [resources](SKILL.md) before mainnet):

```
22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG
```

```ts
import {
  deriveCredentialPda, deriveSchemaPda, deriveAttestationPda,
  SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
} from "sas-lib";            // @solana/kit 6.x compatible client

// Issuer namespace
const [credential] = await deriveCredentialPda({ authority: issuer.address, name: "ACME-KYC" });
// Typed layout, versioned
const [schema] = await deriveSchemaPda({ credential, name: "kyc-basic", version: 1 });
// One record about a subject — nonce IS the subject binding
const [attestation] = await deriveAttestationPda({ credential, schema, nonce: subjectWallet });
```

Account fields you will read (full structs in [verification.md](verification.md)):
- `Credential`: `authority`, `name`, `authorizedSigners[]`
- `Schema`: `credential`, `name`, `description`, `layout`, `fieldNames`, `isPaused`, `version`
- `Attestation`: `nonce`, `credential`, `schema`, `data`, `signer`, `expiry`, `tokenAccount`

> **The load-bearing rule.** An attestation account is *just bytes* until you verify it. Before trusting one you must confirm its **owner is the SAS program**, that it is the PDA for the exact `(credential, schema, subject)` you expect, that the schema is the one you designated, and that it is **not expired and not revoked**. Reading the `data` of an attacker-supplied account without these checks is the canonical SAS exploit. See [verification.md](verification.md) and the full checklist in [hardened-verifier.md](hardened-verifier.md).

## Where to go next

- Stand up an issuer + define a typed schema → [credentials-and-schemas.md](credentials-and-schemas.md)
- Issue, expire, batch, and revoke attestations → [issuing.md](issuing.md)
- Verify safely off-chain and on-chain → [verification.md](verification.md) · [hardened-verifier.md](hardened-verifier.md)

_Last verified: June 2026_
