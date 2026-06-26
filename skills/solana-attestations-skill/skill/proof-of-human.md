# Proof-of-Human — One Worked Example, End to End (June 2026)

The whole SAS primitive in one flow: an off-chain humanity signal becomes a durable, reusable on-chain credential that any downstream program can verify with a cheap account read. The discipline to internalize: **the off-chain verdict is the upstream signal; the SAS attestation is the credential.** Proof-of-Human / Civic / the `verify-humanity-poh` skill tells you *whether* a wallet is a unique human at a moment in time. SAS is where that verdict *lives* afterward — signed by an authorized issuer, expiring on a schedule, revocable, and readable by programs that never talk to the upstream provider.

Get this wrong and you've built nothing durable: if every consumer re-calls the humanity provider, you have a centralized oracle with an availability and privacy problem. SAS turns a one-time verification into a portable credential. Verify once, present everywhere.

## The pipeline

```
 [ Proof-of-Human / Civic / POH ]      off-chain humanity verdict (signal)
              │  uniqueness proof, score, "is-human: true", validUntil
              ▼
 [ Authorized issuer service ]         holds an authorized_signer key for YOUR credential
              │  signs a SAS attestation under (credential, proof-of-human schema)
              ▼
 [ SAS attestation account ]           DURABLE on-chain credential — owner = SAS program
              │  nonce = subject wallet, expiry = validUntil, data = {verdict}
              ▼
 [ Downstream programs / apps ]        verify the attestation (verification.md) — never re-call POH
```

Three roles, one direction. The issuer is the only party that touches the upstream provider; everyone downstream trusts the attestation, gated by the [hardened-verifier.md](hardened-verifier.md) checks.

## Step 0 — one-time issuer setup (credential + schema)

Done once. The credential names the trust anchor and its signing keys; the schema fixes the shape of a proof-of-human verdict.

```ts
import {
  getCreateCredentialInstruction, getCreateSchemaInstruction,
  deriveCredentialPda, deriveSchemaPda,
} from "sas-lib";
import { address } from "@solana/kit";

const issuerAuthority = address(ISSUER_AUTHORITY);  // admin of the credential
const signer = address(ISSUER_SIGNER);              // the key that signs attestations

const [credential] = await deriveCredentialPda({ authority: issuerAuthority, name: "acme-poh" });
const createCred = getCreateCredentialInstruction({
  authority: issuerAuthority, credential,
  name: "acme-poh", signers: [signer],             // authorized_signers set
});

// Schema: a compact proof-of-human verdict. layout = SchemaDataTypes byte per field.
// 11=Bool, 1=U16, 12=Char(used here as a single-byte provider tag), 4=U64.
const [schema] = await deriveSchemaPda({ credential, name: "proof-of-human", version: 1 });
const createSchema = getCreateSchemaInstruction({
  authority: issuerAuthority, credential, schema,
  name: "proof-of-human",
  description: "Unique-human verdict from an off-chain provider",
  layout: Buffer.from([11, 1, 4]),                 // isHuman:Bool, score:U16, verifiedAt:U64
  fieldNames: ["isHuman", "score", "verifiedAt"],
});
// → send [createCred, createSchema] in a tx signed by issuerAuthority
```

`credential` and `schema` are the two pubkeys every downstream verifier pins. Publish them; they're public trust anchors, not secrets.

## Step 1 — get the off-chain humanity verdict

The issuer service calls the provider (Proof-of-Human, Civic Pass, or the `verify-humanity-poh` flow) for the subject wallet. This is the **signal** — it is *not* yet on-chain and confers nothing by itself.

```ts
// Pseudocode — provider-specific. Output: a verdict the issuer is willing to vouch for.
const verdict = await poh.verify(subjectWallet);
// { isHuman: true, score: 980, validUntil: 1788000000 }  // validUntil = unix seconds
if (!verdict.isHuman) throw new Error("not a unique human — do not attest");
```

The issuer decides its own policy (minimum score, accepted providers, re-verification cadence). SAS records the *outcome* the issuer chose to vouch for, not the raw provider response.

## Step 2 — issue the SAS proof-of-human attestation

The authorized signer signs an attestation about `subjectWallet`. `nonce = subjectWallet` binds it to the subject; `expiry = validUntil` makes it self-expiring; `data` is the verdict serialized to the schema.

