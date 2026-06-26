# soltest-gen

Turn an Anchor IDL into a complete **adversarial** test suite + a **Mainnet-Readiness
report** — in one command, zero dependencies (Node ≥ 18).

```bash
node soltest-gen.mjs <program.idl.json> [--out DIR]
# e.g.
node soltest-gen.mjs target/idl/escrow.json --out ./soltest-out
```

Most test generators emit happy-path stubs. This one emits the tests that catch the bugs
that drain funds. For every instruction it derives, from the IDL, which fund-draining
classes apply and scaffolds the **negative** test for each:

| Derived from the IDL | Generated check |
|----------------------|-----------------|
| account with `signer: true` | missing-signer rejection test |
| writable, non-signer account | account-substitution (wrong-owner) test |
| instruction name is init-like | re-initialization test |
| integer arg (`u64`, `i64`, …) | arithmetic boundary test |
| value-moving instruction | Trident money-invariant scaffold |

It also writes a CI workflow and `READINESS.md` — a per-instruction × bug-class coverage
matrix with a gate verdict (🔴 until the generated tests pass + coverage confirms the
guard branches are reached).

## Verified output

Run against [`sample-escrow.idl.json`](sample-escrow.idl.json) (committed under
[`sample-output/`](sample-output/)):

```
soltest-gen: escrow
  instructions:        4
  negative tests:      16
  fuzz invariants:     2
  value-moving ix:     2 (deposit, withdraw)
  high-severity ix:    2
  files written:       7
```

It handles both the modern Anchor IDL (`writable`/`signer`) and the legacy ≤0.29 shape
(`isMut`/`isSigner`), and flattens composite account groups.

**Scales to real programs.** Against the live **Kamino Lending** IDL (51 instructions) it
generates **309 negative tests + 34 fuzz invariants = 343 adversarial checks** and flags all
34 value-moving instructions (borrow/liquidate/flashBorrow/socializeLoss/…) high-severity — a
trimmed sample is committed at [`sample-output-klend/`](sample-output-klend/).

## Why scaffolds, not full tests

The generator can't know your account data layout, so the bodies are `TODO` fixtures with
the correct structure (build the ix, flip the signer/owner, assert failure). You fill the
fixtures and run. The point is **coverage of the adversarial surface** — you never forget
the missing-signer test on a withdraw again. The runnable, *passing* proofs live in
[`../../examples/`](../../examples/).

## Invoke from the skill

The `solana-testing` skill routes here via `/scaffold-tests` and `/readiness-gate`, and
documents the methodology in [`../../skill/test-generation.md`](../../skill/test-generation.md).

_Last verified: June 2026 — Node 20._
