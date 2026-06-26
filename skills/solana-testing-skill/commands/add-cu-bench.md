---
description: Add a mollusk-svm-bencher compute-unit benchmark as a harness=false [[bench]], wire must_pass(true) + out_dir, commit the generated markdown report, and add the CI step that diffs CU deltas to catch regressions.
argument-hint: "[instruction(s) to benchmark, defaults to all]"
---

Add a CU benchmark for `$ARGUMENTS` (or every instruction) using `mollusk-svm-bencher`. See `skill/mollusk-unit.md`.

## 1. Dependency + bench target
Add to the program crate `Cargo.toml`:
```toml
[dev-dependencies]
mollusk-svm = "0.13.4"
mollusk-svm-bencher = "0.13.4"

[[bench]]
name = "compute_units"
harness = false
```

## 2. Write benches/compute_units.rs
Use `MolluskComputeUnitBencher` with the same fixed program ID + seeded accounts as the unit tests (determinism — same input, same CU every run):
```rust
use mollusk_svm::Mollusk;
use mollusk_svm_bencher::MolluskComputeUnitBencher;

fn main() {
    let mollusk = Mollusk::new(&PROGRAM_ID, "target/deploy/my_program");
    MolluskComputeUnitBencher::new(mollusk)
        .bench(("initialize", &ix_initialize(), &accounts_initialize()))
        .bench(("deposit",    &ix_deposit(),    &accounts_deposit()))
        // one bench per instruction under test
        .must_pass(true)                       // fail the bench if any ix errors
        .out_dir("benches/compute_units")      // markdown report lands here
        .execute();
}
```
`must_pass(true)` guarantees a failing instruction fails the bench instead of silently reporting garbage CU. `out_dir` is where the generated report is written.

## 3. Run and commit the report
```
cargo bench --bench compute_units
```
This writes `benches/compute_units/compute_units.md` (current run + delta vs the previous committed report). Commit the markdown so the baseline is version-controlled and deltas are reviewable in PRs.

## 4. CI step to catch regressions
Add a job that runs the bench and fails if CUs regressed. Example (GitHub Actions):
```yaml
  cu-bench:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: cargo bench --bench compute_units
      - name: Detect CU regression
        run: |
          # bencher writes the delta column; fail if any instruction got more expensive
          git diff --exit-code benches/compute_units/compute_units.md \
            || { echo "::error::CU report changed — review compute-unit deltas"; exit 1; }
```
The committed report is the baseline; the diff surfaces the per-instruction CU delta so a regression blocks the PR. Tune to fail only on increases if churn is noisy.

## 5. Report
Files written/edited (absolute paths), instructions benched, the run output, and the committed report path.
