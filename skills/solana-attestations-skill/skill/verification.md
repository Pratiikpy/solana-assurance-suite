# Verification — Proving an Attestation Is Real (June 2026)

An attestation is only worth what your *verifier* enforces. The Solana Attestation Service (SAS) program (`22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG`) writes credential → schema → attestation accounts; it does **not** decide whether *your* app should trust one. That decision is five independent checks, and skipping any one is a hole. This file gives the two verification paths — off-chain via `sas-lib`, on-chain in an Anchor program — both runnable. The full enumeration of bypasses and the test that closes each lives in [hardened-verifier.md](hardened-verifier.md); read it before you ship.

## The account you're verifying

The SAS attestation account, after a 1-byte discriminator (`@solana/kit` camelCase via `sas-lib`):

| Field | Type | Verify | Why |
|---|---|---|---|
| `nonce` | `Address` | subject binding | usually the subject wallet; binds the attestation to *who* it's about |
| `credential` | `Address` | == your trusted credential PDA | who issued it — the trust anchor |
| `schema` | `Address` | == your designated schema PDA | what it asserts (KYC vs proof-of-human are different schemas) |
| `data` | `bytes` | schema-decoded | the claim payload |
| `signer` | `Address` | ∈ credential's `authorizedSigners` | the actual signing key that wrote it |
| `expiry` | `i64` | `0 || > now` | `0` = never expires |
| `tokenAccount` | `Address` | (tokenized variant only) | default pubkey when non-tokenized |

Five load-bearing facts: **account owner is SAS**, **credential is the one you authorized**, **schema matches**, **not expired**, **not revoked** (the account still exists). Identity-of-subject (`nonce`) is the sixth when an attestation could be replayed for a different user.

## Path A — off-chain via `sas-lib`

Reusable verifier. This is the same logic the `tools/sas-verify` engine runs offline against synthetic records; keep them in lockstep.

```ts
import {
  createSolanaRpc, address, type Address,
} from "@solana/kit";
import {
  deriveAttestationPda, fetchMaybeAttestation, deserializeAttestationData,
  fetchCredential, fetchSchema,
  SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS as SAS,
} from "sas-lib";

export type VerifyParams = {
  rpc: ReturnType<typeof createSolanaRpc>;
  credential: Address;          // the credential PDA YOU authorized — hardcode/config it
  schema: Address;              // the schema PDA YOU designed for this claim
  subject: Address;             // wallet the attestation must be about (used as nonce)
  now?: number;                 // unix seconds; defaults to wall clock
};

export type VerifyResult = { ok: true; data: unknown } | { ok: false; reason: string };

export async function verifyAttestation(p: VerifyParams): Promise<VerifyResult> {
  const now = p.now ?? Math.floor(Date.now() / 1000);

  // 1. Derive the PDA from (credential, schema, nonce=subject). Never trust a
  //    caller-supplied address — derive it, so a spoofed account can't be substituted.
  const [pda] = await deriveAttestationPda({
    credential: p.credential, schema: p.schema, nonce: p.subject,
  });

  // 2. Fetch as Maybe. A revoked/closed attestation no longer exists on-chain
  //    (CloseAttestation deallocates the account), so exists:false IS revocation.
  const acct = await fetchMaybeAttestation(p.rpc, pda);
  if (!acct.exists) return { ok: false, reason: "missing-or-revoked" };

  // 3. OWNER CHECK. fetchMaybeAttestation decodes by layout, not owner — an attacker
  //    can plant a SAS-shaped account under a program they control. Pin the owner.
  if (acct.programAddress !== SAS) return { ok: false, reason: "wrong-owner" };

  const a = acct.data;

  // 4. Credential + schema must be exactly the ones you trust (defends spoofed issuer
  //    and wrong/again schema — see hardened-verifier.md).
  if (a.credential !== p.credential) return { ok: false, reason: "wrong-credential" };
  if (a.schema !== p.schema)         return { ok: false, reason: "wrong-schema" };

  // 5. Subject binding: the PDA already binds nonce, but assert explicitly so reused
  //    attestations about a different wallet can't slip through a refactor.
  if (a.nonce !== p.subject) return { ok: false, reason: "wrong-subject" };

  // 6. Signer must be a CURRENTLY authorized signer of the credential. Fetch the
  //    credential and check membership — a removed/rotated key must stop verifying.
  const cred = await fetchCredential(p.rpc, p.credential);
  if (!cred.data.authorizedSigners.includes(a.signer))
    return { ok: false, reason: "unauthorized-signer" };

  // 7. Expiry. 0 = never. Otherwise must be strictly in the future.
  const exp = Number(a.expiry);
  if (exp !== 0 && exp <= now) return { ok: false, reason: "expired" };

  // 8. Schema sanity + typed decode. A paused schema means the issuer froze it.
  const schema = await fetchSchema(p.rpc, p.schema);
  if (schema.data.isPaused) return { ok: false, reason: "schema-paused" };
  const data = deserializeAttestationData(schema.data, a.data as Uint8Array);

  return { ok: true, data };
}
```

Run it:

```ts
const rpc = createSolanaRpc(process.env.RPC_URL!);
const res = await verifyAttestation({
  rpc,
  credential: address("Cred1111111111111111111111111111111111111111"),
  schema:     address("Schem111111111111111111111111111111111111111"),
  subject:    address(userWallet),
});
if (!res.ok) throw new Error(`attestation rejected: ${res.reason}`);
```

`fetchAttestation` (non-Maybe) *throws* on a missing account, which collapses "revoked" and "RPC error" into one catch — use `fetchMaybeAttestation` so revocation is an explicit, testable branch.

