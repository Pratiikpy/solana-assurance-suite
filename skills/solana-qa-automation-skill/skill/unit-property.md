# L1 — Unit + Property

The widest layer of the pyramid. Two distinct jobs share the L1 label: **frontend/services unit tests** (Vitest) and **contract/program property tests** (proptest, Foundry fuzz). This file owns the first and the host-side property slot of the second. **Program-runtime unit and fuzz testing — Mollusk, LiteSVM, Trident — is delegated to [../solana-testing](../solana-testing/SKILL.md).** Do not duplicate it here; that skill owns the depth.

Parent model: [model.md](model.md). Roll-up: [release-gate.md](release-gate.md).

## Scope split — read this first

| What | Tool | Lives in |
|------|------|----------|
| Wallet glue, PDA-derivation helpers, ix builders, API routes | **Vitest** | this file |
| Pure-function host math/state invariants | **proptest** (`cargo test --features test-host`) | this file |
| Single-instruction program tests (exact CU, account bytes) | **Mollusk** | [../solana-testing/mollusk-unit.md](../solana-testing/mollusk-unit.md) |
| Multi-ix flows, PDA lifecycle, CPI, `init_if_needed` | **LiteSVM** | [../solana-testing/litesvm-integration.md](../solana-testing/litesvm-integration.md) |
| Coverage-guided program fuzzing | **Trident** | [../solana-testing/trident-fuzzing.md](../solana-testing/trident-fuzzing.md) |

Rule of thumb: **if the test touches the SVM, it's solana-testing's.** If it tests TypeScript or a pure Rust function compiled for the host, it's here.

## Frontend unit — Vitest

The source repo's verify app runs `vitest run` over `src/**/*.test.ts(x)`, node environment, with a setup file that stubs framework internals so route handlers run headless:

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['tests/e2e/**', 'node_modules/**', '.next/**'], // keep Playwright separate
    environment: 'node',
    globals: false,
    setupFiles: ['./vitest.setup.ts'], // stubs next/headers cookies()/headers()
    reporters: process.env.CI ? ['default', 'github-actions'] : 'default',
  },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
});
```

The `github-actions` reporter under `CI` is what turns a failed assertion into an annotated PR check. Excluding `tests/e2e/**` keeps L1 (Vitest) and L3 (Playwright) strictly separated — they never run in the same process.

A real Solana unit test mocks the session/registry and asserts the **builder** logic, not the chain:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { deriveVaultPda } from '@/lib/pdas';

describe('deriveVaultPda', () => {
  it('is deterministic for a given owner + mint', () => {
    const owner = new PublicKey('11111111111111111111111111111111');
    const mint  = new PublicKey('So11111111111111111111111111111111111111112');
    const [a] = deriveVaultPda(owner, mint);
    const [b] = deriveVaultPda(owner, mint);
    expect(a.equals(b)).toBe(true);          // PDA derivation is pure
  });

  it('rejects an off-curve owner', () => {
    expect(() => deriveVaultPda(/* on-curve required */ null as any, /* mint */ null as any))
      .toThrow();
  });
});
```

The source repo locks security-critical glue this way — e.g. a signature-binding test signs with a well-known **Anvil test key** (never a real-funds key) and proves a clean payload is accepted while *tampering any field after signing is rejected*. On Solana the analogue is asserting your `signAndSendTransaction` builder produces an instruction whose accounts/data match the signed intent.

CI step:

```yaml
  test-frontend:
    name: Frontend unit tests (vitest)
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions: { contents: read }
    steps:
      - uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7
      - uses: pnpm/action-setup@fe02b34f77f8bc703788d5817da081398fad5dd2 # v4.0.0
      - uses: actions/setup-node@1e60f620b9541d16bece96c5465dc8ee9832be0b # v4.0.3
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @app/verify test
```

## Property testing — proptest (host)

For pure functions (math, normalization, margin), property tests beat example tests: they assert an **invariant** across hundreds of generated inputs instead of one hand-picked case. The source repo proves the same invariants two ways — proptest across the full type range, Kani exhaustively over a restricted range ([formal.md](formal.md)):

```rust
// tests/proptest_invariants.rs — host target only.
#![cfg(not(target_arch = "wasm32"))]
use proptest::prelude::*;

proptest! {
    // median is always bounded by min and max
    #[test]
    fn median_bounded(a in any::<u128>(), b in any::<u128>()) {
        let m = median(U256::from(a), U256::from(b));
        prop_assert!(m >= U256::from(a.min(b)));
        prop_assert!(m <= U256::from(a.max(b)));
    }

    // normalize is monotonic in price
    #[test]
    fn normalize_monotonic(a in 1u64..1_000_000, b in 1u64..1_000_000, d in 0u8..18) {
        prop_assume!(a < b);
        prop_assert!(normalize_to_q64(U256::from(a), d) <= normalize_to_q64(U256::from(b), d));
    }

    // empty input → zero (boundary)
    #[test]
    fn empty_zero(im_bps in 0u16..10_000, buf_bps in 0u16..10_000) {
        prop_assert_eq!(required_margin(&[], im_bps, buf_bps), U256::ZERO);
    }
}
```

On Solana these same pure helpers (price math, fee math, PDA seeds) live in the program crate and are property-tested on the host with `proptest` — no SVM needed. The instant you need program **state** (accounts, CPI, rent), you've crossed into solana-testing's invariant layer ([../solana-testing/invariant-testing.md](../solana-testing/invariant-testing.md)).

## Contract fuzz — Foundry (source repo) → Trident (Solana)

The EVM repo fuzzes via Foundry with a deterministic, reproducible config:

```toml
# foundry.toml
[fuzz]
runs = 256                 # cases per property
max_test_rejects = 65_536  # cap on prop_assume rejections
seed = "0xdeadbeef"        # fixed → CI and local agree, failures reproduce

[invariant]
runs = 256
depth = 32
fail_on_revert = false
```

The fixed `seed = 0xdeadbeef` is deliberate: a flaky fuzz failure that can't be reproduced is worse than no fuzzing. With a pinned seed, a CI counterexample reproduces byte-for-byte locally.

**On Solana this entire `forge fuzz` layer maps to Trident** (coverage-guided, mutates ix inputs + account selection against a real SVM). Pin the seed/runs there the same way and delegate: [../solana-testing/trident-fuzzing.md](../solana-testing/trident-fuzzing.md).

## CI — the L1 contract jobs

```yaml
  test-rust:
    name: Rust tests
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions: { contents: read }
    steps:
      - uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7
      - uses: actions-rust-lang/setup-rust-toolchain@b113a30d27a8e59c969077c0a0168cc13dab5ffc # v1.8.0
      - name: cargo test
        run: cargo test --workspace --all-features   # includes host proptest
```

`--all-features` is what turns on the `test-host` feature gate that exposes pure functions to the external proptest crate. On Solana, the program-runtime equivalent (`cargo test-sbf` / Mollusk / LiteSVM) runs in the solana-testing jobs, not here.

## What gates release at L1

- Any failing Vitest spec → fail.
- Any proptest counterexample → fail (and it'll print the minimized input).
- Any program unit/fuzz failure → fail, **owned by solana-testing's manifest entry**, not this file's.

Each emits one manifest entry consumed by [release-gate.md](release-gate.md). A skipped L1 job is treated as a fail by the gate — you cannot ship untested logic.

See also: [model.md](model.md) · [static-lint.md](static-lint.md) · [formal.md](formal.md) · [release-gate.md](release-gate.md) · [../solana-testing](../solana-testing/SKILL.md).

_Last verified: June 2026_