```ts
import {
  deriveAttestationPda, serializeAttestationData,
  getCreateAttestationInstruction, fetchSchema,
} from "sas-lib";

const subject = address(subjectWallet);
const [attestation] = await deriveAttestationPda({ credential, schema, nonce: subject });

const schemaAccount = await fetchSchema(rpc, schema);
const data = serializeAttestationData(schemaAccount.data, {
  isHuman: verdict.isHuman, score: verdict.score, verifiedAt: BigInt(Math.floor(Date.now()/1000)),
});

const createAtt = getCreateAttestationInstruction({
  authority: signer,             // MUST be an authorized_signer of the credential
  credential, schema, attestation,
  nonce: subject,                // the subject wallet — the "who is this about"
  expiry: BigInt(verdict.validUntil),  // 0 = never; here we expire with the provider's verdict
  data,
});
// → send [createAtt] in a tx signed by `signer`
```

When the verdict later lapses or is overturned (sanctions hit, sybil discovered), the issuer revokes by calling `getCloseAttestationInstruction` — which **deallocates** the account. Downstream verifiers see it vanish and fail closed (see [hardened-verifier.md](hardened-verifier.md) #4). No re-call to the provider needed; revocation is a single on-chain action.

## Step 3 — downstream programs verify (no provider contact)

Any app reads the attestation and runs the full check set from [verification.md](verification.md). It never touches Proof-of-Human/Civic — that dependency was severed at issuance.

```ts
const res = await verifyAttestation({ rpc, credential, schema, subject });
if (!res.ok) routeToVerification(res.reason);   // e.g. "expired" → re-verify with POH
else grant(res.data);                            // res.data = { isHuman, score, verifiedAt }
```

If verification fails because the attestation is missing or expired, that's a *conversion* moment, not a rejection: send the user back through Step 1–2 to refresh the credential. A real human with a lapsed attestation is not a sybil.

## Composition with sybil defense — two orthogonal gates

Proof-of-human answers *"is this a unique human?"* Sybil-cluster analysis answers *"is this wallet part of a coordinated farm?"* They miss different attackers and are strongest **AND-ed together**:

```
eligible(wallet) =  NOT in a sybil cluster        ← funding-graph / behavioral analysis (off-chain → merkle root)
                 AND holds a valid proof-of-human ← SAS attestation (this skill)
```

A funded sybil farm can include real humans (one human, many wallets); proof-of-human alone passes them. A lone sophisticated actor evades clustering (recall ~0.92, not 1.0); the human attestation is hard to mass-produce. Neither gate is sufficient; the conjunction is far stronger than either.

```ts
import { createSolanaRpc, address } from "@solana/kit";
import { deriveAttestationPda, fetchMaybeAttestation,
         SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS as SAS } from "sas-lib";

const rpc = createSolanaRpc(process.env.RPC_URL!);

// Gate B — proof-of-human attestation (this skill).
async function hasValidHumanAttestation(wallet: string, credential: string, schema: string) {
  const subject = address(wallet);
  const [pda] = await deriveAttestationPda({
    credential: address(credential), schema: address(schema), nonce: subject });
  const acct = await fetchMaybeAttestation(rpc, pda);
  if (!acct.exists) return false;                         // missing or revoked
  if (acct.programAddress !== SAS) return false;          // owner check — non-negotiable
  const a = acct.data;
  if (a.credential !== address(credential) || a.schema !== address(schema)) return false;
  if (a.nonce !== subject) return false;                  // bound to this subject
  const exp = Number(a.expiry);
  return exp === 0 || exp > Math.floor(Date.now() / 1000);
}

// Gate A — not in a sybil cluster (sibling skill): excluded wallets are absent from the
// merkle tree, so "in the tree" IS the sybil gate. See the solana-sybil-defense skill.
export async function isEligible(wallet: string, tree: MerkleTree, cred: string, schema: string) {
  const entry = tree.claimants.find(c => c.claimant === wallet);
  if (!entry) return { eligible: false, reason: "in-sybil-cluster-or-not-eligible" };
  if (!(await hasValidHumanAttestation(wallet, cred, schema)))
    return { eligible: false, reason: "no-valid-human-attestation", action: "verify-humanity" };
  return { eligible: true, index: entry.index, amount: entry.amount, proof: entry.proof };
}
```

On-chain, the same conjunction: the claim program verifies the merkle proof (sybil gate — a flagged wallet simply has no valid proof) **and** reads the SAS attestation PDA (human gate). The sibling's claim program and full two-gate Anchor sketch live in [solana-sybil-defense / integration.md](../../solana-sybil-defense/skill/integration.md); the SAS account layout and the verifier those checks instantiate are in [verification.md](verification.md) and [hardened-verifier.md](hardened-verifier.md). Commit the decision, not the computation: merkle root for sybil exclusion, SAS attestation for humanity — both cheap on-chain reads, the expensive analysis off-chain.

> SAS program ID (mainnet): `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG`. Confirm per cluster (see [resources.md](resources.md)) and verify by the fetched account's **owner**, never by a hardcoded string copied from elsewhere.

_Last verified: June 2026_
