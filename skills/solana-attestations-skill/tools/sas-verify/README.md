# sas-verify

The hardened verification logic for a Solana Attestation Service (SAS) attestation, as
pure testable code. Zero dependencies (Node ≥ 18).

```bash
node verify.mjs <attestation.json> <expected.json> [--now <unix>]
```

`verifyAttestation(att, expected, nowUnix)` returns `{ valid, reasons }` after checking, in
order: the account **owner is the SAS program**, the **credential authority** matches, the
**schema** matches, the **subject** binds (no reuse), the attestation is **not revoked**,
**not expired**, and the **issuer** is authorized. It is the model of the on-chain/off-chain
verify path documented in [`../../skill/verification.md`](../../skill/verification.md); wire
it to a real fetched account (`sas-lib`) or an on-chain deserialize.

## Why it exists

The dangerous part of SAS isn't issuing — it's verifying without being fooled. The single
biggest footgun is trusting an account that *looks* like an attestation but **isn't owned by
the SAS program**. This module makes that check (and the full staleness/scope/authority
matrix) impossible to forget. The bypass catalogue is in
[`../../skill/hardened-verifier.md`](../../skill/hardened-verifier.md).

## Verified

[`../../examples/attestation-verify`](../../examples/attestation-verify) runs a valid
attestation plus 7 bypass attempts: **9/9 pass**. Output in
[`../../EVAL_REPORT.md`](../../EVAL_REPORT.md).

_Last verified: June 2026 — Node 22._