## Path B — on-chain in an Anchor program

When the gate must be trustless (a claim, a mint, a permissioned action), read the SAS account inside your program and enforce the same checks before granting access. The attestation arrives as an `UncheckedAccount`; you validate it yourself.

```rust
use anchor_lang::prelude::*;

pub const SAS_PROGRAM_ID: Pubkey = pubkey!("22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG");
const ATTESTATION_DISCRIMINATOR: u8 = 2; // attestation account discriminator byte

#[derive(Accounts)]
pub struct Gated<'info> {
    /// CHECK: SAS-owned attestation PDA; fully validated in `verify_attestation`.
    pub attestation: UncheckedAccount<'info>,
    pub subject: Signer<'info>,
    // config holds the credential + schema pubkeys YOU trust (set at init, immutable)
    pub config: Account<'info, GateConfig>,
}

/// Minimal borsh-compatible view of the SAS attestation account body.
struct AttView { nonce: Pubkey, credential: Pubkey, schema: Pubkey,
                 data_len: u32, /* data */ signer: Pubkey, expiry: i64 }

fn parse(buf: &[u8]) -> Result<AttView> {
    require!(buf.len() > 1 + 32 * 3 + 4, GateError::Malformed);
    require_eq!(buf[0], ATTESTATION_DISCRIMINATOR, GateError::WrongDiscriminator);
    let mut o = 1;
    let take = |o: &mut usize| { let k = Pubkey::try_from(&buf[*o..*o + 32]).unwrap(); *o += 32; k };
    let nonce = take(&mut o); let credential = take(&mut o); let schema = take(&mut o);
    let data_len = u32::from_le_bytes(buf[o..o + 4].try_into().unwrap()); o += 4 + data_len as usize;
    let signer = Pubkey::try_from(&buf[o..o + 32]).unwrap(); o += 32;
    let expiry = i64::from_le_bytes(buf[o..o + 8].try_into().unwrap());
    Ok(AttView { nonce, credential, schema, data_len, signer, expiry })
}

pub fn verify_attestation(ctx: &Context<Gated>) -> Result<()> {
    let acc = &ctx.accounts.attestation;
    let cfg = &ctx.accounts.config;

    // 1. OWNER first. Without this, any account is fair game.
    require_keys_eq!(*acc.owner, SAS_PROGRAM_ID, GateError::WrongOwner);

    // 2. PDA binding: confirm this IS the attestation for (credential, schema, subject).
    let (expected, _) = Pubkey::find_program_address(
        &[b"attestation", cfg.credential.as_ref(), cfg.schema.as_ref(),
          ctx.accounts.subject.key().as_ref()],
        &SAS_PROGRAM_ID);
    require_keys_eq!(acc.key(), expected, GateError::WrongPda);

    // 3. Decode + assert credential/schema/subject (PDA already binds them; assert anyway).
    let a = parse(&acc.try_borrow_data()?)?;
    require_keys_eq!(a.credential, cfg.credential, GateError::WrongCredential);
    require_keys_eq!(a.schema, cfg.schema, GateError::WrongSchema);
    require_keys_eq!(a.nonce, ctx.accounts.subject.key(), GateError::WrongSubject);

    // 4. Authorized signer: cfg pins the set at init; reject anything outside it.
    require!(cfg.authorized_signers.contains(&a.signer), GateError::BadSigner);

    // 5. Expiry: 0 = never; else must be in the future.
    let now = Clock::get()?.unix_timestamp;
    require!(a.expiry == 0 || a.expiry > now, GateError::Expired);

    // Revocation is enforced for free: a closed attestation account fails the owner
    // check (owner becomes system program / account gone) — there's nothing to read.
    Ok(())
}
```

On-chain you cannot re-fetch the credential's live `authorizedSigners` cheaply, so pin the trusted signer set into your own config at init and rotate it deliberately. If you need the live set, pass the credential account too and parse it the same way. **Revocation requires no extra logic on-chain**: `CloseAttestation` deallocates the account, so the owner check (Step 1) rejects it automatically.

## What the `tools/sas-verify` engine checks

`tools/sas-verify/verify.mjs` is the **offline** form of the logic above — zero deps, no RPC — so the checks can be tested deterministically. It exports `verifyAttestation(att, expected, nowUnix)`, where a record is the shape you'd reconstruct from a fetched account:

```js
// att      = { owner, credential, schema, subject, issuer, data, expiry /* 0 = none */, revoked }
// expected = { credential, schema, subject?, issuer? }   // what YOU require
// → { valid: boolean, reasons: string[] }
```

It runs the same gate in order — owner == SAS program, credential match, schema match, subject binding, revocation, expiry (`nowUnix > expiry`), issuer is an authorized signer — and `nowUnix` is **required** (it refuses to read the wall clock implicitly). The offline model collapses two real-chain facts into record flags for testability: revocation is the `revoked` boolean (on real chain, the closed account simply ceases to exist) and the issuer is the `issuer` field (real chain: the attestation's `signer`). The reasons it emits are human strings (`"account owner is not the SAS program (spoofed account)"`, `"credential authority mismatch"`, `"schema mismatch"`, `"subject mismatch (attestation reuse)"`, `"attestation revoked"`, `"attestation expired"`, `"issuer is not an authorized signer"`).

The companion proof at `examples/attestation-verify` constructs one valid record and mutates it into each bypass, asserting the verdict with a fixed clock (**9/9 cases**). That proof is the regression gate — see [hardened-verifier.md](hardened-verifier.md) for the attack-to-test mapping and the ship gate.

_Last verified: June 2026_
