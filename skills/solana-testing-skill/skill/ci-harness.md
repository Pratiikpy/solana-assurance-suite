# CI Harness — Fail the PR When Something Is Untested

The job of CI here is not to "run tests" — it's to **block merge** when a change is untested, slower, or under-covered. Every stage below is a gate: it exits non-zero and the PR goes red. Treat green CI as the contract that the program is as safe as your test layers can prove.

## Stages

1. **build** — `cargo build-sbf` produces the `.so`. Everything downstream needs it.
2. **unit + integration** — `cargo test-sbf` (on-chain harness tests) and `cargo test` (host-side logic).
3. **CU bench regression** — run the bencher, fail on an unreviewed CU delta. See [cu-benchmarking.md](cu-benchmarking.md).
4. **fuzz smoke** — short `trident fuzz run` (low iterations) as a fast PR gate; full fuzz runs nightly via `schedule:`. See [trident-fuzzing.md](trident-fuzzing.md).
5. **coverage floor** — `sbpf-coverage`, fail under threshold. See [coverage.md](coverage.md).
6. **TS tests** — only if a JS/TS client/test suite exists.

The slow, networked **mainnet-fork E2E (Surfpool)** is deliberately **not** in this file — it belongs in a separate, optional job (see below).

## `.github/workflows/test.yml`

```yaml
name: test
on:
  pull_request:
  push:
    branches: [main]
  schedule:
    - cron: "0 6 * * *"   # nightly full fuzz

env:
  SOLANA_VERSION: "2.1.0"
  RUST_TOOLCHAIN: "1.79.0"

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: dtolnay/rust-toolchain@stable
        with:
          toolchain: ${{ env.RUST_TOOLCHAIN }}
          components: llvm-tools-preview

      # Cache cargo registry + git + build artifacts
      - uses: actions/cache@v4
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            target
          key: cargo-${{ runner.os }}-${{ hashFiles('**/Cargo.lock') }}
          restore-keys: cargo-${{ runner.os }}-

      # Cache the Solana platform-tools / CLI install (slow to fetch)
      - uses: actions/cache@v4
        id: solana-cache
        with:
          path: ~/.local/share/solana/install
          key: solana-${{ env.SOLANA_VERSION }}

      - name: Install Solana CLI
        if: steps.solana-cache.outputs.cache-hit != 'true'
        run: sh -c "$(curl -sSfL https://release.anza.xyz/v${SOLANA_VERSION}/install)"

      - name: Add Solana to PATH
        run: echo "$HOME/.local/share/solana/install/active_release/bin" >> "$GITHUB_PATH"

      # (1) build
      - name: Build SBF
        run: cargo build-sbf

      # (2) unit + integration
      - name: Test (on-chain)
        run: cargo test-sbf
      - name: Test (host logic)
        run: cargo test --lib

      # (3) CU bench regression — committed report diffed against HEAD
      - name: CU benchmark
        run: cargo bench --bench compute_units
      - name: Fail on unreviewed CU change
        run: git diff --exit-code benches/results/compute_units.md

      # (4) fuzz smoke — fast gate on every PR; nightly runs the full budget
      - name: Fuzz smoke
        if: github.event_name != 'schedule'
        run: trident fuzz run fuzz_0 --iterations 2000
      - name: Fuzz full (nightly)
        if: github.event_name == 'schedule'
        run: trident fuzz run fuzz_0 --iterations 5000000

      # (5) coverage floor — DWARF-trace coverage, fail under threshold
      - name: Coverage
        run: |
          sbpf-coverage -- cargo test
          # parse total line coverage from lcov.info and enforce a floor
          COV=$(lcov --summary target/coverage/lcov.info 2>&1 \
                | awk -F'[:%]' '/lines/ {print $2}' | tr -d ' ')
          echo "line coverage: ${COV}%"
          awk -v c="$COV" 'BEGIN { exit (c+0 < 80.0) }' \
            || { echo "::error::coverage ${COV}% < 80% floor"; exit 1; }

      # (6) TS tests, only if present
      - name: TS tests
        if: hashFiles('package.json') != ''
        run: |
          npm ci
          npm test
```

### Notes on the gates

- **CU regression (3):** the committed-report variant from [cu-benchmarking.md](cu-benchmarking.md). `git diff --exit-code` fails if the regenerated report differs from what's committed — forcing the author to review and commit any CU change. Alternatively, write to a gitignored `out_dir` and parse the delta column, failing above a per-bench CU threshold. Pick one; the committed-diff approach puts the cost in code review.
- **Fuzz smoke (4):** a 2k-iteration run is a *smoke test* — it catches gross breakage (a panic on the first fuzzed input, a broken harness) in PR-time seconds. It is **not** a security guarantee. The real coverage comes from the nightly `schedule:` run with a large iteration budget. Keep a seed corpus committed so the smoke run starts from known-interesting inputs. See [trident-fuzzing.md](trident-fuzzing.md).
- **Coverage floor (5):** uses the DWARF-trace approach because `cargo-llvm-cov` can't see SBF — see [coverage.md](coverage.md) for *why*. Set the floor where it bites without being noise (80% is a reasonable start); raise it over time. Better: gate on coverage of the *risky* files specifically rather than the global average.
- **Caching:** two caches — cargo (`~/.cargo` + `target`, keyed on `Cargo.lock`) and the Solana platform-tools install (keyed on version). The Solana install is the expensive cold step; caching it cuts minutes off every run.
- **Pin the toolchain.** `SOLANA_VERSION` and `RUST_TOOLCHAIN` are pinned env vars so CU numbers and SBF builds are reproducible. Bumping either is an explicit, reviewable change — otherwise a silent platform-tools upgrade shifts CU baselines and breaks the regression gate spuriously (see [cu-benchmarking.md](cu-benchmarking.md)).

## Mainnet-fork E2E (Surfpool) — separate, optional job

Do **not** put the Surfpool mainnet-fork E2E in the PR gate above. It's slow and network-bound (it forks live mainnet state), so it would make every PR crawl and flake on RPC hiccups. Run it as its own workflow — `workflow_dispatch` (manual), nightly `schedule:`, or gated behind a label like `e2e` — with `continue-on-error` or a non-blocking status if you can't tolerate network flake blocking merges. See the core skill **surfpool/overview.md** for the fork setup and harness.

See also: [cu-benchmarking.md](cu-benchmarking.md), [coverage.md](coverage.md), [trident-fuzzing.md](trident-fuzzing.md).

_Last verified: June 2026_
