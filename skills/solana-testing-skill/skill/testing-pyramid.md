# The 2026 Solana Testing Pyramid

Which layer, how many, in what order. The pyramid is **bottom-heavy by design**: the cheapest, most deterministic tests are the most numerous, and each layer up is slower, costlier, and rarer. Build from the base. A program with hundreds of E2E tests and no unit tests is inverted and will be slow, flaky, and still unsafe.

```
                    /\
                   /  \   TOP   Surfpool mainnet-fork E2E   ~2%   (few, high-value)
                  /----\
                 /      \  FUZZ  Trident invariants/property ~8%   (CI nightly / pre-audit)
                /--------\
               /          \ MID  LiteSVM integration (Rust+TS)~20% (multi-ix, CPI, lifecycle)
              /------------\
             /              \ BASE Mollusk unit + CU bencher  ~70% (one ix, exact CU+state)
            /----------------\
         <----- sbpf-coverage / anchor-coverage spans every layer ----->
```

Ratios are **guidance, not law** — a pure-math AMM core skews more unit/fuzz; a multi-CPI router skews more integration. The *ordering* and the *bottom-heaviness* are the invariant.

## The layers

### (1) BASE — Mollusk unit tests
One instruction, in-process, no validator. The fastest feedback on Solana (microseconds) and the **only** layer with exact-CU and byte-precise account-state assertions. Most of your tests live here: every signer/owner check, every arithmetic edge, every account-data mutation gets a `Check`. Both the happy path and the negative (reject) path. → [mollusk-unit.md](mollusk-unit.md).

### (2) BASE+ — CU bencher in CI
Co-located with the unit layer: `mollusk-svm-bencher` measures real CU per instruction, writes a markdown report, and you commit it. CI re-runs with `must_pass(true)` and `git diff --exit-code`s the report — any CU change fails the build until a human reviews and re-commits the delta. CU regression is a liveness/DoS bug, caught in the PR that caused it. → [cu-benchmarking.md](cu-benchmarking.md).

### (3) MIDDLE — LiteSVM integration tests (Rust + TS)
Multi-instruction flows, CPI dispatch, PDA lifecycle, and `init_if_needed` reinit — anything that spans more than one instruction or a real signed transaction. This is where **`anchor test` defaults now** (LiteSVM-backed, no external validator). Write these in Rust for program-side flows and in TypeScript for client/SDK parity. → [litesvm-integration.md](litesvm-integration.md).

### (4) FUZZ / INVARIANT — Trident
Encode the money invariants — balance/supply conservation, "only X mutates Y", no-unauthorized-mint — as plain `assert!`s, and let Trident's coverage-guided engine mutate inputs and **randomly order flows** to find the sequence that breaks them. Far fewer targets than unit tests, but each covers an unbounded input space. Run a bounded smoke campaign in **CI nightly**; run a long campaign **pre-audit / pre-mainnet**. → [trident-fuzzing.md](trident-fuzzing.md), with invariants from [invariant-testing.md](invariant-testing.md).

### (5) TOP — Surfpool mainnet-fork E2E
Few, high-value tests against **cloned real mainnet state** — live AMMs, oracles, mints, and config accounts — exercised before deploy. This is the only layer that catches "works on a fresh validator, breaks against the real Pyth account / the real pool's tick state." Surfpool (1.4.x) is now the default `anchor test` validator backend. Keep these scarce and decisive: the critical end-to-end flows that touch external programs. → core `surfpool/overview.md` via [testing.md](../solana-dev/references/testing.md).

### (6) CROSS-CUTTING — Coverage
`sbpf-coverage` / `anchor-coverage` (DWARF-based — `cargo-llvm-cov` does **not** work on the SBF target) spans every layer. Its job is to confirm the unit and fuzz tests **actually reach the risky branches** — the `require!`, the `checked_sub`, the owner check. An uncovered security branch is an untested one no matter how green the suite. → [coverage.md](coverage.md).

## Why bottom-heavy

- **Speed.** Mollusk runs in microseconds in-process; LiteSVM in milliseconds; Surfpool spins a fork. A dev iterating on instruction math wants the answer in the time it takes to save the file — that's only the base.
- **Determinism.** Unit and integration layers control every byte of input state, so failures are reproducible and CI is stable. E2E against live mainnet state is inherently less deterministic (state drifts), so you minimize it.
- **Cost & signal.** A failure at the base points at one instruction; a failure at the top could be anywhere across the flow. Cheap, narrow tests localize bugs; expensive, broad ones only confirm the system. You want the bug found at the narrowest layer that can find it.

The bug-class → layer mapping that operationalizes this is [bug-class-playbook.md](bug-class-playbook.md): write the exploit as a failing test at the **lowest** layer that can express it.

## Decision tree

- **I changed one instruction's math** → add a Mollusk edge test (`0`, `MAX`, off-by-one) **+** a Trident proptest invariant (conservation). Re-pin its CU bench.
- **I added a CPI** → LiteSVM integration test for the happy path **+** a malicious-target negative (deploy a hostile stub, assert the program-id guard rejects).
- **I added an init / `init_if_needed` path** → LiteSVM reinit test: init twice, assert the second fails or is idempotent (state not reset).
- **I added an authority/privileged path** → LiteSVM negative (non-authority signer fails) **+** a Trident "only X mutates Y" invariant.
- **I touched balance/mint/burn logic** → Trident conservation + no-unauthorized-mint invariants are mandatory, not optional.
- **CU went up** → review the bencher delta; rebaseline deliberately if the increase is justified, else optimize.
- **Preparing for audit** → run the **full** Trident campaign (high iteration count, hours+) **+** `sbpf-coverage` to prove the fuzzer reached every security branch **+** the Surfpool E2E suite against current mainnet state.
- **Not sure a test does anything** → run coverage and check the guarded line is covered.

## Build order for a new program

1. Mollusk unit tests per instruction (happy + negative) as you write each handler. 2. Pin CU benches; wire the diff gate into CI. 3. LiteSVM flows for every multi-ix path, CPI, and lifecycle. 4. Trident targets encoding the money invariants; nightly smoke in CI. 5. A handful of Surfpool E2E tests against mainnet state before the first deploy. 6. Coverage to verify the base and fuzz layers reach the risky branches. Tool basics and client setup: [testing.md](../solana-dev/references/testing.md); Anchor wiring: [anchor-harness.md](anchor-harness.md); CI gating: [ci-harness.md](ci-harness.md).

_Last verified: June 2026_
