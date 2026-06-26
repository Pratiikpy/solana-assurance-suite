# bridge-guards — the checks the hacked bridges skipped, as tested code

The verification logic every cross-chain integrator needs, as pure, dependency-free
functions with a passing test suite. Each guard maps to a real bridge hack.

| Guard | Prevents | Hack it echoes |
|-------|----------|----------------|
| `makeEmitterAllowlist` | consuming a message from an unknown source | forged-message mints |
| `makeReplayGuard` | processing the same attestation twice | Nomad (~$190M) replay |
| `trimToWire` / `untrimFromWire` | silent decimal mismatch across chains | 1000× mis-credit bugs |
| `resolveCctpRoute` | sending to the wrong/identical CCTP domain | unrecoverable burns |
| `finalityMet` | minting before source finality | reorg double-spend |

## Run it

```bash
node --test
```

## Verified output (June 2026, Node 20)

```
1..6
# tests 6
# pass 6
# fail 0
```

The decimal test is the one to read: it sends `1.000000009` of a 9-decimal token across an
8-decimal wire to a 6-decimal chain, asserts the recipient is credited exactly `1.000000`,
the `9` of dust stays on the source, and value is conserved — then asserts that naively
copying the raw amount would have mis-credited by 1000×.

Wire these guards into your consume path; see [../../skill/bridge-security.md](../../skill/bridge-security.md)
for the full checklist and [../../skill/testing-bridges.md](../../skill/testing-bridges.md) for
testing them against real VAAs.

_Last verified: June 2026._
