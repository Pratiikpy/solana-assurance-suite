# vault-poc — a real on-chain bug, caught by a Mollusk test

A minimal **native** Solana program (no Anchor) that compiles to SBF, with a
vulnerable and a fixed variant of a `Withdraw` instruction, tested with
[Mollusk](../../skill/mollusk-unit.md).

The signer check in `src/lib.rs` is gated behind `#[cfg(not(feature = "vuln"))]`:

| Build | Signer check | `unsigned_withdraw_is_rejected` |
|-------|--------------|---------------------------------|
| default (fixed) | present | **passes** (returns `MissingRequiredSignature`) |
| `--features vuln` | removed | **fails** (the attacker drains the vault) |

That contrast is the whole point: the test is what makes the check load-bearing.
Delete the check and a test goes red — exactly what you want in CI.

## Run it

```bash
# Toolchain-free: load the committed compiled program and run the Mollusk tests
SBF_OUT_DIR=./fixtures cargo test

# Or build from source (uses the installed platform-tools)
cargo build-sbf --tools-version v1.54   # writes target/deploy/vault_poc.so
SBF_OUT_DIR=./target/deploy cargo test

# Prove the test catches the bug: rebuild without the signer check
cargo build-sbf --tools-version v1.54 --features vuln
SBF_OUT_DIR=./target/deploy cargo test   # unsigned_withdraw_is_rejected now FAILS
```

The compiled `fixtures/vault_poc.so` is committed so reviewers can run the tests with no
Solana toolchain. Mollusk loads the program from `SBF_OUT_DIR` and runs it in the
in-process SVM. Verified output is in [../../EVAL_REPORT.md](../../EVAL_REPORT.md).

## What the tests assert

- `authorized_withdraw_succeeds` — authority signs; vault debited and recipient credited
  by exactly `AMOUNT` (`Check::account(..).lamports(..)`), conserving lamports.
- `unsigned_withdraw_is_rejected` — the exploit: the real authority's pubkey is passed
  as a **non-signer**. Asserted with `Check::err(ProgramError::MissingRequiredSignature)`.

Captured output is in [../../EVAL_REPORT.md](../../EVAL_REPORT.md). Bug-class mapping:
[../../skill/bug-class-playbook.md](../../skill/bug-class-playbook.md).
