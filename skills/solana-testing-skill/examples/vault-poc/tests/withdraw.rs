//! Mollusk tests for the vault program.
//!
//! Run with `cargo test-sbf` (builds the program to SBF, then runs these on the host
//! against Mollusk's in-process SVM).
//!
//!   - `authorized_withdraw_succeeds`  — the happy path, with exact lamport assertions.
//!   - `unsigned_withdraw_is_rejected` — the EXPLOIT as a test: the attacker passes the
//!     real authority's pubkey but does not sign. On the FIXED build this fails with
//!     `MissingRequiredSignature`; build `--features vuln` and this test goes red,
//!     proving the signer check is load-bearing.

use mollusk_svm::{result::Check, Mollusk};
use solana_account::Account;
use solana_instruction::{AccountMeta, Instruction};
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;

const VAULT_START: u64 = 5_000_000;
const RECIPIENT_START: u64 = 1_000_000; // rent-exempt for a 0-byte account
const AMOUNT: u64 = 100_000;

struct Fixture {
    mollusk: Mollusk,
    program_id: Pubkey,
    vault: Pubkey,
    recipient: Pubkey,
    authority: Pubkey,
    accounts: Vec<(Pubkey, Account)>,
}

fn setup() -> Fixture {
    let program_id = Pubkey::new_unique();
    let mollusk = Mollusk::new(&program_id, "vault_poc");

    let vault = Pubkey::new_unique();
    let recipient = Pubkey::new_unique();
    let authority = Pubkey::new_unique();
    let system = Pubkey::default(); // system program id is all-zero bytes

    let accounts = vec![
        // vault is owned by our program so the program may debit it
        (vault, Account::new(VAULT_START, 0, &program_id)),
        (recipient, Account::new(RECIPIENT_START, 0, &system)),
        (authority, Account::new(1_000_000, 0, &system)),
    ];

    Fixture { mollusk, program_id, vault, recipient, authority, accounts }
}

fn withdraw_ix(f: &Fixture, amount: u64, authority_signs: bool) -> Instruction {
    Instruction::new_with_bytes(
        f.program_id,
        &amount.to_le_bytes(),
        vec![
            AccountMeta::new(f.vault, false),
            AccountMeta::new(f.recipient, false),
            AccountMeta::new_readonly(f.authority, authority_signs),
        ],
    )
}

#[test]
fn authorized_withdraw_succeeds() {
    let f = setup();
    let ix = withdraw_ix(&f, AMOUNT, true);
    f.mollusk.process_and_validate_instruction(
        &ix,
        &f.accounts,
        &[
            Check::success(),
            Check::account(&f.vault).lamports(VAULT_START - AMOUNT).build(),
            Check::account(&f.recipient).lamports(RECIPIENT_START + AMOUNT).build(),
        ],
    );
}

#[test]
fn unsigned_withdraw_is_rejected() {
    let f = setup();
    let ix = withdraw_ix(&f, AMOUNT, false); // authority present but NOT a signer
    f.mollusk.process_and_validate_instruction(
        &ix,
        &f.accounts,
        &[Check::err(ProgramError::MissingRequiredSignature)],
    );
}
