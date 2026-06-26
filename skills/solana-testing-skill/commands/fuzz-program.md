---
description: Set up Trident fuzzing for the program — install the CLI, trident init, derive fuzz targets from the IDL, scaffold flows plus the core money invariants as assert!s, and give the smoke + full run commands. Trident bundles TridentSVM (no honggfuzz).
argument-hint: "[program crate, defaults to detected]"
---

Stand up Trident fuzzing for the program at `$ARGUMENTS` (or the detected program). Follow `skill/trident-fuzzing.md` and `skill/invariant-testing.md`, and use the `fuzz-engineer` conventions.

## 1. Install and init
```
cargo install trident-cli        # Trident 0.12 / 0.13-rc
trident init                     # scaffolds trident-tests/ from the program IDL
```
Trident 0.12+ bundles **TridentSVM** as the execution backend. Do NOT install or configure honggfuzz/AFL — that path is deprecated. If an old honggfuzz harness exists, migrate it.

## 2. Derive fuzz targets from the IDL
- `trident init` generates instruction account/data structs from the IDL. Confirm every instruction is represented; regenerate if the IDL changed (`anchor build` first for Anchor).
- Do not hand-write instruction builders that can drift from the on-chain interface.

## 3. Scaffold flows
In the generated fuzz target, write flows that exercise realistic, ordered AND randomized instruction sequences over shared account state — e.g. `init -> deposit -> withdraw -> close`, plus interleaved transfers across two accounts. The goal is state transitions, not isolated single calls.

## 4. Encode the core money invariants as `assert!`s
Check after each meaningful step (or at flow end). At minimum:
- **Conservation of value** — `assert!` total balance across token accounts + vault + fees is unchanged by non-mint/non-burn ops.
- **No unauthorized mint** — supply changes only via the authorized mint path and authority.
- **Authority integrity** — admin/authority/owner state changes only through the intended instruction with the correct signer.
- **No overflow/underflow** — checked arithmetic on balances, supply, counters; treat a wrap or arithmetic panic as a crash.
Name the property in each assert message so a failure is self-describing.

## 5. Run commands
```
# smoke fuzz — bounded, for CI on every PR
trident fuzz run <target> --iterations 50000        # or a short wall-clock bound

# full fuzz — nightly / long-running deep exploration
trident fuzz run <target>                            # unbounded / time-boxed nightly

# replay/minimize a crashing input
trident fuzz debug <target> <crash-file>
```
Run the smoke fuzz now and paste real output.

## 6. On a crash
Minimize the input, write a failing reproduction test (LiteSVM for multi-instruction, Mollusk for single — see `skill/litesvm-integration.md`, `skill/mollusk-unit.md`), and propose the program fix with root cause + the invariant violated. Map it to a class in `skill/bug-class-playbook.md`.

## 7. Report
Harness files (absolute paths), invariants encoded, smoke/full commands with bounds, and the smoke run output.
