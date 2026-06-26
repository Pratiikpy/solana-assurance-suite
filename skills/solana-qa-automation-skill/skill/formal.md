# L1 — Formal Verification (Kani)

The layer that does not sample. proptest and Trident *try* hundreds of inputs; Kani **proves** — it model-checks every input in a bounded domain and either certifies the assertion holds or hands you a concrete counterexample. On Solana this maps **directly** to the program crate: pure-math and state-transition invariants (overflow, monotonicity, oracle freshness) prove identically. The source repo also runs **Halmos** (EVM symbolic execution) — that is **EVM-bytecode-only and is dropped on Solana**. The unique discipline here is the **anti-erosion gate**: a proof count that can never silently shrink.

Parent model: [model.md](model.md). Sibling sampling layer: [unit-property.md](unit-property.md). Program-state invariants beyond pure functions: [../solana-testing/invariant-testing.md](../solana-testing/invariant-testing.md).

## Kani harnesses — `#[kani::proof]`

A harness declares symbolic inputs with `kani::any()`, constrains the domain with `kani::assume(...)`, and asserts the invariant. Kani then proves it over the *entire* constrained space:

```rust
// contracts/plinth/src/math.rs — proven, not sampled.
#[cfg(kani)]
mod kani_proofs {
    use super::*;

    /// median(a,b) is always within [min,max].
    #[kani::proof]
    fn median_bounded() {
        let a: u128 = kani::any();
        let b: u128 = kani::any();
        let m = median(U256::from(a), U256::from(b));
        assert!(m >= U256::from(a.min(b)));
        assert!(m <= U256::from(a.max(b)));
    }

    /// normalize is monotonic in price. #[kani::unwind] bounds loop unrolling.
    #[kani::proof]
    #[kani::unwind(4)]
    fn normalize_monotonic() {
        let a: u32 = kani::any();
        let b: u32 = kani::any();
        let d: u8  = kani::any();
        kani::assume(d <= 18);
        kani::assume(a < b);
        assert!(normalize_to_q64(U256::from(a), d) <= normalize_to_q64(U256::from(b), d));
    }

    /// Oracle freshness: lag > freshness ⇒ stale. The exact saturating-sub
    /// branch the price-read path uses; clock-skew (now < last_publish) → lag 0.
    #[kani::proof]
    fn oracle_freshness_rejects_stale() {
        let now: u64 = kani::any();
        let last_publish: u64 = kani::any();
        let freshness: u64 = kani::any();
        kani::assume(freshness > 0 && freshness < 86_400);
        let lag = now.saturating_sub(last_publish);
        let is_stale = lag > freshness;
        if !is_stale { assert!(lag <= freshness); }
    }
}
```

Note the pairing with [unit-property.md](unit-property.md): the **same** invariants (`median_bounded`, `normalize_monotonic`) also exist as proptest tests. proptest fuzzes the full type range fast; Kani proves a restricted range exhaustively. Two angles on one property — fuzz catches what you under-constrained, Kani catches what fuzzing's sampling missed.

## Running Kani

