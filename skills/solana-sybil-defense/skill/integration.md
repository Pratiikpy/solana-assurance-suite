# Integration — Wiring Detection into a Claim Flow (June 2026)

Detection and export produce a merkle root and an eligible set. This file connects them to a live claim/mint program, and layers a second, orthogonal gate — **proof-of-humanity via the Solana Attestation Service** — so eligibility becomes *not-in-a-sybil-cluster* **AND** *holds-a-valid-human-attestation*. The two gates cover each other's blind spots: funding-graph analysis still misses a truly-lone sybil that shares no funder, behavior, or timing with anyone (recall 0.985, see [scoring-and-thresholds.md](scoring-and-thresholds.md)); a human attestation is hard to mass-produce. Together they are far stronger than either alone.

## What gets enforced where

| Concern | Off-chain (claim UI / backend) | On-chain (claim program) |
|---|---|---|
| Sybil cluster exclusion | already baked into the **merkle root** — flagged wallets aren't in the tree | program verifies the merkle proof; no proof ⇒ no claim |
| Proof-of-humanity | UI shows the user their attestation status | program CPIs/reads SAS attestation PDA and rejects if absent/expired |
| Replay (double-claim) | — | `claim_status` PDA marks claimed; enforced on-chain |

**The merkle root is the sybil gate.** Because excluded wallets were never added to the tree (Step 1–3 in [eligibility-export.md](eligibility-export.md)), the on-chain program enforces sybil exclusion for free: a flagged wallet simply has no valid proof. You do **not** re-run clustering on-chain — that's off-chain analysis distilled into a 32-byte commitment.

## On-chain vs off-chain — the tradeoff

- **Off-chain only** (backend signs an eligibility voucher the program checks): cheapest, most flexible, but the backend is a trusted oracle and a censorship point. Fine for centralized distributions; weak for "trustless airdrop" claims.
- **Merkle proof on-chain** (jito/streamflow distributor): the eligible set is committed publicly and immutably; anyone verifies the root. This is the standard and what you should default to. Cost: one extra account + proof bytes per claim.
- **Full on-chain scoring**: infeasible and pointless. The signals (funding history, CEX labels, fingerprints) live off-chain; recomputing them in a program is impossible. Compute off-chain, **commit on-chain.**

Rule of thumb: **commit the decision, not the computation.** Merkle root for sybil exclusion, SAS attestation for humanity — both are cheap on-chain reads; the expensive analysis stays off-chain.

## The claim program — two gates

Anchor sketch. The program verifies the merkle proof (sybil gate) *and* requires a valid SAS attestation (human gate) before transferring.

```rust
use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;

#[derive(Accounts)]
#[instruction(index: u64, amount: u64, proof: Vec<[u8; 32]>)]
pub struct Claim<'info> {
    #[account(mut, seeds = [b"distributor", mint.key().as_ref()], bump)]
    pub distributor: Account<'info, Distributor>,   // holds merkle_root, mint, vault
    #[account(init, payer = claimant, space = 8 + 1,
        seeds = [b"claimed", distributor.key().as_ref(), claimant.key().as_ref()], bump)]
    pub claim_status: Account<'info, ClaimStatus>,  // init => replay protection (fails if exists)
    /// CHECK: SAS attestation PDA for (credential, schema, claimant). Validated below.
    pub attestation: UncheckedAccount<'info>,
    #[account(mut)] pub claimant: Signer<'info>,
    // ... vault, claimant_ata, token_program, system_program
}

pub fn claim(ctx: Context<Claim>, index: u64, amount: u64, proof: Vec<[u8; 32]>) -> Result<()> {
    let d = &ctx.accounts.distributor;
    let who = ctx.accounts.claimant.key();

    // --- GATE 1: sybil exclusion via merkle proof (flagged wallets aren't in the tree) ---
    // leaf = double-keccak(index || claimant || amount) — MUST match the export encoding
    let node = keccak::hashv(&[&index.to_le_bytes(), &who.to_bytes(), &amount.to_le_bytes()]).0;
    let mut cur = keccak::hash(&node).0;
    for p in proof.iter() {
        cur = if cur <= *p { keccak::hashv(&[&cur, p]).0 } else { keccak::hashv(&[p, &cur]).0 };
    }
    require!(cur == d.merkle_root, ClaimError::InvalidProof);

    // --- GATE 2: proof-of-humanity via SAS attestation ---
    require!(is_valid_attestation(&ctx.accounts.attestation, &d.credential, &d.schema, &who)?,
             ClaimError::NoHumanAttestation);

    // transfer `amount` from vault to claimant; claim_status init already blocks replay
    Ok(())
}
```

