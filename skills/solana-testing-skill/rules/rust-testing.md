# Rule: Solana Test Quality (auto-loaded)

These constraints apply whenever this skill writes or edits tests. They exist to stop the two failure modes that make tests worthless: **tests that can't fail**, and **happy-path-only suites that miss the exploit**.

## Never weaken an assertion to make a test pass
- If a test goes red, fix the program or the test's *setup* — never relax the assertion (`Check::success()` → removed, `assert_eq!` → `assert!(... .is_ok())`, exact CU → no CU). A green test that asserts nothing is worse than no test.
- Do not delete a failing test to unblock CI. Quarantine with `#[ignore]` + a TODO linking the issue, and report it.

## Every instruction gets a negative test
- For each instruction, write at least one **failure** test alongside the success test: wrong signer, wrong owner, wrong PDA, missing account, re-initialization, boundary arithmetic.
- Assert the *specific* error, not just "it errored." Use `Check::err(...)` / match on the program error variant. A test that passes when the program fails for the wrong reason is a false negative.

## Use the current stack — reject stale patterns
- LiteSVM/Mollusk over `solana-test-validator` for unit/integration. `solana-bankrun` is **deprecated** — do not introduce it; migrate to `litesvm`.
- Modular `solana-*` dev-deps (`solana-account`, `solana-pubkey`, `solana-instruction`, …), not monolithic `solana-sdk`.
- `@solana/kit` (6.x) in TS examples, never legacy `@solana/web3.js` 1.x.
- Trident for fuzzing (bundled TridentSVM) — never scaffold honggfuzz/AFL.

## Determinism
- Seeded keypairs / fixed PDAs, never `Keypair::new()` where the address is later asserted on. Control time with `warp_to_slot` / `set_sysvar(Clock)` rather than wall-clock.
- No network in unit/integration tests. Mainnet state only via Surfpool, isolated to an explicit E2E stage.

## Invariants are assertions, not comments
- The money invariants (supply conservation, no unauthorized mint, authority-gated mutation, no overflow) must be encoded as runnable `assert!`s in fuzz flows or property tests — never left as prose in a doc.

## Prove it runs
- Before claiming a test suite works, run it and paste the actual output. "It should pass" is not evidence. If the toolchain is missing, say so explicitly.
