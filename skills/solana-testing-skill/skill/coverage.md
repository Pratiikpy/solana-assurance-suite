# SBF Code Coverage

## The #1 misconception

**`cargo-llvm-cov` and `cargo tarpaulin` do not work on Solana programs.** People try, get either a build error or a misleading 0% / 100%, and assume coverage is broken. It isn't broken — it's the wrong tool.

Both rely on LLVM source-based instrumentation: the compiler injects counters into a **host** binary, you run that binary natively, and a profiler reads the counters back. A Solana program is not a host binary. It compiles to **SBF** (Solana Bytecode Format), a custom eBPF-derived VM target. There is no native executable to instrument and no host process to attach a profiler to — the code runs inside the SVM interpreter. The LLVM instrumentation pass has nothing to hook into, so the standard coverage toolchain simply cannot attach. This is a target-architecture limitation, not a config problem; no amount of flags fixes it.

## What actually works: DWARF-based trace mapping

The working approach abandons compiler-injected counters and instead reconstructs coverage **after the fact** from execution traces:

1. Build the program with debug info (DWARF line tables) retained.
2. Run your tests under an SVM harness ([litesvm](litesvm-integration.md) `>= 0.9` or [mollusk](mollusk-unit.md) `>= 0.8`) that emits a per-instruction **execution / register trace** — which bytecode addresses executed.
3. A coverage tool maps each executed bytecode address back to a source line via the DWARF line table, then emits standard `lcov.info` / HTML reports.

You read those reports like any lcov output. The mapping is the whole trick: trace → DWARF → source line.

### Tools

- **`sbpf-coverage`** (LimeChain) — ingests register/execution traces from litesvm or mollusk and maps them to source lines. Use this for raw-Rust / Pinocchio / native programs and any test suite already built on litesvm or mollusk.
- **`anchor-coverage`** (Trail of Bits) — wraps `anchor test` with the same DWARF-trace mechanism so you get coverage over an Anchor program's existing TS/Rust test flow without rewriting tests.

**Honesty flag:** exact current versions of these two tools are not reliably registry-pinned (they move via git/GitHub releases rather than stable crates.io semver). Pin to a specific git commit/tag in CI rather than a crates.io version range, and re-verify the SVM-harness minimums (litesvm `>= 0.9`, mollusk `>= 0.8`) when you bump them. Treat the version numbers here as a floor, not a lockfile.

## Workflow (high level)

```bash
# Native/litesvm/mollusk program
cargo build-sbf                       # debug info retained
sbpf-coverage -- cargo test           # runs tests, collects traces, emits lcov + html
#   -> target/coverage/lcov.info  +  target/coverage/html/index.html

# Anchor program
anchor-coverage                       # wraps `anchor test`, same DWARF mapping
#   -> coverage report from the existing anchor test suite
```

Feed the resulting `lcov.info` into the coverage-floor gate in [ci-harness.md](ci-harness.md).

## Use coverage to confirm reach, not as a vanity metric

A high coverage % is worthless on its own — it tells you lines *ran*, not that they ran with adversarial inputs. The point of coverage on a Solana program is one specific question:

> **Did the fuzz and unit layers actually execute the risky branch — the vulnerable code path?**

You have unit tests (mollusk/litesvm) and fuzzing (see [invariant-testing.md](invariant-testing.md) and trident). Coverage is the *cross-check* that those layers reach the code that matters: the unchecked-math branch, the missing-signer path, the close-account / realloc edge, the CPI guard. If coverage shows your fuzzer never enters the liquidation branch, your fuzzing is theater regardless of iteration count. Read the report branch-first, not percent-first: open the html, find the dangerous functions, confirm they're green. Chasing 100% by covering trivial getters is how teams ship a "well-tested" program with an untested exploit path.

## Host-side logic uses `cargo-llvm-cov` normally

The SBF limitation only applies to code compiled to the SBF target. **Pure host-side logic — the math, state transitions, and invariant checks you extracted into plain Rust functions per [invariant-testing.md](invariant-testing.md) — compiles to a normal host binary and works with `cargo-llvm-cov` (or tarpaulin) the standard way:**

```bash
cargo llvm-cov --lib --html        # full source-based coverage on the extracted logic crate
```

This is a strong argument for the extraction pattern in [invariant-testing.md](invariant-testing.md): the more invariant logic you pull out of the on-chain entrypoint into a host-testable module, the more of your critical code you can cover with fast, precise, source-based instrumentation — and the thinner the SBF-only layer that needs the slower DWARF-trace approach. Split your coverage strategy accordingly: `cargo-llvm-cov` for the extracted logic crate, `sbpf-coverage` / `anchor-coverage` for the on-chain entrypoint and CPI glue.

See also: [ci-harness.md](ci-harness.md) for enforcing a coverage floor, and [invariant-testing.md](invariant-testing.md) for the host-extraction pattern that makes most of your logic llvm-cov-able.

_Last verified: June 2026_
