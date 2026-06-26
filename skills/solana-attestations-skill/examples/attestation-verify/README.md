# attestation-verify — the verifier, against every bypass

A self-checking proof. `verify.test.mjs` constructs a valid SAS proof-of-human attestation,
then mutates it into each known bypass and asserts the verifier's verdict — with a fixed
clock so it's deterministic.

## Run

```bash
node --test
```

## Verified output (Node 22)

```
# tests 9
# pass 9
# fail 0
```

| Case | Expected |
|------|----------|
| valid attestation | ✅ accepted |
| spoofed account (owner ≠ SAS program) | ❌ rejected |
| wrong credential authority | ❌ rejected |
| schema mismatch | ❌ rejected |
| subject reuse | ❌ rejected |
| revoked | ❌ rejected |
| expired | ❌ rejected |
| unauthorized issuer | ❌ rejected |
| non-expiring (expiry 0), otherwise valid | ✅ accepted |

The spoofed-owner case is the one to read: a naive verifier that trusts account data without
checking `owner == SAS program` waves an attacker-forged account straight through. See
[../../skill/hardened-verifier.md](../../skill/hardened-verifier.md).

_Last verified: June 2026 — Node 22._
