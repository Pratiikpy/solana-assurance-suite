# Hardened Verifier — Every Way a Naive Check Gets Fooled (June 2026)

A verifier that does `if (await fetchAttestation(rpc, pda)) grantAccess()` is worse than no verifier — it manufactures false trust. SAS gives you a tamper-evident record; trust comes from what *you* assert about it. This is the security spine of the skill: seven concrete bypasses, the exact check that stops each, and the `tools/sas-verify` test that proves the check holds. Pair with [verification.md](verification.md) for the runnable verifier these checks live in.

Mental model: an attestation account is just *bytes owned by a program*. An attacker controls (a) which account address you read, (b) what bytes are in any account *they* own, and (c) time. Every attack below is one of those three. The defenses pin down owner, address, and field values so attacker-controlled inputs can't masquerade as a trusted issuer's claim.

---

## 1. Spoofed credential authority

**Attack.** Attacker stands up their *own* credential (anyone can — SAS is permissionless), adds themselves as an authorized signer, and issues a perfectly valid attestation under *their* credential. It deserializes cleanly, signer is authorized, not expired. A verifier that only checks "is this a well-formed attestation?" grants access.

**Check.** Pin the credential. `a.credential` MUST equal the specific credential PDA *you* authorized (config/constant), not merely "some credential." The credential PDA is `["credential", authority, name]` — derive the one you trust and compare bytes.

```ts
if (a.credential !== TRUSTED_CREDENTIAL) return fail("wrong-credential");
```

**Test.** `examples/attestation-verify` — *wrong credential authority*: a record valid in every field but `credential` ≠ the trusted one ⇒ `valid:false`, reason `"credential authority mismatch"`.

---

## 2. Wrong / "again" schema mismatch

**Attack.** Two failure modes. (a) The attacker (or an honest-but-confused integration) presents an attestation under a *different* schema — e.g. a "newsletter-signup" attestation accepted where a "KYC-verified" one was required. (b) A schema *version* bump: you trust `version 1`, attacker presents the otherwise-identical `version 2` PDA. Same shape, different meaning.

**Check.** Pin the exact schema PDA, version included. Schema PDA is `["schema", credential, name, version]` — version is part of the seed, so v1 and v2 are *different addresses*. Compare `a.schema` to your designated schema; don't pattern-match the name. Version drift folds into this same equality check — a bumped version yields a different PDA and trips it.

```ts
if (a.schema !== TRUSTED_SCHEMA) return fail("wrong-schema");
```

**Test.** `examples/attestation-verify` — *schema mismatch*: a record under a sibling schema ⇒ `valid:false`, reason `"schema mismatch"`. (A version bump is the same case with a different PDA.)

---

## 3. Expired attestation accepted

**Attack.** A KYC/proof-of-human attestation issued with `expiry` set; it lapsed. The account still exists on-chain (expiry doesn't auto-close it), so a verifier that never reads `expiry` honors a stale claim indefinitely.

**Check.** Read `expiry` (`i64`). `0` means never-expires; any other value must be in the future. Use chain time (`Clock` on-chain) — never trust a client-supplied "now." `tools/sas-verify` enforces this by *requiring* an explicit `nowUnix` arg and refusing the wall clock.

```ts
const exp = Number(a.expiry);
if (exp !== 0 && now > exp) return fail("expired");
```

**Test.** `examples/attestation-verify` — *expired* (`expiry` in the past, `nowUnix > expiry` ⇒ reason `"attestation expired"`) **and** *non-expiring* (`expiry: 0`, otherwise valid ⇒ accepted). The pair locks the `0`-means-never branch against the comparison.

---

## 4. Revoked attestation still honored

**Attack.** The issuer revoked the credential (KYC failed retroactively, user offboarded) by calling `CloseAttestation`. A verifier that cached the attestation, or that calls `fetchAttestation` and swallows the throw, keeps granting access to a revoked subject.

**Check.** Revocation in SAS = the account is **closed/deallocated** (lamports returned, data gone), and a `CloseAttestationEvent` is emitted. So: fetch fresh every time with `fetchMaybeAttestation` and require `exists === true`; on-chain, the owner check fails because the account no longer exists / is owned by the system program. Never cache a "verified" result past the action it gated.

```ts
const acct = await fetchMaybeAttestation(rpc, pda);
if (!acct.exists) return fail("missing-or-revoked");
```

**Test.** `examples/attestation-verify` — *revoked*: the offline engine models revocation as a `revoked:true` flag on the record (on real chain the account is simply gone) ⇒ `valid:false`, reason `"attestation revoked"`. The proof takes the valid record and flips only `revoked`, asserting the verdict flips accepted → rejected.

---

## 5. Attestation about a different subject, reused

**Attack.** Alice has a valid proof-of-human attestation. Mallory grabs Alice's attestation PDA and presents it to claim *as Mallory*. The attestation is genuine, current, correctly-issued — it's just not *about Mallory*.

**Check.** Bind to the subject. The attestation's `nonce` is the subject (the wallet it's about). Two layers: (a) **derive** the PDA from `(credential, schema, subjectWallet)` rather than accepting a caller-supplied address — a different subject yields a different PDA, so substitution can't even resolve; (b) assert `a.nonce === subjectWallet` explicitly so a refactor that reintroduces caller-supplied addresses still fails closed.

```ts
const [pda] = await deriveAttestationPda({ credential, schema, nonce: subject });
// ...after fetch:
if (a.nonce !== subject) return fail("wrong-subject");
```

