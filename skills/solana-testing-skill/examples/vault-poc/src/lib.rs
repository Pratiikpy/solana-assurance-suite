//! A minimal native Solana "vault" program for the solana-testing skill.
//!
//! One instruction — Withdraw(amount) — moves lamports from a program-owned vault
//! account to a recipient. The authority must sign.
//!
//! The signer check is gated behind `#[cfg(not(feature = "vuln"))]`. Build the
//! crate normally and the check is present (fixed); build with `--features vuln`
//! and it is gone (the classic missing-signer / access-control bug). The Mollusk
//! test in `tests/` asserts an unsigned withdraw fails — so it PASSES on the fixed
//! build and FAILS on the vuln build. The test is what makes the check load-bearing.

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    program_error::ProgramError,
    pubkey::Pubkey,
};

entrypoint!(process_instruction);

/// Accounts:
///   0. `[writable]`         vault      (owned by this program)
///   1. `[writable]`         recipient
///   2. `[signer]`           authority
/// Instruction data: 8 bytes, little-endian u64 `amount`.
pub fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let vault = next_account_info(iter)?;
    let recipient = next_account_info(iter)?;
    let authority = next_account_info(iter)?;

    let amount = u64::from_le_bytes(
        data.get(0..8)
            .ok_or(ProgramError::InvalidInstructionData)?
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );

    // ── Security check (access-control class) ──────────────────────────────
    // Present in the fixed build; removed under `--features vuln`. Without it,
    // anyone can pass the real authority's pubkey as a non-signer and drain.
    #[cfg(not(feature = "vuln"))]
    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let _ = authority; // silence unused warning under the vuln build

    // ── Checked transfer (overflow class) ──────────────────────────────────
    let mut vault_lamports = vault.try_borrow_mut_lamports()?;
    let mut recipient_lamports = recipient.try_borrow_mut_lamports()?;
    **vault_lamports = vault_lamports
        .checked_sub(amount)
        .ok_or(ProgramError::InsufficientFunds)?;
    **recipient_lamports = recipient_lamports
        .checked_add(amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    Ok(())
}
