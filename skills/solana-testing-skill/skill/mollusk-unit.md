# Mollusk — Single-Instruction Unit Testing

The bottom of the pyramid. Mollusk is a lightweight harness that runs **one instruction** against the SVM **in-process** — no validator, no runtime, no transaction. You hand it a program, an instruction, the accounts that instruction touches, and a list of `Check`s; it executes the instruction and asserts. This is the fastest feedback loop on Solana (microseconds per run) and the only layer that gives you **exact compute-unit** and **byte-precise account-state** assertions. Reach for it whenever the failure you want to catch lives inside a single instruction: signer/owner checks, arithmetic, account-data mutation, CU regressions.

For multi-instruction flows (PDA lifecycle, CPI, `init_if_needed` reinit), it's the wrong tool — use [litesvm-integration.md](litesvm-integration.md). For the bug-class → assertion mapping, see [bug-class-playbook.md](bug-class-playbook.md). Core-skill basics: [testing.md](../solana-dev/references/testing.md).

## Install

```toml
[dev-dependencies]
mollusk-svm    = "0.13.4"
solana-account = "2"
solana-instruction = "2"
solana-pubkey  = "2"
# token tests only:
mollusk-svm-programs-token = "0.13.4"
```

Or: `cargo add --dev mollusk-svm@0.13.4 solana-account solana-instruction solana-pubkey`.

> **Stale-guide warning.** Mollusk moved off the monolithic `solana-sdk` to the modular `solana-*` crates. Any tutorial pinning `mollusk-svm = "0.8"` with `solana-sdk = "1.18"` predates that split — the `Account`/`Pubkey`/`Instruction` imports won't line up and the `Check` API differs. Use the modular crates shown above.

## Core API

```rust
use mollusk_svm::{Mollusk, result::Check};
use solana_account::Account;
use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;
```

- **`Mollusk::new(&program_id, "my_program")`** — loads the compiled SBF object from `target/deploy/my_program.so`. Build it first with `cargo build-sbf` (Mollusk does not compile for you). The second arg is the `.so` basename, not the crate name if they differ.
- **`mollusk.process_instruction(&ix, &accounts)`** — runs and returns an `InstructionResult` (program result, CU consumed, resulting accounts) without asserting. Use when you want to inspect output yourself.
- **`mollusk.process_and_validate_instruction(&ix, &accounts, &[checks])`** — runs and asserts each `Check`; panics with a precise diff on mismatch. This is the workhorse.

`accounts` is `&[(Pubkey, Account)]` — the *input* state of every account the instruction references, in any order. Mollusk feeds them to the loader keyed by pubkey.

### Check types

| `Check` | Asserts |
|---------|---------|
| `Check::success()` | Instruction returned `Ok` |
| `Check::err(ProgramError::MissingRequiredSignature)` | Failed with this exact error |
| `Check::instruction_err(InstructionError::...)` | Failed with this raw instruction error |
| `Check::compute_units(5_000)` | **Exact** CU consumed (not a ceiling) |
| `Check::account(&pk).lamports(x).build()` | Post-state lamports |
| `Check::account(&pk).data(&bytes).build()` | Post-state account data, byte-exact |
| `Check::account(&pk).owner(&program_id).build()` | Post-state owner |
| `Check::account(&pk).space(165).build()` | Post-state data length |
| `Check::account(&pk).closed().build()` | Account zeroed + lamports drained |

`.account(...)` chains compose: `.lamports(x).owner(&p).data(&d).build()` asserts all three on one account.

## Full passing example

A native "increment a u64 counter" instruction. The account is owned by the program and holds 8 bytes.

```rust
use mollusk_svm::{Mollusk, result::Check};
use solana_account::Account;
use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;

#[test]
fn increment_succeeds() {
    let program_id = Pubkey::new_unique();
    let mollusk = Mollusk::new(&program_id, "my_program");

    let counter = Pubkey::new_unique();
    let before = 41u64;

    let account = Account {
        lamports: 1_000_000,
        data: before.to_le_bytes().to_vec(),
        owner: program_id,
        executable: false,
        rent_epoch: 0,
    };

    // instruction discriminator 0 = increment
    let ix = Instruction::new_with_bytes(
        program_id,
        &[0],
        vec![AccountMeta::new(counter, false)],
    );

    let mut expected = before.to_le_bytes().to_vec();
    expected[..8].copy_from_slice(&(before + 1).to_le_bytes());

    mollusk.process_and_validate_instruction(
        &ix,
        &[(counter, account)],
        &[
            Check::success(),
            Check::compute_units(312),
            Check::account(&counter).data(&expected).owner(&program_id).build(),
        ],
    );
}
```

The canonical lamports-transfer form (recipient credited exactly):