Workspace-excluded crates (the Stylus crates here; on Solana, a `programs/<name>` crate that won't link in the host workspace) must be iterated **per-crate** — `cargo kani --workspace` from root runs zero proofs against an excluded member:

```javascript
// scripts/run-kani.mjs — execFileSync, no shell interpolation; CRATES is static.
import { execFileSync } from 'node:child_process';
const CRATES = ['contracts/plinth', 'contracts/sigil'];
let failed = 0;
for (const crate of CRATES) {
  try { execFileSync('cargo', ['kani'], { cwd: crate, stdio: 'inherit' }); }
  catch { failed++; console.error(`kani failed for ${crate}`); }
}
if (failed > 0) process.exit(1);
```

Locally: `cargo kani setup` once, then `cd <crate> && cargo kani`. A pass prints `VERIFICATION:- SUCCESSFUL`; a failure prints `VERIFICATION:- FAILED` with the concrete counterexample trace.

## The anti-erosion gate (the part most teams miss)

Proofs rot by **deletion**, not by failing. Someone refactors, a harness becomes inconvenient, it quietly disappears, and CI stays green because the *remaining* proofs still pass. The gate closes that hole: count `#[kani::proof]` harnesses, compare against a committed baseline, **hard-fail if the count dropped** — unless the baseline file was edited (with a written reason) in the same change.

```yaml
  kani:
    name: Kani formal verification
    runs-on: ubuntu-latest
    timeout-minutes: 45
    permissions:
      contents: write          # NOT {} — it opens a PR to refresh kani-status.json
      pull-requests: write
    steps:
      - uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7
      - uses: actions-rust-lang/setup-rust-toolchain@b113a30d27a8e59c969077c0a0168cc13dab5ffc # v1.8.0
      - name: Install Kani
        run: |
          cargo install --force --locked kani-verifier
          cargo kani setup
      - name: Kani harness-count regression gate
        run: |
          set -euo pipefail
          ACTUAL=$(grep -rE "^[[:space:]]*#\[kani::proof\]" contracts/ --include="*.rs" | wc -l | tr -d ' ')
          BASELINE=$(cat docs/kani-baseline.txt | tr -d '[:space:]')
          echo "kani proofs: actual=$ACTUAL baseline=$BASELINE"
          if [ "$ACTUAL" -lt "$BASELINE" ]; then
            echo "::error::Kani proof count regressed: $ACTUAL < $BASELINE. Either restore the deleted harness or update docs/kani-baseline.txt with a written reason."
            exit 1
          fi
      - name: Run Plinth proofs
        id: plinth
        run: cd contracts/plinth && cargo kani 2>&1 | tee /tmp/plinth-kani.log
      - name: Run Sigil proofs
        id: sigil
        run: cd contracts/sigil && cargo kani 2>&1 | tee /tmp/sigil-kani.log
```

Mechanics worth copying exactly:
- The count uses an **anchored** regex (`^[[:space:]]*#\[kani::proof\]`) so a `#[kani::proof]` mentioned in a comment or doc-string doesn't inflate the count.
- `docs/kani-baseline.txt` is a single integer (in this repo, `9` — matching the 9 live `#[kani::proof]` harnesses across `plinth` and `sigil`).
- The whole step runs `set -euo pipefail`, so a failed `cat` of a missing baseline aborts rather than treating empty as `0`.
- **Direction is one-way**: the gate only fails on a *drop*. Adding proofs is free; you ratchet the baseline up when you want to lock the new floor in.
- `contents: write` is intentional and **not** the `permissions: {}` default — this job opens a PR to refresh `kani-status.json` (the dashboard's proof badge) on `main`, so it needs write. Keep the write scope confined to this job, not the workflow.

## Evidence, not a badge

After the proofs run, the job emits machine-readable status — passed/total, timestamp, run URL — so the verdict is evidence-backed (the L-GATE evidence rule, [release-gate.md](release-gate.md)):

```bash
PASSED=$(grep -c "VERIFICATION:- SUCCESSFUL" /tmp/plinth-kani.log /tmp/sigil-kani.log || echo 0)
STATE="pass"   # only if BOTH crate steps' outcome == success; else fail/unknown
cat > apps/verify/public/kani-status.json <<EOF
{ "state": "$STATE", "passed": $PASSED, "total": 5,
  "last_run_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "proof_run_url": "https://github.com/$REPO/actions/runs/$RUN_ID" }
EOF
```

A green proof badge with no `proof_run_url` behind it is treated as RED — the badge must trace to a real run.

## Halmos — EVM-only, drop on Solana

The source repo runs a separate `halmos.yml` workflow (symbolic execution of Solidity, path-triggered on `tests/halmos/**` and `contracts/**`):

```yaml
      - run: pip install halmos==0.2.1
      - run: forge build
      - run: |
          halmos --root . \
            --contract PlinthMathHalmosTest \
            --contract SigilNonceMonotonicityHalmosTest \
            --solver-timeout-assertion 60000 --test-parallel --statistics
      # Discord alert on failure (main only) — a counterexample found by SMT.
```

Halmos symbolically executes **EVM bytecode** compiled by `forge build` and discharges assertions to an SMT solver. There is no EVM on Solana and no equivalent SBF-bytecode symbolic harness in this toolchain, so **Halmos has no Solana mapping — drop it**. Its role (symbolically proving contract-level properties) is absorbed on Solana by **Kani** (pure logic, proven exhaustively) plus **Trident** coverage-guided fuzzing for stateful program paths ([../solana-testing/trident-fuzzing.md](../solana-testing/trident-fuzzing.md)).

## What gates release at formal

- Any `VERIFICATION:- FAILED` (a counterexample) → fail.
- Proof count `< baseline` and baseline unchanged → fail.
- A skipped Kani job → treated as fail by the gate (skip ≠ pass).

One manifest entry to [release-gate.md](release-gate.md).

## Solana mapping summary

| Source (EVM/Stylus) | Solana |
|---------------------|--------|
| `#[kani::proof]` on a Stylus crate | `#[kani::proof]` on `programs/<name>` (pure fns) |
| `docs/kani-baseline.txt` count gate | identical — count harnesses in `programs/` |
| Halmos symbolic EVM execution | **dropped** — no analogue |
| Stateful contract invariants (Halmos's other half) | Trident + invariant tests (solana-testing) |

See also: [model.md](model.md) · [unit-property.md](unit-property.md) · [static-lint.md](static-lint.md) · [release-gate.md](release-gate.md) · [../solana-testing/invariant-testing.md](../solana-testing/invariant-testing.md).

_Last verified: June 2026_
