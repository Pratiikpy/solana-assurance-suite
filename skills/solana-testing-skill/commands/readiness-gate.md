---
description: Run the Mainnet-Readiness gate on a Solana program — generate the adversarial test surface from the IDL, then report whether the program is safe to deploy.
argument-hint: "[path to anchor IDL or program dir]"
---

# /readiness-gate

Answer the scariest pre-deploy question — *"is this program safe to ship, or will a bug
drain it?"* — with evidence, not vibes.

## Steps

1. **Locate the IDL.** Look for `target/idl/*.json` (run `anchor build` if missing). If the
   user passed a path, use it.
2. **Generate the adversarial surface:**
   ```bash
   node tools/soltest-gen/soltest-gen.mjs <idl.json> --out ./soltest-out
   ```
   This writes `tests/generated/*.test.ts`, a Trident invariant scaffold, a CI workflow,
   and `READINESS.md` (the coverage matrix + gate verdict).
3. **Read `READINESS.md` aloud to the user**: instruction count, negative tests + fuzz
   invariants scaffolded, and the high-severity (⚠️) value-moving instructions.
4. **Close the gate** — the verdict is 🔴 until all three hold; drive each:
   - generated tests pass → `cargo test-sbf` (fill fixtures first; see [test-generation.md](../skill/test-generation.md))
   - invariants hold → `trident fuzz run <target>` ([trident-fuzzing.md](../skill/trident-fuzzing.md))
   - guard branches covered → `/check-coverage` ([coverage.md](../skill/coverage.md))
5. **Report the verdict honestly.** If any leg is unmet, the program is **not** mainnet-ready
   — say so plainly and list exactly what's missing. Per [rules/rust-testing.md](../rules/rust-testing.md),
   never claim 🟢 without the passing output.

## Output

A short readiness summary: 🟢/🔴, the high-severity instructions, the specific untested or
uncovered fund-draining branches, and the next command to run. Link `READINESS.md`.
