# Integration — Gating a Claim, Payment, or Access Flow on a Valid Attestation (June 2026)

An attestation is only worth issuing if something *gates* on it. This file wires a SAS attestation into a live decision path — claim, mint, payment, or access — both on-chain (the program rejects without a valid attestation) and off-chain (the UI/backend refuses to build a doomed transaction or serve a protected resource). The single rule that governs all of it: **an attestation is data on an account you don't control until you've verified it.** Everything below is the discipline of [hardened-verifier.md](hardened-verifier.md) applied at the gate.

## Where the gate lives — on-chain vs off-chain

| Gate location | What it buys | What it costs | Use when |
|---|---|---|---|
| **On-chain** (program CPIs/deserializes the SAS account) | trustless, censorship-resistant, enforced for everyone | one extra account + deserialize CU per call; you write defensive parsing | claims, mints, anything value-bearing or adversarial |
| **Off-chain** (backend checks `fetchAttestation` before signing/serving) | cheap, flexible, good UX (catch failures before submit) | the backend is a trusted oracle and a single point of bypass | API access, rate-gating, *mirroring* the on-chain gate for UX |

The honest answer is usually **both**: off-chain for UX (don't let a user submit a transaction that will fail; don't strand a real human — route them into the issuing flow), on-chain for the actual security boundary. **Never let an off-chain verdict be the only gate on value** — a backend that says "this wallet is human, go ahead" is forgeable the moment someone bypasses your backend. See [rules/attestation-safety.md](../rules/attestation-safety.md).

## On-chain gate — Anchor

The program receives the attestation account and refuses to act unless it survives every check. Treat it as `UncheckedAccount` and validate manually — that is the whole point.

```rust
use anchor_lang::prelude::*;

// SAS program — confirm per cluster against official docs before deploying.
pub const SAS_PROGRAM_ID: Pubkey = pubkey!("22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG");

#[derive(Accounts)]
pub struct GatedAction<'info> {
    #[account(seeds = [b"gate"], bump)]
    pub gate: Account<'info, GateConfig>,        // holds the trusted credential + schema pubkeys
    /// CHECK: SAS attestation account. NOT trusted — validated in `require_valid_attestation`.
    pub attestation: UncheckedAccount<'info>,
    pub subject: Signer<'info>,                  // the party the attestation must be about
    // ... whatever the action touches: vault, ata, token_program, etc.
}

pub fn gated_action(ctx: Context<GatedAction>) -> Result<()> {
    let g = &ctx.accounts.gate;
    require_valid_attestation(
        &ctx.accounts.attestation,
        &g.credential,
        &g.schema,
        &ctx.accounts.subject.key(),
        Clock::get()?.unix_timestamp,
    )?;
    // ...proceed: transfer, mint, mark access. The gate has passed.
    Ok(())
}

/// The hardened check, on-chain. Mirrors tools/sas-verify/verify.mjs check-for-check.
fn require_valid_attestation(
    acct: &UncheckedAccount,
    credential: &Pubkey,
    schema: &Pubkey,
    subject: &Pubkey,
    now: i64,
) -> Result<()> {
    // 1. OWNER. The #1 footgun: skip this and an attacker hands you a look-alike
    //    account they own with forged fields.
    require_keys_eq!(*acct.owner, SAS_PROGRAM_ID, GateError::NotSasOwned);

    // 2. Deserialize defensively from the SAS account layout (see verification.md /
    //    deserializeAttestation for the canonical field offsets). Never `unwrap` borsh.
    let data = acct.try_borrow_data()?;
    let att = Attestation::try_deserialize(&mut &data[..]).map_err(|_| GateError::Malformed)?;

    // 3. credential authority must be the one you trust
    require_keys_eq!(att.credential, *credential, GateError::WrongCredential);
    // 4. schema must match exactly — wrong schema means a different claim
    require_keys_eq!(att.schema, *schema, GateError::WrongSchema);
    // 5. subject binding — stops attestation reuse / lending
    require_keys_eq!(att.subject, *subject, GateError::WrongSubject);
    // 6. revocation
    require!(!att.revoked, GateError::Revoked);
    // 7. expiry (0 = non-expiring)
    require!(att.expiry == 0 || now <= att.expiry, GateError::Expired);
    Ok(())
}
```

