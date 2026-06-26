# solana-attestations-skill

**On-chain credentials on Solana — issued and *verified safely*.**

> **Extends**: [solana-dev-skill](https://github.com/solana-foundation/solana-dev-skill). Composes with `solana-sybil-defense` (graph-clean **and** attested) and `solana-testing` (test the verifier gate).

A progressively-loaded skill for Claude Code / Codex for the **Solana Attestation Service (SAS)** — the Foundation's canonical credential primitive. Register a credential authority, define typed schemas, issue on-chain attestations (with expiry + revocation), and — the part that gets people hacked — **verify them safely**, off-chain (`sas-lib`) and on-chain.

## The problem

On-chain credentials gate airdrops, KYC, allowlists, DAO roles, and gated payments. SAS shipped (mainnet 2025) as the standard rail — but across the **501-tool Solana skill inventory** (kit + every published skill repo + solana-new + the 47 bounty PRs + community catalogs), **nothing owns SAS as a skill.** The nearest tools (`verify-humanity-poh`, Crossmint auth) are per-wallet "is-this-a-human?" APIs at a different layer — no issuer, schema, revocation, expiry, or on-chain verification. And the dangerous part isn't issuing an attestation; it's verifying one without being fooled by a spoofed, expired, revoked, or wrong-subject record.

## What's included

| Component | Contents |
|-----------|----------|
| **Tool** (`tools/sas-verify`) | Zero-dep hardened verifier: owner-is-SAS, credential, schema, subject, expiry, revocation, issuer. **Verified runnable.** |
| **Skill** (`skill/`) | `SKILL.md` router + 8 references: overview, credentials-and-schemas, issuing, verification, hardened-verifier, proof-of-human, integration, resources |
| **Agents** (`agents/`) | `attestation-engineer` (issue + build verifiers), `verifier-reviewer` (audit for bypasses) |
| **Commands** (`commands/`) | `/issue-attestation`, `/verify-attestation`, `/gate-with-attestation` |
| **Rules** (`rules/`) | `attestation-safety.md` — always check owner == SAS program; verify don't assume |
| **Example** (`examples/attestation-verify`) | Valid attestation + 7 bypass attempts; **9/9 tests pass** |

## SAS in one model

```
CREDENTIAL (authority + authorized signers)
   └── SCHEMA (typed layout of what's asserted)
          └── ATTESTATION (on-chain PDA about a SUBJECT; expiry; revocable)
```
Proof-of-human is **one** schema instance — POH/Civic verdicts are upstream signals you *attest into* SAS; downstream code trusts the on-chain attestation, not a live API call.

## Verify safely (the load-bearing part)

```bash
cd examples/attestation-verify && node --test   # 9/9 pass
```
A valid attestation is accepted; **every** bypass is rejected: spoofed account owner, wrong credential authority, schema mismatch, subject reuse, revoked, expired, unauthorized issuer. The #1 footgun — trusting an account that *looks* like an attestation but isn't owned by the SAS program — is caught. Full output in [EVAL_REPORT.md](EVAL_REPORT.md).

## Installation

```bash
./install.sh          # ~/.claude/skills, clones core skill if missing
./install-custom.sh   # choose location; optionally copy agents/commands/rules
```

## Composition

```
airdrop/claim eligibility = NOT in a sybil cluster   (solana-sybil-defense)
                          AND holds a valid SAS proof-of-human attestation   (this skill)
```
The sybil-defense skill already defers its proof-of-human gate to this skill; test the on-chain gate with solana-testing.

## License

MIT — see [LICENSE](LICENSE). Built for the [Solana AI Kit](https://github.com/solanabr/solana-ai-kit) bounty.
