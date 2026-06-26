# Trident — Coverage-Guided Fuzzing for Solana

Trident (Ackee Blockchain) is the current standard for fuzzing Solana programs. It mutates instruction inputs and account selections, executes them against a real SVM, and tracks branch coverage to drive itself toward unexplored code. It finds the bugs your unit tests never thought to write: boundary arithmetic, unexpected instruction ordering, and account substitution.

> Pairs with [invariant-testing.md](invariant-testing.md) (what to assert) and [bug-class-playbook.md](bug-class-playbook.md) (which exploit class each flow targets).

## Versions (crates.io is authoritative — the README badge lags)

- **Stable**: `trident-cli` / `trident-fuzz` **0.12.0** (2025-11). Tracks `solana-sdk` 2.3+.
- **Latest pre-release**: **0.13.0-rc.4** (2026-05) — introduces the `#[flow_executor]` macro model shown below.

Check `cargo search trident-fuzz` / crates.io before pinning. Do not trust a version inferred from an old blog post or the GitHub README badge.

## No honggfuzz. No AFL. (Ignore every guide that says otherwise.)

Since **0.11**, Trident bundles **TridentSVM**, which executes transactions through the Anza Solana SVM API directly. There is **no** honggfuzz or AFL dependency and **no** external fuzzer binary to install. It runs natively on Linux, macOS, and Windows. Any setup that has you installing `honggfuzz` or configuring `AFL` flags is describing the pre-0.11 architecture and is deprecated — delete it.

## What changed in 0.12 (read before copying old code)

- The **`FuzzClient` trait was removed.** Client methods now live directly on the `Trident` struct: `airdrop`, `process_transaction`, `get_account_with_type`, `random_from_range`, etc. No `client.` indirection, no trait import.
- **Invariants are plain `assert!`s.** There is no special invariant-logging mechanism anymore — you assert inside flows/init and a failing `assert!` is a finding. (See [invariant-testing.md](invariant-testing.md) for the canonical money invariants.)
- Added **Token-2022** support and **transaction-timestamp / time-travel** (fuzz time-dependent logic — vesting cliffs, auction expiry, staking windows).

## Install

```bash
cargo install trident-cli
trident --version
```

Requires a Rust toolchain and a built Solana program (Anchor or native) in the workspace.

## Workflow

```bash
trident init                 # generates trident-tests/ + instruction bindings from the program IDL
# edit trident-tests/fuzz_0/test_fuzz.rs — write flows + invariants
trident fuzz run fuzz_0      # run the target; reproduces & shrinks any crashing input
```

`trident init` reads the program **IDL** and generates typed instruction bindings (`InitializeFnInstruction`, its `...Data` and `...Accounts` builders) plus `fuzz_accounts.rs` (the account-address registry) and `types.rs`. You write the flows; Trident drives the inputs.

## The harness shape (0.13 macro model — faithful to the repo `hello_world` example)

```rust
use trident_fuzz::fuzzing::*;
mod fuzz_accounts; mod types;
use fuzz_accounts::*; use types::*;

#[derive(FuzzTestMethods)]
struct FuzzTest { trident: Trident, fuzz_accounts: AccountAddresses }

#[flow_executor]
impl FuzzTest {
    fn new() -> Self { Self { trident: Trident::default(), fuzz_accounts: AccountAddresses::default() } }

    #[init]   // per-iteration setup: fresh state before the flows run
    fn start(&mut self) {
        let author = self.fuzz_accounts.author.insert(&mut self.trident, None);
        self.trident.airdrop(&author, 10 * LAMPORTS_PER_SOL);
        let input = self.trident.random_from_range(0..u8::MAX);
        let ix = InitializeFnInstruction::data(InitializeFnInstructionData::new(input))
            .accounts(InitializeFnInstructionAccounts::new(author, hello_world)).instruction();
        let res = self.trident.process_transaction(&[ix], Some("Initialize"));
        if res.is_success() {
            let acc = self.trident.get_account_with_type::<StoreHelloWorld>(&hello_world, 8);
            if let Some(a) = acc { assert!(a.input == input); }  // invariant = plain assert
        }
    }

    #[flow] fn flow1(&mut self) {}   // randomly-selected fuzzed action; add one #[flow] per ix path
    #[end]  fn end(&mut self) {}     // cleanup / final cross-iteration invariant
}

fn main() { FuzzTest::fuzz(1000, 100); }   // 1000 iterations, up to 100 flows per iteration
```

### Lifecycle, decoded

- `#[init]` — runs **once per iteration**. Seed accounts, airdrop lamports, establish the starting state the flows mutate. Assertions here check post-setup invariants.
- `#[flow]` — a fuzzable action. Trident **randomly selects and orders** flows within an iteration (up to `flows_per_iteration`), driven by coverage feedback. Each flow builds and submits one (or more) instruction(s) and asserts the invariants that must hold after it. **The random ordering is the point** — it surfaces sequences a human would never script.
- `#[end]` — runs once per iteration after all flows. Use for end-of-run invariants (e.g. supply conservation across the whole iteration) and cleanup.
- `FuzzTest::fuzz(iterations, flows_per_iteration)` — the budget. More iterations = deeper coverage; raise both for pre-audit runs.

### Inputs

`self.trident.random_from_range(lo..hi)` is the fuzzed-input source. Bind every amount, index, bump, and discriminant through it so the engine can mutate toward boundary values (`0`, `MAX`, off-by-one) that trigger arithmetic and bounds bugs.

## What fuzzing catches that unit tests do not

- **Boundary arithmetic** — `u64` overflow/underflow at `0` and `MAX`, rounding in fee/share math. The engine pushes inputs to extremes you wouldn't enumerate by hand.
- **Unexpected instruction ordering** — withdraw-before-deposit, double-close, init→init, settle-before-fund. Random flow sequencing exercises state machines no scripted test covers.
- **Account substitution** — passing an attacker-controlled account where the program expected a specific one, exposing missing owner/signer/PDA checks. The account registry lets Trident swap addresses across flows.

These map directly to fund-draining bug classes — see [bug-class-playbook.md](bug-class-playbook.md).

## When to run

- **CI nightly** — a bounded smoke run (a few thousand iterations) on every default-branch build; fail the job on any crash and commit the reproducer.
- **Pre-audit / pre-mainnet** — a long campaign (hours to days, high iteration count) per target. Fuzzing is the cheapest way to find the bug before the auditor — or the attacker — does.

Crashing inputs are saved and **automatically shrunk** to a minimal reproducer; commit it as a regression test so the bug can never silently return.

## Note on stable 0.12 vs 0.13-rc

The `#[flow_executor]` / `#[derive(FuzzTestMethods)]` macro model above is **0.13**. If you are pinned to stable **0.12**, the lifecycle concepts (`#[init]`/`#[flow]`/`#[end]`, `FuzzTest::fuzz`, `Trident`-struct methods, `assert!` invariants) are the same, but **verify the exact macro names against the 0.12 tag** of the Trident repo before copying — the attribute surface shifted between the two lines. When in doubt, run `trident init` on your installed version and match the generated `test_fuzz.rs`.

_Last verified: June 2026_
