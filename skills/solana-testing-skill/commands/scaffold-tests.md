---
description: Detect the program type (Anchor or native) and generate a Mollusk + LiteSVM test skeleton with success AND negative tests (missing-signer, wrong-owner, reinit) stubbed for every instruction. Outputs the files plus the exact commands to run them.
argument-hint: "[path to program crate, defaults to detected program]"
---

Scaffold a test suite for the program at `$ARGUMENTS` (or the program detected in the current workspace). Use the `test-author` conventions and the stack in `skill/mollusk-unit.md`, `skill/litesvm-integration.md`, and `rules/rust-testing.md`.

## 1. Detect the program type
- Look for `anchor.toml` and `Anchor.toml` -> **Anchor**. Read `declare_id!`, the program name, and the IDL under `target/idl/*.json` if present.
- Else look for `Cargo.toml` with `solana-program` / `entrypoint!` -> **native**.
- Enumerate the instructions: from the Anchor IDL (`instructions[]`) if Anchor, else from the instruction enum / processor `match` arms in the program source. List them before scaffolding.

## 2. Generate the Mollusk unit skeleton (`tests/unit/`)
For each instruction, emit one success test and the negative stubs:
- Use `mollusk-svm` 0.13.4 with modular `solana-*` crates (NOT the `solana-sdk` monolith).
- Fixed program ID + seeded keypairs for determinism.
- Success: build the instruction + accounts, run `mollusk.process_and_validate_instruction`, assert concrete resulting account state (not just success).
- Negative stubs (mark `// TODO: tighten assertion` only on the setup, never on the error check):
  - **missing-signer** — drop `is_signer` on the required authority; assert the specific error.
  - **wrong-owner** — pass an account owned by the wrong program; assert the specific error.
  - **reinit** — run init twice; assert the second call fails with the program's already-initialized error.
Each negative test must pin the exact error code/discriminant — `ProgramError::Custom(n)` or the Anchor error — never a bare "it failed".

## 3. Generate the LiteSVM integration skeleton (`tests/integration/`)
- Use `litesvm` 0.13. Load the built `.so`, set a controlled clock/slot.
- One happy-path flow that chains the program's real instruction sequence and asserts cross-call state + lamport deltas.
- Stub one multi-step negative (e.g. withdraw-before-deposit or unauthorized-close) with a specific-error assertion.

## 4. Wire up and output the run commands
Emit exactly what to run, e.g.:
```
# build BPF + run unit tests against the compiled program
cargo test-sbf
# host-side mollusk unit tests (if split out)
cargo test --test unit
# litesvm integration
cargo test --test integration
```
For Anchor, also note `anchor build` to refresh the IDL before scaffolding.

## 5. Report
List every file written (absolute paths), the instructions covered, and which negative cases were stubbed per instruction. Do NOT claim the suite passes — the stubs are intentionally incomplete; hand off to `test-author` to fill assertions and run them.
