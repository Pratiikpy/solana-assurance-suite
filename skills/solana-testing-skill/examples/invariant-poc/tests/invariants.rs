//! Property tests for the vault withdraw logic.
//!
//! The default `cargo test` run is GREEN: it proves the FIXED variant upholds the
//! money invariants for thousands of random inputs, and a deterministic test shows
//! the FIXED variant rejects exactly the cases the VULNERABLE variant accepts.
//!
//! The `#[ignore]`d test demonstrates property testing *finding and shrinking* the
//! bug in the vulnerable variant. Run it explicitly:
//!     cargo test -- --ignored
//! and proptest reports a minimal counterexample (a non-authority caller who drains).

use invariant_poc::{apply_withdraw_fixed, apply_withdraw_vuln, Vault, VaultError};
use proptest::prelude::*;

const AUTHORITY: u64 = 1;

proptest! {
    // INVARIANT 1 — authority-gated mutation: only the authority can withdraw.
    #[test]
    fn fixed_rejects_non_authority(caller in 0u64..10_000, amount in 0u64..1_000) {
        prop_assume!(caller != AUTHORITY);
        let v = Vault { authority: AUTHORITY, balance: 1_000 };
        prop_assert_eq!(apply_withdraw_fixed(&v, caller, amount), Err(VaultError::Unauthorized));
    }

    // INVARIANT 2 — supply conservation + no underflow: for an authorized withdraw of
    // an in-range amount, balance decreases by exactly `amount` (nothing created/destroyed).
    #[test]
    fn fixed_conserves_balance(balance in 0u64..u64::MAX, amount in 0u64..u64::MAX) {
        prop_assume!(amount <= balance);
        let v = Vault { authority: AUTHORITY, balance };
        let after = apply_withdraw_fixed(&v, AUTHORITY, amount).expect("authorized, in-range");
        prop_assert_eq!(after.balance, balance - amount);
        prop_assert_eq!(after.balance + amount, balance); // conservation
    }

    // INVARIANT 3 — no overflow: an over-balance withdraw is rejected, never wraps.
    #[test]
    fn fixed_rejects_overdraw(balance in 0u64..1_000, amount in 1_001u64..u64::MAX) {
        prop_assume!(amount > balance);
        let v = Vault { authority: AUTHORITY, balance };
        prop_assert_eq!(apply_withdraw_fixed(&v, AUTHORITY, amount), Err(VaultError::InsufficientFunds));
    }
}

/// Deterministic contrast: the exploit the vulnerable variant allows, and the fix
/// rejecting it. This is the "write the exploit as a failing test first" move from
/// skill/bug-class-playbook.md.
#[test]
fn vuln_lets_attacker_drain_but_fixed_blocks() {
    let v = Vault { authority: AUTHORITY, balance: 1_000 };
    let attacker = 999;

    // The vulnerable handler wrongly lets a non-authority withdraw.
    let drained = apply_withdraw_vuln(&v, attacker, 1_000).expect("vuln accepts attacker");
    assert_eq!(drained.balance, 0, "attacker drained the vault via the vulnerable handler");

    // The fixed handler rejects the exact same call.
    assert_eq!(
        apply_withdraw_fixed(&v, attacker, 1_000),
        Err(VaultError::Unauthorized),
        "fixed handler must reject a non-authority withdraw",
    );
}

/// Demonstrates proptest discovering the authority bug in the vulnerable variant.
/// Ignored by default so the committed suite stays green; run with `--ignored` to
/// watch proptest find and shrink a minimal counterexample.
#[test]
#[ignore = "run with --ignored to see proptest catch the vulnerable variant"]
fn vuln_proptest_finds_counterexample() {
    proptest!(|(caller in 0u64..10_000, amount in 0u64..1_000)| {
        prop_assume!(caller != AUTHORITY && amount > 0);
        let v = Vault { authority: AUTHORITY, balance: 1_000 };
        // FALSE claim under test: "the handler rejects non-authority withdrawals."
        // Holds for the fixed variant; the vulnerable variant violates it.
        prop_assert!(apply_withdraw_vuln(&v, caller, amount).is_err());
    });
}