(In the offline engine the subject lives in the record's `subject` field and `expected.subject`; on real chain it's the attestation's `nonce` plus the re-derived PDA.)

**Test.** `examples/attestation-verify` — *subject reuse*: a valid record whose `subject` ≠ `expected.subject` ⇒ `valid:false`, reason `"subject mismatch (attestation reuse)"`.

---

## 6. Fake issuer signer

**Attack.** Attacker crafts an attestation under your trusted credential and schema but the issuing key *isn't* one of the credential's authorized signers — or *was* authorized but has since been rotated out via `ChangeAuthorizedSigners`. A verifier that trusts "credential matches" without checking the signing key accepts forged or stale-key attestations.

**Check.** The attestation's `signer` (the engine's `issuer` field) MUST be a member of the credential's *current* authorized set. Off-chain, fetch the credential and check membership live so a rotated-out key stops verifying. On-chain, pin the authorized set in your config and rotate it deliberately, or pass and parse the credential account.

```ts
const cred = await fetchCredential(rpc, credential);
if (!cred.data.authorizedSigners.includes(a.signer)) return fail("unauthorized-signer");
```

**Test.** `examples/attestation-verify` — *unauthorized issuer*: a record whose `issuer` ≠ `expected.issuer` (the pinned authorized signer) ⇒ `valid:false`, reason `"issuer is not an authorized signer"`. A rotated-out key is the same case — it's no longer the pinned/expected issuer.

---

## 7. Trusting account data without checking the OWNER

**Attack.** The deepest one. Deserialization is layout-based, not authenticity-based: `fetchMaybeAttestation` / a borsh decode will happily parse *any* account whose bytes match the attestation layout — including an account the **attacker owns**, where they wrote whatever credential, schema, signer, and expiry they like. Skip the owner check and every other check is theater, because the attacker chose all the values you're comparing.

**Check.** The owner of the account MUST be the SAS program `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG`. Off-chain assert `acct.programAddress === SAS`; on-chain `require_keys_eq!(*acc.owner, SAS_PROGRAM_ID, …)` **before** reading any field. This is the root of trust — only the SAS program can have produced these bytes under its own ownership.

```ts
if (acct.programAddress !== SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS) return fail("wrong-owner");
```

**Test.** `examples/attestation-verify` — *spoofed account (owner ≠ SAS program)*: a byte-identical, fully-valid attestation layout whose `owner` is a non-SAS program ⇒ `valid:false`, reason `"account owner is not the SAS program (spoofed account)"`. This is the canary; if it ever passes, the verifier is structurally broken.

---

## Attack → check → test matrix

| # | Bypass | Field / property | Check | `attestation-verify` case → engine reason |
|---|---|---|---|---|
| 7 | Trusting data, not owner | account `owner` | `== SAS_PROGRAM_ID` (first) | *spoofed account* → `"account owner is not the SAS program (spoofed account)"` |
| 1 | Spoofed credential authority | `credential` | `== TRUSTED_CREDENTIAL` | *wrong credential authority* → `"credential authority mismatch"` |
| 2 | Wrong / version-drift schema | `schema` | `== TRUSTED_SCHEMA` (version in seed) | *schema mismatch* → `"schema mismatch"` |
| 5 | Reused for another subject | `nonce`/`subject` | derive PDA from subject + assert | *subject reuse* → `"subject mismatch (attestation reuse)"` |
| 4 | Revoked still honored | existence / `revoked` | fresh `fetchMaybe.exists` / owner check | *revoked* → `"attestation revoked"` |
| 3 | Expired accepted | `expiry` | `0 \|\| now ≤ expiry` | *expired* → `"attestation expired"` (+ *non-expiring* accepted) |
| 6 | Fake / rotated signer | `signer`/`issuer` | ∈ credential authorized set | *unauthorized issuer* → `"issuer is not an authorized signer"` |

Plus the **valid** baseline ⇒ accepted. That's the 9 cases the proof asserts (`# pass 9`). Order matters: **owner → PDA/existence → field equality → signer → time**. Owner first because it gates the meaning of every later check.

## Ship gate

Do not ship a verifier until all hold:

- [ ] **Owner check is first and unconditional.** No field is read before the SAS owner is confirmed. The *spoofed account* case rejects.
- [ ] **Credential and schema are pinned to specific PDAs** (config/constant), version included — not matched by name or "any valid credential." *wrong credential authority* and *schema mismatch* reject.
- [ ] **Subject is bound** by deriving the PDA from the subject wallet *and* asserting it. *subject reuse* rejects.
- [ ] **Signer/issuer membership is checked** against the credential's authorized set (live off-chain, pinned-and-rotated on-chain). *unauthorized issuer* rejects; a rotated-out key no longer matches.
- [ ] **Expiry uses chain time**, `0`=never. *expired* rejects, *non-expiring* (`0`) accepts.
- [ ] **Revocation = non-existence**, fetched fresh, never cached past the gated action. *revoked* flips the verdict.
- [ ] **`examples/attestation-verify` runs in CI** (`node --test`, **9/9**) and exits non-zero if any accept→valid or attack→reject assertion regresses. Green is the merge gate.
- [ ] **Fail closed.** Every error path (RPC failure, malformed bytes, unexpected discriminator) returns reject, never grant.

A verifier that passes this gate is the strength of the whole system: the attestation is durable on-chain, and the gate is the part an attacker actually has to beat. See [verification.md](verification.md) for the implementations and `tools/sas-verify` for the offline engine that encodes every case above.

_Last verified: June 2026_
