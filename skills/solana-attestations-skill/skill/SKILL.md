---
name: solana-attestations
description: The Solana Attestation Service (SAS) credential primitive, end to end — register a credential authority, define typed schemas, issue on-chain attestation PDAs about a subject (with expiry + revocation), and verify them safely both off-chain (sas-lib) and on-chain (deserialize the SAS-owned account; check owner, credential, schema, subject, expiry, revocation). Proof-of-human is one schema instance, not the whole skill. Extends solana-dev-skill; composes with solana-sybil-defense (eligibility = graph-clean AND attested-human) and solana-testing (test the verifier gate). Ships a runnable hardened verifier with adversarial tests.
user-invocable: true
---

# Solana Attestations — the SAS Credential Primitive, Verified

> **Extends**: [solana-dev-skill](../solana-dev/SKILL.md). Composes with [solana-sybil-defense](../solana-sybil-defense/SKILL.md) (its claim gate defers proof-of-human to this skill) and [solana-testing](../solana-testing/SKILL.md) (test the on-chain verifier). Data/client via `@solana/kit`.

On-chain credentials are how you answer "is this wallet allowed?" without a centralized database — KYC status, proof-of-human, allowlist membership, DAO role, reputation. EVM has EAS + Verax as a whole tooling layer; Solana now has the **Solana Attestation Service (SAS)** — the Foundation's canonical primitive (mainnet 2025, `sas-lib`) — and **nothing in the kit, the 47 PRs, or the 501-tool ecosystem owns it as a skill.** The per-wallet "is-this-a-human?" APIs are just *one possible signal*; this skill owns the durable credential lifecycle they should be attested into, and — critically — the **hardened verification** that stops a spoofed or stale attestation from waving an attacker through.

## What This Skill Is For

### Understand & author
- What SAS is, the credential→schema→attestation model, vs per-wallet APIs → [sas-overview.md](sas-overview.md)
- Register a credential authority + define typed schemas → [credentials-and-schemas.md](credentials-and-schemas.md)

### Issue
- Issue attestation PDAs, expiry, batch, revocation → [issuing.md](issuing.md)

### Verify (the part that gets people hacked)
- Off-chain (`sas-lib`) + on-chain verification paths → [verification.md](verification.md)
- The hardened-verifier checklist (every way a naive verify is fooled) → [hardened-verifier.md](hardened-verifier.md)

### Apply
- Proof-of-human as one worked schema; compose with sybil-defense → [proof-of-human.md](proof-of-human.md)
- Gate a claim/payment/access flow on an attestation → [integration.md](integration.md)
- Pinned versions/IDs/docs → [resources.md](resources.md)

### Delegate
- Writing the gated program/client → solana-dev · Testing the gate → [solana-testing](../solana-testing/SKILL.md) · Cluster-level sybil detection → [solana-sybil-defense](../solana-sybil-defense/SKILL.md)

## Default Approach (Opinionated)

1. **Verify, don't assume.** An attestation is just account data until you check it. The #1 footgun is trusting an account whose **owner isn't the SAS program**. Always run the [hardened-verifier.md](hardened-verifier.md) checklist.
2. **SAS is the credential; off-chain checks are signals.** Attest a Civic/Proof-of-Human verdict *into* SAS; downstream code trusts the on-chain attestation, not a live API call.
3. **Bind subject, honor expiry + revocation.** An attestation about wallet A must not authorize wallet B; an expired/revoked one must fail closed.
4. **Pin the credential authority + schema.** Match exact, not "any attestation that looks right."

## Operating Procedure

### 1. Model the claim
Decide the credential authority (who vouches) and the schema (what's asserted). [credentials-and-schemas.md](credentials-and-schemas.md).

### 2. Issue
Authorized signer issues an attestation PDA to the subject, with an expiry policy. [issuing.md](issuing.md).

### 3. Verify (the load-bearing step)
Off-chain with `sas-lib` for UX gating, **on-chain** for trustless enforcement — both run the full checklist (owner == SAS program, credential, schema, subject, expiry, revocation, issuer). [verification.md](verification.md), [hardened-verifier.md](hardened-verifier.md).

### 4. Gate
Wire the verified attestation into the claim/payment/access path; combine with sybil-defense for airdrops. [integration.md](integration.md).

### Pick the right agent
| Task | Agent | Model |
|------|-------|-------|
| Register/issue/build verifiers | **attestation-engineer** | sonnet |
| Audit a verifier for bypasses | **verifier-reviewer** | opus |

---

## Progressive Disclosure (Read When Needed)

### Author & issue
- [sas-overview.md](sas-overview.md) — model, when to use, vs per-wallet APIs
- [credentials-and-schemas.md](credentials-and-schemas.md) — authority + schema
- [issuing.md](issuing.md) — issue, expiry, revocation

### Verify & apply
- [verification.md](verification.md) — off-chain + on-chain verify
- [hardened-verifier.md](hardened-verifier.md) — the bypass checklist (security spine)
- [proof-of-human.md](proof-of-human.md) — worked example + sybil-defense composition
- [integration.md](integration.md) — gate a claim/payment/access flow
- [resources.md](resources.md) — pinned IDs, sas-lib, docs

### Companion skills
- [solana-sybil-defense](../solana-sybil-defense/SKILL.md) — graph-clean AND attested
- [solana-testing](../solana-testing/SKILL.md) — test the verifier gate

---

## Task Routing Guide

| User asks about... | Primary file(s) |
|--------------------|-----------------|
| what is SAS / attestations on Solana | sas-overview.md |
| create a credential / schema | credentials-and-schemas.md |
| issue / revoke an attestation | issuing.md |
| verify an attestation safely | verification.md, hardened-verifier.md |
| "is my verifier secure" | hardened-verifier.md |
| proof-of-human / KYC credential | proof-of-human.md |
| gate a claim/payment on a credential | integration.md → solana-sybil-defense |
| **detect the sybil farm** | solana-sybil-defense |
| **test the on-chain gate** | solana-testing |

---

## Commands

| Command | Description |
|---------|-------------|
| `/issue-attestation` | Register credential+schema if needed, then issue an attestation PDA to a subject (optional expiry) |
| `/verify-attestation` | Off-chain (`sas-lib`) + on-chain verification, running the hardened checklist |
| `/gate-with-attestation` | Wire an attestation requirement into a claim/payment/access path (composes with sybil-defense) |

## Agents

| Agent | Purpose |
|-------|---------|
| **attestation-engineer** | Registers credentials/schemas, issues attestations, builds verifiers — never trusts an account without the full check |
| **verifier-reviewer** | Audits a verifier against the hardened checklist; emits a ship verdict |

## Tool & proof

`tools/sas-verify/` is the runnable hardened verifier. `examples/attestation-verify/` is the
**verified proof**: a valid attestation passes, and every bypass attempt — spoofed owner,
wrong credential, schema mismatch, subject reuse, revoked, expired, unauthorized issuer — is
rejected (**9/9 tests pass**). See [examples/attestation-verify](../examples/attestation-verify)
and [EVAL_REPORT.md](../EVAL_REPORT.md).
