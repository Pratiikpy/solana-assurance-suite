# LiteSVM — Integration Testing

The middle of the pyramid. LiteSVM is a **full in-process SVM**: it runs real, signed transactions with one or many instructions, CPIs, PDAs, rent, and sysvars — without a validator process. It is the modern replacement for both `solana-test-validator` (too slow, network-bound) and the now-**deprecated** `solana-bankrun` (bankrun's maintainer folded its capabilities into LiteSVM). Use it for anything that spans more than one instruction: PDA lifecycle, CPI, `init_if_needed` reinitialization, multi-step flows where account state carries between transactions.

This file is Rust-focused. For the TypeScript path (`litesvm` npm + `@solana/kit`) see [ts-testing-kit.md](ts-testing-kit.md). For single-instruction CU/byte assertions drop to [mollusk-unit.md](mollusk-unit.md). Core-skill basics: [testing.md](../solana-dev/references/testing.md).

## Install

```toml
[dev-dependencies]
litesvm = "0.13.0"
anchor-litesvm  = "0.4.0"   # load Anchor programs / build Anchor ixs
litesvm-testing = "0.2.0"   # assertion + airdrop helpers
# modular solana-* deps used in tests:
solana-keypair = "2"
solana-pubkey  = "2"
solana-message = "2"
solana-signer  = "2"
solana-system-interface = "1"
solana-transaction = "2"
```

> **Version divergence.** The Rust crate is **`litesvm` 0.13.0**; the npm package is **`litesvm` 1.2.x**. They track the same engine but version independently — never assume the numbers match. Like Mollusk, deps are the modular `solana-*` crates, not `solana-sdk`.

## Core API

- **`LiteSVM::new()`** — fresh SVM with system + builtin programs loaded, rent/sysvars at genesis defaults.
- **`svm.airdrop(&pubkey, lamports) -> Result<...>`** — fund any account; no faucet, instant.
- **`svm.add_program_from_file(program_id, "target/deploy/x.so")`** — deploy a compiled SBF program at a fixed id. (`add_program(id, &bytes)` for in-memory bytes.)
- **`svm.send_transaction(tx) -> Result<TransactionMetadata, FailedTransactionMetadata>`** — execute a signed transaction. The `Ok` and `Err` payloads both carry `compute_units_consumed` and program logs.
- **`svm.get_account(&pubkey) -> Option<Account>`** — read post-state. `svm.set_account(&pk, account)` to plant arbitrary state.
- **`svm.latest_blockhash()`** — current blockhash for building transactions.
- **Time control:** `svm.warp_to_slot(slot)` jumps the slot; `svm.set_sysvar(&Clock { ... })` sets wall-clock/epoch for time-gated logic.
- **`svm.set_compute_budget(limit)`** — raise/lower the per-tx CU ceiling.
- **`svm.with_sigverify(false)`** — disable signature verification (builder method, returns `Self`) to test program logic without producing real signatures.

## Full transfer test

```rust
use litesvm::LiteSVM;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_message::Message;
use solana_signer::Signer;
use solana_system_interface::instruction::transfer;
use solana_transaction::Transaction;

#[test]
fn lamport_transfer() {
    let mut svm = LiteSVM::new();
    let from = Keypair::new();
    let to = Pubkey::new_unique();
    svm.airdrop(&from.pubkey(), 10_000).unwrap();

    let ix = transfer(&from.pubkey(), &to, 64);
    let tx = Transaction::new(
        &[&from],
        Message::new(&[ix], Some(&from.pubkey())),
        svm.latest_blockhash(),
    );
    svm.send_transaction(tx).unwrap();

    assert_eq!(svm.get_account(&to).unwrap().lamports, 64);
}
```

## PDA-lifecycle multi-instruction test

The pattern LiteSVM exists for: derive a PDA, run an init transaction, then a mutate transaction in the same SVM, asserting state carries across both.

```rust
use solana_pubkey::Pubkey;
use solana_instruction::{AccountMeta, Instruction};

#[test]
fn pda_init_then_update() {
    let mut svm = LiteSVM::new();
    let program_id = Pubkey::new_unique();
    svm.add_program_from_file(program_id, "target/deploy/my_program.so").unwrap();

    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();

    let (pda, _bump) = Pubkey::find_program_address(&[b"state", payer.pubkey().as_ref()], &program_id);

    // tx 1: initialize the PDA
    let init = Instruction::new_with_bytes(
        program_id, &[0],
        vec![
            AccountMeta::new(pda, false),
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new_readonly(solana_pubkey::Pubkey::default(), false), // system program
        ],
    );
    let tx = Transaction::new(&[&payer], Message::new(&[init], Some(&payer.pubkey())), svm.latest_blockhash());
    svm.send_transaction(tx).unwrap();
    assert!(svm.get_account(&pda).is_some(), "PDA not created");

    // tx 2: mutate it; state persists across transactions in the same svm
    let update = Instruction::new_with_bytes(
        program_id, &[1, 42],
        vec![AccountMeta::new(pda, false), AccountMeta::new_readonly(payer.pubkey(), true)],
    );
    let tx = Transaction::new(&[&payer], Message::new(&[update], Some(&payer.pubkey())), svm.latest_blockhash());
    let meta = svm.send_transaction(tx).unwrap();

    assert_eq!(svm.get_account(&pda).unwrap().data[0], 42);
    println!("update consumed {} CU", meta.compute_units_consumed);
}
```

## `init_if_needed` reinitialization — negative test

`init_if_needed` is a classic reentry/reinit hole: calling the init instruction twice can silently reset state (zeroing balances, resetting an authority) if the program doesn't guard an "already initialized" flag. The test calls init **twice** and asserts the second call either fails or is a no-op — never a reset.

```rust
#[test]
fn second_init_does_not_reset_state() {
    let mut svm = LiteSVM::new();
    let program_id = Pubkey::new_unique();
    svm.add_program_from_file(program_id, "target/deploy/my_program.so").unwrap();

    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    let (pda, _) = Pubkey::find_program_address(&[b"state", payer.pubkey().as_ref()], &program_id);

    let init_ix = || Instruction::new_with_bytes(
        program_id, &[0],
        vec![
            AccountMeta::new(pda, false),
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new_readonly(Pubkey::default(), false),
        ],
    );

    // first init succeeds, deposit some state
    let tx = Transaction::new(&[&payer], Message::new(&[init_ix()], Some(&payer.pubkey())), svm.latest_blockhash());
    svm.send_transaction(tx).unwrap();
    let after_first = svm.get_account(&pda).unwrap().data.clone();

    // second init: vulnerable code RESETS; fixed code must reject or no-op
    let tx = Transaction::new(&[&payer], Message::new(&[init_ix()], Some(&payer.pubkey())), svm.latest_blockhash());
    let res = svm.send_transaction(tx);

    match res {
        Err(_) => { /* fixed: reinit rejected */ }
        Ok(_) => assert_eq!(
            svm.get_account(&pda).unwrap().data, after_first,
            "init_if_needed reset existing state — reinitialization bug"
        ),
    }
}
```

Run it against the vulnerable build first: the `Ok` branch's `assert_eq!` fires, proving the bug. The fix makes the `Err` branch hit (or keeps state identical). See [bug-class-playbook.md](bug-class-playbook.md) for the full reinit class.

## CPI test sketch

Deploy **both** the caller and callee programs into the same SVM; the runtime resolves the inner invoke exactly as on-chain. For SPL Token as the callee, plant the token program with `set_account`/program bytes or use a token helper.

```rust
let mut svm = LiteSVM::new();
svm.add_program_from_file(caller_id, "target/deploy/caller.so").unwrap();
svm.add_program_from_file(callee_id, "target/deploy/callee.so").unwrap();
// build a tx whose ix targets caller_id and lists callee_id in its account metas;
// the inner CPI executes in-process and its CU rolls into compute_units_consumed.
let meta = svm.send_transaction(tx).unwrap();
assert!(meta.logs.iter().any(|l| l.contains("callee: ok")));
```

## Gotcha — LiteSVM is not an RPC node

LiteSVM models the **bank/SVM execution layer only**. It does **not** implement the RPC surface or validator-specific behavior: `getProgramAccounts` filters (memcmp/dataSize), `getMultipleAccounts`, transaction-status/confirmation semantics, gossip, leader scheduling, and address-lookup-table resolution at the network layer are not replicated. If your test depends on RPC query behavior, mainnet account state, or live programs (AMMs, oracles, real mints), use **Surfpool** (mainnet-fork) instead — routed via [ci-harness.md](ci-harness.md) → core `surfpool/overview.md`. LiteSVM is for *your program's execution logic*; Surfpool is for *the network around it*.

## Pitfalls

- **Build SBF first.** `add_program_from_file` needs `target/deploy/*.so` from `cargo build-sbf`; CI must build before testing.
- **Read both `Ok` and `Err` metadata.** A failed tx still returns logs + CU in `FailedTransactionMetadata` — invaluable for asserting *why* it failed.
- **Anchor programs:** use `anchor-litesvm` to load the program and build discriminator-correct instructions, rather than hand-encoding bytes.
- **Time-gated logic** won't advance on its own — call `warp_to_slot` / `set_sysvar(Clock)` explicitly; the clock does not tick between transactions.

_Last verified: June 2026_