Prefer reading the SAS account directly (it's a PDA you can derive and pass in) over a CPI — there's nothing to CPI *to* for a read; the security is in the owner check + defensive deserialize, not in who you call. If a future SAS release exposes an on-chain `verify` CPI, the owner check still comes first.

## Off-chain gate — sas-lib + @solana/kit 6.x

Mirror the exact same checks before signing a transaction or serving a protected route. This is for UX and for non-value flows (API access); it is **not** a substitute for the on-chain gate on value.

```ts
import { createSolanaRpc, address, type Address } from "@solana/kit";
import { fetchAttestation, deriveAttestationPda } from "sas-lib";

const SAS = address("22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG");
const rpc = createSolanaRpc(process.env.RPC_URL!);

type GateExpect = { credential: Address; schema: Address; issuer?: Address };

export async function attestationGate(subject: Address, want: GateExpect) {
  const [pda] = await deriveAttestationPda({
    credential: want.credential,
    schema: want.schema,
    nonce: subject,                          // attestation PDA is bound to the subject
  });

  // fetchAttestation returns the parsed account incl. its owner program.
  let att;
  try {
    att = await fetchAttestation(rpc, pda);
  } catch {
    return { ok: false, reason: "no-attestation", action: "issue" } as const;
  }

  const now = Math.floor(Date.now() / 1000);
  const a = att.data;
  if (att.programAddress !== SAS)              return fail("not-sas-owned");      // owner check
  if (a.credential !== want.credential)        return fail("wrong-credential");
  if (a.schema !== want.schema)                return fail("wrong-schema");
  if (a.nonce !== subject)                     return fail("wrong-subject");       // reuse
  if (a.revoked)                               return fail("revoked");
  if (Number(a.expiry) !== 0 && now > Number(a.expiry)) return fail("expired");
  if (want.issuer && a.signer !== want.issuer) return fail("unauthorized-issuer");
  return { ok: true as const, pda };

  function fail(reason: string) { return { ok: false as const, reason }; }
}
```

When the gate fails with `no-attestation`, route the user into the issuing flow (see [issuing.md](issuing.md), [proof-of-human.md](proof-of-human.md), or an external issuer like Civic) rather than denying — a real human without an attestation is a *conversion* problem, not an attacker.

## Composing with sybil-defense — graph-clean AND attested-human

The companion `../solana-sybil-defense` skill produces the *other* orthogonal gate: not-in-a-sybil-cluster (committed as a merkle root). The two cover each other's blind spots — funding-graph analysis misses sophisticated solo sybils; an attestation is hard to mass-produce. **Eligibility = `graph-clean` AND `attested-human`.**

```ts
// Off-chain eligibility = both gates. Mirror the on-chain program, which checks
// (merkle proof) AND (valid attestation) before it transfers.
export async function isEligible(wallet: Address, tree: MerkleTree, want: GateExpect) {
  const entry = tree.claimants.find(c => c.claimant === wallet); // sybil gate: in the tree?
  if (!entry) return { eligible: false, reason: "not-in-eligible-set" };

  const gate = await attestationGate(wallet, want);              // human gate
  if (!gate.ok) return { eligible: false, reason: gate.reason, action: "verify-humanity" };

  return { eligible: true, index: entry.index, amount: entry.amount, proof: entry.proof };
}
```

On-chain, the claim program runs both gates in one instruction — the merkle-proof check from `../solana-sybil-defense`'s [integration.md](../../solana-sybil-defense/skill/integration.md) plus `require_valid_attestation` above. Neither gate alone is sufficient; the merkle root is the distilled off-chain sybil analysis, the attestation is the human proof, and replay protection (`claim_status` PDA `init`) closes the third hole.

## Composing with payments — x402 / pay-then-gate

Same discipline applies to a paid resource. With x402 (HTTP 402 + on-chain settlement), the server gates the *resource* on a paid receipt; layer an attestation requirement on top when the resource is also identity-gated (e.g. "must be an attested human AND have paid").

- **402 challenge** carries both requirements: pay `X` to address `Y`, and present an attestation under credential/schema `Z` for the paying wallet.
- **Settlement**: verify the payment transaction (amount, recipient, finalized) *and* run `attestationGate(payer, want)` before releasing the resource. Bind the attestation subject to the *payer* — otherwise one attested wallet pays while a different wallet is gated (the subject-reuse hole).
- **Value path stays on-chain**: if the payment unlocks an on-chain action, the attestation check belongs in the same program, not only in the 402 handler. The 402 layer is the off-chain mirror; the program is the boundary.

The general shape is identical to the claim gate: an off-chain check for UX and routing, an on-chain check (or a verified on-chain settlement) for the actual security boundary. Don't let the payment layer become the only place humanity is checked.

## Test the gate — non-negotiable

A gate is exactly as good as its adversarial test suite. The bugs are never in the happy path; they're in *what you forgot to reject*. Use `../solana-testing` (LiteSVM / Mollusk for fast in-process program tests, the CI harness for the gate). The offline verifier [`tools/sas-verify/verify.mjs`](../tools/sas-verify/verify.mjs) and its proof [`examples/attestation-verify/`](../examples/attestation-verify/) already encode the minimum case matrix — port each case to your on-chain gate:

- **Valid attestation** → gate passes, action succeeds.
- **Spoofed account** (owner ≠ SAS program) → `NotSasOwned`. The single most important test; an integrator who skips the owner check passes every *other* check against an attacker-forged account.
- **Wrong credential authority** → `WrongCredential`. Construct an attestation under an attacker-controlled credential.
- **Wrong schema** → `WrongSchema`. A real bug class: checking "an attestation exists" without checking it's *the right one*. Build a valid attestation under a *different* schema and confirm rejection.
- **Wrong subject / reuse** → `WrongSubject`. Present wallet A's valid attestation while gating wallet B.
- **Revoked** → `Revoked`.
- **Expired** → `Expired`. And confirm `expiry == 0` (non-expiring) still passes when otherwise valid.
- **Unauthorized issuer** (if you pin one) → rejected.

Property-test the deserialize path against malformed account data — a panicking borsh `unwrap` on attacker-supplied bytes is a denial-of-service. The model is the same as `../solana-sybil-defense`'s CI verifier: assert, exit non-zero on regression. Run `node --test examples/attestation-verify/` as the local gate; wire the on-chain equivalents into your `../solana-testing` harness so a missing check fails CI, not production.

_Last verified: June 2026_
