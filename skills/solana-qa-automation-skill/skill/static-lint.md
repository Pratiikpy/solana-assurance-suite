# L0 — Static / Lint / Type

The cheapest gate and the first to run. Costs seconds, catches the noise that would otherwise burn a reviewer's attention: formatting drift, dead code, type holes, and off-brand copy. Everything here is **hard-fail** — there is no soft-gate at L0. A warning is a failure. This file mirrors the real `lint` job in the source Arbitrum/Stylus repo and maps it onto Solana.

Parent model: [model.md](model.md). Roll-up: [release-gate.md](release-gate.md). Program-crate testing depth: [../solana-testing](../solana-testing/SKILL.md).

## What L0 enforces

| Check | Command | Fails on |
|-------|---------|----------|
| Rust format | `cargo fmt --check` | any diff |
| Rust lint | `cargo clippy --workspace --all-targets -- -D warnings` | any warning |
| TS types | `tsc --noEmit` | any type error |
| TS/React lint | `eslint` (flat config) | any error |
| Copy/voice | `node scripts/check-banned-words.mjs` | any banned word |

`-D warnings` is the load-bearing flag: it promotes every clippy lint from warn to error, so a single `unused_variable` reddens CI. `--all-targets` extends that to tests, benches, and examples — not just `src/`.

## The real lint job

From `.github/workflows/ci.yml`. SHA-pinned actions, `permissions: {contents: read}`, 10-minute cap:

```yaml
jobs:
  lint:
    name: Lint + format
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7
      - uses: actions-rust-lang/setup-rust-toolchain@b113a30d27a8e59c969077c0a0168cc13dab5ffc # v1.8.0
        with:
          components: rustfmt, clippy
      - uses: pnpm/action-setup@fe02b34f77f8bc703788d5817da081398fad5dd2 # v4.0.0
      - uses: actions/setup-node@1e60f620b9541d16bece96c5465dc8ee9832be0b # v4.0.3
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: cargo fmt
        run: cargo fmt --check
      - name: cargo clippy
        run: cargo clippy --workspace --all-targets -- -D warnings
      - name: pnpm lint
        run: pnpm -r lint
      - name: Banned words check
        run: node scripts/check-banned-words.mjs
```

`pnpm -r lint` fans out to every workspace member's `lint` script. In the source repo each member runs `eslint src --ext .ts,.tsx --max-warnings=200` plus `tsc --noEmit` as a separate `type-check`. The `--frozen-lockfile` install is itself a gate — a stale lockfile fails before any lint runs.

## Fast-fail discipline

Every multi-line CI step in this repo runs as `bash -euo pipefail` (GitHub Actions' default shell on Linux already sets `-e`, but the repo's hand-rolled `run: |` blocks declare it explicitly for the ones that pipe). The contract:

- `-e` — abort on the first non-zero exit. No "lint failed but the job kept going."
- `-u` — unset variable is an error. Catches a typo'd `$BASELNE`.
- `-o pipefail` — a failure anywhere in a pipe propagates, so `grep ... | wc -l` can't mask a `grep` error with `wc`'s success.

Without `pipefail`, `node scripts/lint.mjs | tee log` would report the `tee` exit, not the script's — a silent green. Declare it.

## Banned-words / voice checker

`scripts/check-banned-words.mjs` greps every tracked text file for marketing slop and exits 1 on a hit. It is **context-aware** to avoid false positives — `leverage` as a financial noun (`10x leverage`) is allowed; only the verb (`leverage our`, `leveraging`) flags:

```javascript
const BANNED_PATTERNS = [
  { pattern: /\bdelve\b/i, word: 'delve' },
  { pattern: /\brobust\b/i, word: 'robust' },
  { pattern: /\bleverag(e\s+(our|the|its|this|that|their|your)|ing)\b/i, word: 'leverage (verb)' },
  { pattern: /\bseamless(ly)?\b/i, word: 'seamless' },
  { pattern: /\bstreamline[ds]?\b/i, word: 'streamline' },
  { pattern: /\bcutting[- ]edge\b/i, word: 'cutting-edge' },
  { pattern: /\brevolutionize[ds]?\b/i, word: 'revolutionize' },
  { pattern: /\bempower(s|ed|ing|ment)?\b/i, word: 'empower' },
  // ...state-of-the-art, unlock (verb), unleash, harness (verb)
];
```

It enumerates files via `git ls-files` (tracked only — never scans `node_modules`/`target`), excludes the convention doc and the checker itself (they legitimately contain the words), and skips `*.test.*` (tests assert *absence* of banned words). On Solana repos this is unchanged; it polices docs/UI copy, not chain code.

## Solana mapping

L0 is mostly chain-agnostic — `tsc`/ESLint/banned-words cover the SDK + frontend identically. The Rust side narrows to the **program crate**:

```yaml
      - name: cargo fmt (program)
        run: cargo fmt --check
      - name: cargo clippy (program)
        # Anchor/native program crate; --all-targets covers its tests too.
        run: cargo clippy -p my_program --all-targets -- -D warnings
      - name: anchor build (lint via macro + IDL gen)
        # `anchor build` surfaces #[program]/#[account] macro errors and
        # regenerates the IDL; a drifted IDL or a macro misuse fails here.
        run: anchor build
```

Notes for a Solana repo:
- `anchor build` is the closest analogue to the source repo's `cargo stylus check` — it compiles the on-chain crate to SBF and runs the Anchor proc-macros, catching account-constraint and IDL errors that plain `clippy` misses.
- Pin `clippy` to the program crate (`-p my_program`) so frontend-adjacent Rust (if any) doesn't dilute the gate.
- Keep `cargo fmt --check` repo-wide; formatting is uniform regardless of chain.
- Add `clippy::arithmetic_side_effects` to the program crate's `#![deny(...)]` if you want unchecked-math to fail at L0 rather than waiting for L1 fuzzing — but real overflow proofs belong in [formal.md](formal.md) (Kani) and [../solana-testing](../solana-testing/invariant-testing.md).

## Local pre-commit (mirror CI exactly)

Run the same commands a pre-push hook would, so CI is never the first place a lint failure surfaces:

```bash
set -euo pipefail
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
pnpm -r lint            # eslint + tsc --noEmit per member
node scripts/check-banned-words.mjs
```

If this passes locally, the `lint` job passes in CI — the commands are identical by construction. That parity is the point: L0 is the layer you should never see fail in CI.

See also: [model.md](model.md) · [unit-property.md](unit-property.md) · [formal.md](formal.md) · [release-gate.md](release-gate.md).

_Last verified: June 2026_
