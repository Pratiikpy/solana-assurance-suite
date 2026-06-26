# EVAL_REPORT — solana-attestations

Evidence the verifier works. Run on this machine (Node 22). Output verbatim.

## 1. `examples/attestation-verify` — hardened verifier, every bypass rejected ✅ VERIFIED

The verification logic (`tools/sas-verify`) checks an attestation against what the integrator
requires: account **owner == SAS program**, credential authority, schema, subject, expiry,
revocation, and authorized issuer. The test constructs a valid proof-of-human attestation and
then every adversarial mutation.

**Command:** `node --test`

```
# tests 9
# pass 9
# fail 0
```

Cases (each asserts the exact rejection reason):

| Case | Result |
|------|--------|
| valid attestation | ✅ accepted |
| spoofed account (owner ≠ SAS program) | ❌ rejected — "owner is not the SAS program" |
| wrong credential authority | ❌ rejected |
| schema mismatch | ❌ rejected |
| subject reuse (attestation about another wallet) | ❌ rejected |
| revoked | ❌ rejected |
| expired | ❌ rejected |
| unauthorized issuer | ❌ rejected |
| non-expiring (expiry 0), otherwise valid | ✅ accepted |

**What this proves:** the #1 SAS footgun — trusting an account that *looks* like an attestation
but isn't owned by the SAS program — is caught, along with the full staleness/scope/authority
matrix. This is the security spine the per-wallet humanity APIs don't have.

## 2. Novelty & fit

- **Unclaimed flagship gap:** across the 501-tool Solana inventory (kit + published repos +
  solana-new + 47 PRs + local catalogs), **nothing owns SAS** — the closest items
  (`verify-humanity-poh`, Crossmint auth) are per-wallet APIs at a different layer. SAS is the
  Foundation's canonical attestation standard, so being the only skill for it is high-value.
- **Composes, doesn't compete:** proof-of-human is one schema instance; POH/Civic are upstream
  signals attested *into* SAS. `solana-sybil-defense` already defers its claim gate here
  (eligibility = graph-clean AND attested-human).
- **Cross-domain:** identity × security × payments (gate x402/claims on a credential).

## 3. Judging-criteria summary

| Criterion | Evidence |
|-----------|----------|
| **Usefulness** | On-chain credentials gate airdrops, KYC, allowlists, DAO roles, payments — and SAS is the canonical rail. |
| **Novelty** | Only skill for SAS in the entire inventory; the Foundation's own primitive. |
| **Quality** | Execution-verified hardened verifier (§1, 9/9) with the full bypass matrix; pinned to `sas-lib` + the SAS program id. |
| **Fit** | Reference-skill structure, MIT, extends solana-dev, composes with sybil-defense + testing. |
