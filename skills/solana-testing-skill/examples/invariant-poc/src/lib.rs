//! Vault withdraw logic — the *pure* core of an on-chain handler, extracted so it
//! can be property-tested on the host target (fast, no SBF, works under cargo-llvm-cov).
//!
//! This is the "extract pure logic" pattern from skill/invariant-testing.md: the
//! security-critical decision (who may withdraw, how much) lives in a plain function
//! that a property test can hammer with thousands of inputs in milliseconds. The
//! on-chain instruction is then a thin shell that loads accounts and calls this.
//!
//! Two variants are provided so the test suite can *demonstrate* that property
//! testing catches the bug:
//!   - `apply_withdraw_vuln`  — the bug: no authority check, unchecked subtraction.
//!   - `apply_withdraw_fixed` — authority-gated + checked arithmetic.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Vault {
    /// The only identity allowed to withdraw.
    pub authority: u64,
    /// Lamports held by the vault.
    pub balance: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VaultError {
    /// Caller is not the vault authority.
    Unauthorized,
    /// Withdraw amount exceeds the balance (would underflow).
    InsufficientFunds,
}

/// VULNERABLE: mirrors the classic footguns — it never checks the caller against
/// `authority`, and it subtracts without `checked_sub`. Anyone can drain the vault,
/// and an oversized amount underflows (panics in debug, wraps in release).
pub fn apply_withdraw_vuln(v: &Vault, _caller: u64, amount: u64) -> Result<Vault, VaultError> {
    // BUG 1: missing authority check (account-substitution / access-control class).
    // BUG 2: unchecked arithmetic (overflow/underflow class).
    Ok(Vault { authority: v.authority, balance: v.balance - amount })
}

/// FIXED: gate on authority, then use checked arithmetic. This is what the
/// invariants below should hold for, for *any* input.
pub fn apply_withdraw_fixed(v: &Vault, caller: u64, amount: u64) -> Result<Vault, VaultError> {
    if caller != v.authority {
        return Err(VaultError::Unauthorized);
    }
    let balance = v
        .balance
        .checked_sub(amount)
        .ok_or(VaultError::InsufficientFunds)?;
    Ok(Vault { authority: v.authority, balance })
}
