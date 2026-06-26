# Automated Test Generation & the Mainnet-Readiness Gate

Writing the full adversarial suite by hand is where coverage dies — someone always forgets
the missing-signer test on the one withdraw that gets drained. `tools/soltest-gen` removes
that failure mode: point it at an Anchor IDL and it scaffolds the **negative** test for
every fund-draining class that applies, plus a fuzz invariant scaffold, a CI workflow, and
a readiness report.

```bash
node tools/soltest-gen/soltest-gen.mjs target/idl/<program>.json --out ./soltest-out
```

## What it derives from the IDL

| IDL signal | Bug class | Generated check | Owning layer |
|------------|-----------|-----------------|--------------|
| `signer: true` account | missing-signer | reject when account doesn't sign | [mollusk-unit.md](mollusk-unit.md) |
| writable, non-signer account | account substitution | reject wrong-owner look-alike | [litesvm-integration.md](litesvm-integration.md) |
| init-like instruction name | re-initialization | reject/idempotent 2nd init | [litesvm-integration.md](litesvm-integration.md) |
| integer arg | overflow/underflow | boundary at `MAX`/`0`/`bal+1` | [mollusk-unit.md](mollusk-unit.md) |
| value-moving instruction | conservation | money invariant `assert!` | [invariant-testing.md](invariant-testing.md) |

It normalizes both the modern Anchor IDL (`writable`/`signer`) and the legacy ≤0.29 shape
(`isMut`/`isSigner`), and flattens composite account groups. Mapping rationale lives in
[bug-class-playbook.md](bug-class-playbook.md).

## The Mainnet-Readiness Gate

`READINESS.md` is the artifact: a per-instruction × bug-class matrix, a high-severity flag
on value-moving instructions with signer/owner/init risk, and a gate verdict. The gate is
**🔴 PENDING by design** until the loop closes — scaffolding is not passing:

1. every generated test passes → `cargo test-sbf`
2. fuzz invariants hold → `trident fuzz run` ([trident-fuzzing.md](trident-fuzzing.md))
3. branch coverage confirms each guard line is reached → [coverage.md](coverage.md)

Only then does it go 🟢. The score grades the **adversarial surface**, not vibes — it is
honest about the gap between "I wrote tests" and "the dangerous branches are proven safe."

## Workflow

1. `/scaffold-tests` → run the generator, get `tests/generated/*.test.ts` + `READINESS.md`.
2. Fill the TODO fixtures (program load + account data); the structure is already correct.
3. `/fuzz-program` → wire the invariant scaffold into a Trident target.
4. `/check-coverage` → confirm the guard branches are reached; close the gate.

The generator is the breadth pass; the [testing-pyramid.md](testing-pyramid.md) is the
depth. Worked, *passing* proofs: [../examples/vault-poc](../examples/vault-poc) and
[../examples/invariant-poc](../examples/invariant-poc).

_Last verified: June 2026._