```rust
let mollusk = Mollusk::new(&program_id, "my_program");
mollusk.process_and_validate_instruction(
    &instruction,
    &accounts,
    &[ Check::success(), Check::compute_units(5_000),
       Check::account(&recipient).lamports(expected).build() ],
);
```

> Start with `Check::success()` only, run once, read the `compute_units` Mollusk prints, then pin it with `Check::compute_units(n)`. From then on any CU regression fails the test. To track CU over time instead of pinning, use the bencher — see [cu-benchmarking.md](cu-benchmarking.md).

## Negative test — missing signer must fail

The single most common fund-draining bug class is an authority account that the program never checks `is_signer` on. The negative test asserts the instruction **rejects** the unsigned authority. Write it against the *vulnerable* code first and watch it pass-when-it-shouldn't, then confirm it fails correctly on the fixed program.

```rust
use solana_program_error::ProgramError;

#[test]
fn withdraw_without_signer_is_rejected() {
    let program_id = Pubkey::new_unique();
    let mollusk = Mollusk::new(&program_id, "my_program");

    let authority = Pubkey::new_unique();
    let vault = Pubkey::new_unique();

    // AccountMeta::new(authority, false) -> is_signer = false
    let ix = Instruction::new_with_bytes(
        program_id,
        &[2], // withdraw
        vec![
            AccountMeta::new(vault, false),
            AccountMeta::new_readonly(authority, false), // NOT a signer
        ],
    );

    let accounts = vec![
        (vault, Account { lamports: 1_000_000, data: vec![0; 64], owner: program_id, executable: false, rent_epoch: 0 }),
        (authority, Account::default()),
    ];

    mollusk.process_and_validate_instruction(
        &ix,
        &accounts,
        &[Check::err(ProgramError::MissingRequiredSignature)],
    );
}
```

If a fixed program returns a custom error, assert it precisely with `Check::err(ProgramError::Custom(MyError::Unauthorized as u32))`.

## Token-program tests

`mollusk-svm-programs-token` registers SPL Token / Token-2022 into the harness so instructions that CPI into the token program resolve:

```rust
use mollusk_svm_programs_token::token;

let mut mollusk = Mollusk::new(&program_id, "my_program");
token::add_program(&mut mollusk); // SPL Token now loaded

// build token-account state with the helper, then assert post-balance
let mint = Pubkey::new_unique();
let owner = Pubkey::new_unique();
let src = Pubkey::new_unique();
let src_account = token::create_account_for_token_account(&mint, &owner, 1_000);
```

This keeps token CPIs at the unit layer instead of forcing a jump to LiteSVM.

## Sysvar / clock / feature-set customization

```rust
use mollusk_svm::Mollusk;
use solana_feature_set::FeatureSet;

let mut mollusk = Mollusk::new(&program_id, "my_program");

// raise the CU ceiling for an expensive instruction
mollusk.set_compute_budget(1_400_000);

// run against all-enabled features (test post-activation behavior)
mollusk.set_feature_set(FeatureSet::all_enabled());

// advance the clock sysvar for time-gated logic
mollusk.sysvars.clock.unix_timestamp = 1_900_000_000;
mollusk.sysvars.clock.slot = 250_000_000;
```

`mollusk.sysvars` exposes the full sysvar set (`clock`, `rent`, `epoch_schedule`, …); mutate before `process_*`. The feature set defaults to mainnet-active; flip to `all_enabled()` to test against features not yet live, or pin a specific set to reproduce a bug under the activation state that produced it.

## Mollusk vs LiteSVM — when to use which

| | Mollusk | LiteSVM |
|--|---------|---------|
| Granularity | One instruction | Full transaction(s), multi-ix |
| State setup | Hand-built `Account`s | Airdrop, deploy, real txns |
| CU assertion | **Exact**, per instruction | `compute_units_consumed`, per tx |
| Account assertion | **Byte-exact `Check`s** | Read account, assert manually |
| PDA lifecycle / CPI chains | Awkward | Natural |
| `init_if_needed` reinit | Can't model two txns | The right tool |
| Speed | Fastest | Fast |

Rule: if the assertion is "this *instruction* consumes N CU / leaves the account in exactly this state / rejects this exact bad input," it's Mollusk. If the assertion spans more than one instruction or a real signed transaction, it's [litesvm-integration.md](litesvm-integration.md).

## Pitfalls

- **No `.so` → panic on `Mollusk::new`.** Run `cargo build-sbf` before `cargo test`. CI must build SBF first.
- **`compute_units(n)` is exact.** A one-CU drift (e.g., a new feature gate) fails the test. That is the point; update the pin deliberately, never blindly.
- **Input accounts must include every referenced pubkey**, including read-only sysvars you pass explicitly. A missing account surfaces as a loader error, not a clean failure.
- **Mollusk does not run a fee payer or recent blockhash.** There is no transaction; don't assert on signatures or fees here.

_Last verified: June 2026_