`is_valid_attestation` reads the SAS attestation account (owner = SAS program `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG`), checks it's the PDA for `(credential, schema, claimant)`, that the schema is your designated proof-of-human schema, and that it isn't expired (`expiry == 0 || expiry > clock.unix_timestamp`). See `../solana-attestations` for the SAS account layout and on-chain verification helper; deserialize defensively rather than trusting `UncheckedAccount`.

## Combining the gates off-chain (claim UI / eligibility service)

Mirror the on-chain logic off-chain so the UI never lets a user submit a doomed transaction. `eligible = inMerkleTree(wallet) && hasValidAttestation(wallet)`.

```ts
import { createSolanaRpc, address } from "@solana/kit";
import { fetchAttestation, deriveAttestationPda } from "sas-lib";   // SAS TS client

const SAS = address("22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG");
const rpc = createSolanaRpc(process.env.RPC_URL!);

async function hasValidHumanAttestation(wallet: string, credential: string, schema: string) {
  const [pda] = await deriveAttestationPda({ credential, schema, nonce: address(wallet) });
  try {
    const att = await fetchAttestation(rpc, pda);                  // throws if missing
    const exp = Number(att.data.expiry);
    return exp === 0 || exp > Math.floor(Date.now() / 1000);       // 0 = no expiry
  } catch { return false; }
}

export async function isEligible(wallet: string, tree: MerkleTree, cred: string, schema: string) {
  const entry = tree.claimants.find(c => c.claimant === wallet);   // sybil gate: in the tree?
  if (!entry) return { eligible: false, reason: "not-in-eligible-set" };
  if (!(await hasValidHumanAttestation(wallet, cred, schema)))     // human gate
    return { eligible: false, reason: "no-valid-attestation", action: "verify-humanity" };
  return { eligible: true, index: entry.index, amount: entry.amount, proof: entry.proof };
}
```

When the human gate fails, the UI should route the user into the attestation flow (`../solana-attestations` covers issuing a SAS proof-of-human credential — e.g. via Civic) rather than just denying. A real human without an attestation is a *conversion* problem, not a sybil; don't strand them.

## Order of operations at launch

1. Off-chain scan → eligible set + merkle tree + published methodology ([eligibility-export.md](eligibility-export.md)).
2. Deploy distributor, commit `merkle_root` + `credential`/`schema` pubkeys into the `Distributor` account.
3. Claim UI runs `isEligible` (both gates) and, on pass, builds the `claim` tx with the proof + attestation PDA.
4. Program enforces both gates + replay protection on-chain.
5. Helius webhook on the distributor monitors live claims for any cluster that slips through ([data-sources.md](data-sources.md)); flag for clawback/freeze policy if applicable.

## Test the claim gate — non-negotiable

A claim program is high-value and adversarial; test it like one. Use `../solana-testing` (LiteSVM / Mollusk for fast in-process tests, the CI harness for the gate). Minimum cases:

- **Valid claim** with correct proof + valid attestation → succeeds, balance transferred, `claim_status` created.
- **Double-claim** (same wallet twice) → second fails on `claim_status` init.
- **Forged proof / wrong amount** → `InvalidProof`. (Tamper one byte of `amount`; the leaf changes; proof must fail.)
- **Flagged wallet** (excluded from tree) → no valid proof exists → cannot claim. This is the sybil gate; assert it directly.
- **Missing / expired / wrong-schema attestation** → `NoHumanAttestation`. Construct an attestation under a *different* schema and confirm it's rejected — a common real bug is checking "an attestation exists" without checking it's *the right one*.
- **Property test the merkle verifier** against the off-chain builder in [eligibility-export.md](eligibility-export.md): random tree, random index, prove every leaf verifies and every tampered leaf fails. Encoding drift between exporter and verifier is the #1 way claims silently break.

See `../solana-testing` for the harness setup, fixtures, and the CI gate pattern (the [planted-cluster verify.mjs](../examples/planted-cluster/verify.mjs) is the model: assert, exit non-zero on regression).

_Last verified: June 2026_
