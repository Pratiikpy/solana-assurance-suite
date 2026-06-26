# invariant-poc — property testing catches a fund-drain bug

A pure-logic demonstration of the skill's spine: **extract the security-critical
decision into a plain function, then let `proptest` hammer it with thousands of
inputs.** No SBF, no validator — `cargo test` runs in seconds and works under
`cargo-llvm-cov`.

`src/lib.rs` has two variants of a vault withdraw:

- `apply_withdraw_vuln` — no authority check, unchecked subtraction (the bug).
- `apply_withdraw_fixed` — authority-gated + `checked_sub`.

`tests/invariants.rs` encodes three money invariants against the **fixed** variant
(authority-gated mutation, supply conservation, no overflow), a deterministic
exploit/contrast test, and one `#[ignore]`d test that points proptest at the
**vulnerable** variant.

## Run it

```bash
cargo test              # green: the fixed variant upholds every invariant
cargo test -- --ignored # red: proptest finds & shrinks the bug in the vuln variant
```

## Verified output (June 2026, rustc 1.92)

Default suite — green:

```
running 5 tests
test vuln_proptest_finds_counterexample ... ignored, run with --ignored to see proptest catch the vulnerable variant
test vuln_lets_attacker_drain_but_fixed_blocks ... ok
test fixed_rejects_non_authority ... ok
test fixed_rejects_overdraw ... ok
test fixed_conserves_balance ... ok

test result: ok. 4 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out
```

`--ignored` — proptest finds and **shrinks** the exploit to its minimal form:

```
---- vuln_proptest_finds_counterexample stdout ----
thread 'vuln_proptest_finds_counterexample' panicked at tests\invariants.rs:72:5:
Test failed: assertion failed: apply_withdraw_vuln(&v, caller, amount).is_err().
minimal failing input: caller = 2, amount = 1
test result: FAILED. 0 passed; 1 failed
```

`caller = 2, amount = 1` is the whole point: a non-authority (`2 != 1`) withdrawing
one lamport is the minimal proof that the vulnerable handler has no access control.
Add the signer check (the fixed variant) and the same property holds for every input.

See [../../skill/invariant-testing.md](../../skill/invariant-testing.md) for the
methodology and [../../skill/bug-class-playbook.md](../../skill/bug-class-playbook.md)
for the bug-class → test mapping.
