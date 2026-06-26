# Compute-Unit Regression Benchmarking

A CU blowup is not a perf nit — it's a liveness bug. Instructions that creep past the per-ix CU budget (default 200k, max 1.4M) start failing in production, and an attacker who can push your CU near the ceiling has a cheap DoS. You want to catch the regression in the PR that introduced it, not in a post-deploy incident.

`mollusk-svm-bencher` runs your instructions against the [Mollusk](mollusk-unit.md) SVM harness, measures real CU consumption, and writes a markdown report that records each bench's CU **and the delta vs the previous run**. Commit that report. In CI, re-run the bencher and fail if the committed file changed (see [ci-harness.md](ci-harness.md)). The diff is the signal — a reviewer sees "+18,420 CU on `swap`" right in the PR.

## Setup

`Cargo.toml` — pin the version, declare the bench with `harness = false` (Criterion-style; you own `main`, not libtest):

```toml
[dev-dependencies]
mollusk-svm = "0.13.4"
mollusk-svm-bencher = "0.13.4"

[[bench]]
name = "compute_units"
harness = false
```

The benches live in `benches/compute_units.rs`. `harness = false` is mandatory: the bencher provides its own entrypoint and the default libtest harness would swallow it.

## The bench

```rust
use mollusk_svm::Mollusk;
use mollusk_svm_bencher::MolluskComputeUnitBencher;

MolluskComputeUnitBencher::new(Mollusk::new(&program_id, "my_program"))
    .bench(("create", &ix_create, &accounts))
    .bench(("close",  &ix_close,  &accounts))
    .must_pass(true)
    .out_dir("./target/benches")
    .execute();
```

Each `bench(...)` takes a tuple of `(name, &Instruction, &[(Pubkey, Account)])`. The name is the row key in the report — keep it stable across runs or the delta resets. `Mollusk::new(&program_id, "my_program")` loads the SBF object; the second arg is the file stem the harness searches for (e.g. `my_program.so`) under `SBF_OUT_DIR` or `tests/fixtures`, so run `cargo build-sbf` first.

A realistic `benches/compute_units.rs`:

```rust
use mollusk_svm::Mollusk;
use mollusk_svm_bencher::MolluskComputeUnitBencher;
use solana_sdk::{account::Account, instruction::Instruction, pubkey::Pubkey};

fn main() {
    let program_id = my_program::ID;
    let mollusk = Mollusk::new(&program_id, "my_program");

    // Build instructions + their account fixtures. Reuse helpers from your
    // unit tests so bench inputs match the real call shapes.
    let (ix_create, accounts) = setup_create(&program_id);
    let (ix_close, close_accs) = setup_close(&program_id);

    MolluskComputeUnitBencher::new(mollusk)
        .bench(("create", &ix_create, &accounts))
        .bench(("close",  &ix_close,  &close_accs))
        .must_pass(true)
        .out_dir("./target/benches")
        .execute();
}
```

Run it:

```bash
cargo build-sbf
cargo bench --bench compute_units
```

## `must_pass` and `out_dir`

- **`must_pass(true)`** — every benched instruction must execute *successfully* (no `ProgramError`, no panic). If any bench errors, the run exits non-zero. Without this, a bench that started reverting silently reports near-zero CU and looks like a *huge improvement* — a false green. Always set it true in CI; a failing bench is a broken bench, not a fast one.

- **`out_dir("./target/benches")`** — where the markdown report (`compute_units.md`) is written. Two conventions:
  - Write to `./target/benches` (gitignored) and treat the run as ephemeral — CI parses the deltas and fails on a threshold. Simpler, no committed artifact.
  - Write to a **committed** path (e.g. `./benches/results`) and `git diff --exit-code` it in CI. The report itself becomes the source of truth; the PR diff shows the CU change as a reviewable line. This is the recommended setup — the cost lands in code review where a human can judge whether +18k CU is acceptable.

The report carries a `Previous` and a `Delta` column populated from the file already at `out_dir`, so the *first* commit of the file establishes the baseline. Subsequent runs diff against it. To rebaseline intentionally (e.g. a known, reviewed cost increase), regenerate and commit the new file in the same PR.

## CI mechanism (committed-report variant)

```yaml
- run: cargo build-sbf
- run: cargo bench --bench compute_units
- name: Fail on unreviewed CU change
  run: git diff --exit-code benches/results/compute_units.md
```

If CU shifted, the working tree differs from the commit and `--exit-code` returns 1. The fix is deliberate: the author re-runs locally, eyeballs the delta, and commits the updated report — making every CU change an explicit, reviewed decision. Wire this as a stage in [ci-harness.md](ci-harness.md).

## Gotchas

- Bench the **same instruction shapes** your program actually receives. CU scales with account count, data length, and CPI depth — a toy fixture under-reports.
- Numbers vary slightly across `solana` / platform-tools versions. Pin the toolchain in CI (see [ci-harness.md](ci-harness.md)) or the baseline drifts on unrelated upgrades.
- Benchmark the *worst case* path (max iterations, full accounts), not the happy path — that's the branch that hits the CU ceiling first.
- Keep bench names append-only. Renaming `swap` to `swap_v2` orphans the baseline row and the delta silently resets to zero.

See also: [mollusk-unit.md](mollusk-unit.md) for the harness these benches run on, and [ci-harness.md](ci-harness.md) for wiring the regression gate.

_Last verified: June 2026_
