# Invariant & Property-Based Testing for Solana

A unit test checks one input. An **invariant** is a property that must hold for *every* input, after *any* sequence of operations. For programs that hold value, the invariants are the spec — break one and funds move that shouldn't. This file is the conceptual spine of the skill: it defines the invariants every value-holding program must hold, and the two ways to assert them.

> The math/state-transition core of your handler is the part worth proving exhaustively. Extract it, property-test it on the host, and fuzz the full instruction with Trident — see [trident-fuzzing.md](trident-fuzzing.md).

## The money invariants

Each is a **runnable assertion**, not prose. If a program holds value and you cannot state these as `assert!`s over its state, you do not yet understand the program.

### 1. Supply conservation
The sum of all balances equals the initial total, after any sequence of operations. Value is moved, never created or destroyed (mint/burn excepted, and gated — see #2).

```rust
assert_eq!(state.vault_balance + state.users.values().sum::<u64>(), initial_total,
           "supply not conserved");
```

### 2. No unauthorized mint
Total token supply changes **only** via an authorized mint/burn instruction. Any other instruction must leave supply untouched.

```rust
if ix != Ix::Mint && ix != Ix::Burn {
    assert_eq!(after.total_supply, before.total_supply, "supply moved without mint/burn ix");
}
```

### 3. Authority-gated mutation
State changes only under the correct signer. The withdraw below is the canonical violation.

```rust
assert!(caller == state.authority || after == before, "state mutated by non-authority");
```

### 4. No overflow
All arithmetic uses `checked_*` and returns an error on overflow — it never wraps or panics in release.

```rust
let next = balance.checked_add(amount).ok_or(Err::Overflow)?;   // never `balance + amount`
```

### 5. Monotonicity (where required)
Quantities that must only move one direction — a replay nonce, a sequence number, a high-water mark — never decrease.

```rust
assert!(after.nonce >= before.nonce, "nonce went backwards");
```

## Two ways to assert invariants

**Inside Trident fuzz flows** — assert against real on-chain account state after fuzzed instruction sequences. Catches the full instruction path (deserialization, account checks, CPI). Slower per case, highest fidelity. See [trident-fuzzing.md](trident-fuzzing.md).

**With `proptest` on pure extracted logic** — pull the math and state-transition functions out of the on-chain handler so they run on the **host target** with no SBF build, no validator. Hundreds of thousands of cases per second, instant counterexamples, automatic shrinking. Lower fidelity (it tests the logic, not the wiring) but unbeatable for the arithmetic-and-state core.

Use both: `proptest` proves the math; Trident proves the math survives contact with the runtime.

## The extract-pure-logic pattern

The bridge between fast property tests and on-chain behavior is a **pure** function: takes the current state + the caller + the inputs, returns the next state or an error. No `AccountInfo`, no syscalls, no globals. The on-chain handler becomes a thin shell that deserializes accounts, calls the pure function, and serializes the result. The pure function is what you property-test.

```rust
cargo add --dev proptest   // current 1.x
```

### Runnable example — withdraw, vulnerable vs fixed

Reference implementation: `examples/invariant-poc/`.

```rust
#[derive(Clone, Copy, PartialEq, Debug)]
struct State { authority: u8, vault: u64, user: u64 }   // u8 "pubkey" stand-in for the example

#[derive(Debug, PartialEq)]
enum Err { Unauthorized, Overflow, Insufficient }

// VULNERABLE: no authority check, no conservation discipline beyond the move.
fn apply_withdraw_vuln(s: State, caller: u8, amount: u64) -> Result<State, Err> {
    let vault = s.vault.checked_sub(amount).ok_or(Err::Insufficient)?;
    let user  = s.user.checked_add(amount).ok_or(Err::Overflow)?;
    Ok(State { vault, user, ..s })                       // <-- anyone can drain the vault
}

// FIXED: authority gate + checked arithmetic.
fn apply_withdraw_fixed(s: State, caller: u8, amount: u64) -> Result<State, Err> {
    if caller != s.authority { return Err(Err::Unauthorized); }
    let vault = s.vault.checked_sub(amount).ok_or(Err::Insufficient)?;
    let user  = s.user.checked_add(amount).ok_or(Err::Overflow)?;
    Ok(State { vault, user, ..s })
}
```

```rust
#[cfg(test)]
mod props {
    use super::*;
    use proptest::prelude::*;

    // Same property runs against either variant. It encodes invariants #1 (conservation)
    // and #3 (authority). The vulnerable variant violates #3; the fixed one holds.
    fn check(f: impl Fn(State, u8, u64) -> Result<State, Err>) -> impl Fn(State, u8, u64) {
        move |s, caller, amount| {
            let before_total = s.vault as u128 + s.user as u128;
            if let Ok(after) = f(s, caller, amount) {
                // #1 conservation: total value is preserved across a successful withdraw
                prop_assert_eq!(after.vault as u128 + after.user as u128, before_total);
                // #3 authority: a successful state change implies the caller was the authority
                prop_assert!(caller == s.authority, "non-authority withdrew");
                Ok(())
            } else { Ok(()) }   // rejected ops can't violate invariants
        }
    }

    fn st() -> impl Strategy<Value = State> {
        (any::<u8>(), 0..=u64::MAX, 0..=u64::MAX)
            .prop_map(|(authority, vault, user)| State { authority, vault, user })
    }

    proptest! {
        #[test]
        fn fixed_holds(s in st(), caller in any::<u8>(), amount in any::<u64>()) {
            check(apply_withdraw_fixed)(s, caller, amount)?;   // PASSES
        }

        #[test]
        #[should_panic]   // demonstrates the property FINDS the bug
        fn vuln_fails(s in st(), caller in any::<u8>(), amount in any::<u64>()) {
            check(apply_withdraw_vuln)(s, caller, amount)?;    // FAILS: shrinks to caller != authority
        }
    }
}
```

`proptest` shrinks the failure in `vuln_fails` to a minimal counterexample — typically `caller != authority`, `amount` small but non-zero, `vault >= amount` — pinpointing the missing authority gate. The fixed variant passes for every input. The `#[should_panic]` wrapper is how you *prove the test has teeth*: a property that can't fail the vulnerable code is worthless (see the rule in `rules/rust-testing.md`).

> Run it, don't trust it. `cargo test` and paste the output: `fixed_holds` green, `vuln_fails` green-via-`should_panic`. A property test you didn't execute is a comment.

## Writing your own

1. Identify which of the five invariants apply (most value programs need #1, #3, #4; mints add #2; nonces/sequences add #5).
2. Extract the state transition into a pure `fn(State, caller, inputs) -> Result<State, Err>`.
3. Write a `proptest` that asserts the invariants over arbitrary inputs — and confirm it catches a deliberately broken variant before trusting it on the real one.
4. Promote the same invariants into Trident flows ([trident-fuzzing.md](trident-fuzzing.md)) so they're checked against the real runtime, with real account wiring, under random instruction ordering.

_Last verified: June 2026_
