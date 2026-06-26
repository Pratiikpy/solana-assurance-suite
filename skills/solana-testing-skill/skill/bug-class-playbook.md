# Bug-Class Playbook — Write the Exploit as a Failing Test First

This is the cross-domain spine of the skill. Every fund-draining Solana bug class maps to **one** test layer and **one** assertion that catches it. The methodology is not "write tests for coverage" — it is **encode the exploit as a failing test, watch it pass against the vulnerable code, then confirm it fails (rejects) against the fix.** A test that never failed on the vulnerable program proves nothing.

Each class below names the layer that owns it. Pick the layer by the shape of the assertion, not the bug's name: single-instruction reject → [mollusk-unit.md](mollusk-unit.md); multi-ix / CPI / lifecycle → [litesvm-integration.md](litesvm-integration.md); "no input sequence breaks this" → [trident-fuzzing.md](trident-fuzzing.md) + [invariant-testing.md](invariant-testing.md); cost ceiling → [cu-benchmarking.md](cu-benchmarking.md); "did the test actually reach the branch" → [coverage.md](coverage.md). Runnable proof lives in `examples/vault-poc/` (missing-signer / access-control, on-chain SBF + Mollusk) and `examples/invariant-poc/` (conservation/overflow/authority, pure-logic + proptest).

## Map

| # | Bug class | Catching layer | Assertion |
|---|-----------|----------------|-----------|
| 1 | Missing SIGNER check | Mollusk negative | `Check::err(MissingRequiredSignature)` on `is_signer=false` |
| 2 | Missing OWNER check / account substitution | Mollusk/LiteSVM negative + Trident | reject wrong-owner / wrong-PDA look-alike |
| 3 | Authority / access-control bypass | LiteSVM negative + Trident invariant | non-authority tx fails; "only X mutates Y" |
| 4 | Arithmetic overflow / underflow | Trident fuzz + Mollusk edge | `checked_*` path hit; reject at `0`/`MAX`; balance conserved |
| 5 | Balance/supply conservation, unauthorized mint | Trident invariant | `sum(balances)==initial`; total supply unchanged |
| 6 | `init_if_needed` re-initialization | LiteSVM/Mollusk | 2nd init fails or is idempotent (state not reset) |
| 7 | Arbitrary CPI / program-id confusion | LiteSVM integration + Trident | malicious target program id is rejected |
| 8 | PDA seed / bump confusion | Mollusk/LiteSVM negative | non-canonical bump rejected |
| 9 | CU regression (DoS) | `mollusk-svm-bencher` CI diff | CU delta within budget; worst-case < ceiling |
| 10 | Coverage blind spot | `sbpf-coverage` | vulnerable branch shows as covered |

## Per-class detail

### 1. Missing SIGNER check
The authority account is referenced but the program never asserts `is_signer`. Anyone passes the real authority's pubkey unsigned and drains it. **Catches:** [mollusk-unit.md](mollusk-unit.md). **Recipe:** build the withdraw ix with `AccountMeta::new_readonly(authority, false)`, run against the program, assert `Check::err(ProgramError::MissingRequiredSignature)` (or the program's custom `Unauthorized`). Confirm it *passes-when-it-shouldn't* on the vulnerable variant in `examples/vault-poc/`, then rejects on the fix.

### 2. Missing OWNER check / account substitution
The program reads an account's data without checking `account.owner == expected_program`. An attacker passes a look-alike account they own (or a PDA derived for a different program) carrying forged data. **Consequence:** the spoofed-account pattern behind numerous drain exploits — trust the bytes, not the owner. **Catches:** [mollusk-unit.md](mollusk-unit.md) for the targeted reject; [trident-fuzzing.md](trident-fuzzing.md) finds it blind by randomizing account addresses through the registry. **Recipe (unit):** construct the substitute account with `owner = Pubkey::new_unique()` (wrong program), feed it where the real one belongs, assert reject. **Recipe (fuzz):** let Trident swap addresses across flows; a conservation `assert!` fires when forged state moves value.

### 3. Authority / access-control bypass
A privileged path (set-admin, pause, fee withdraw) checks the wrong key, an `Option` that defaults open, or a stale config. **Catches:** [litesvm-integration.md](litesvm-integration.md) for the multi-account negative; [invariant-testing.md](invariant-testing.md) for the standing rule. **Recipe (negative):** sign the privileged ix with a non-authority keypair, assert the tx fails. **Recipe (invariant):** "only the recorded `authority` can mutate `config`" — in a Trident flow, attempt the mutation as a random fuzzed signer and `assert!` the protected field is unchanged unless the signer matched.

### 4. Arithmetic overflow / underflow
`a + b`, `a - b`, `a * b` on `u64`/`i64` wrap (release builds **do not** panic). Underflowing a balance to near-`u64::MAX` mints value from nothing; overflowing a share count dilutes everyone. **Catches:** [trident-fuzzing.md](trident-fuzzing.md) drives inputs to `0`/`MAX`/off-by-one; [mollusk-unit.md](mollusk-unit.md) pins named edge values. **Recipe (unit):** craft deposit then withdraw `amount+1`, assert reject (the `checked_sub` `None` path). **Recipe (fuzz):** bind every amount via `random_from_range`, pair with the balance-conservation invariant (#5) so any wrap is caught even where there's no explicit error. See `examples/invariant-poc/`.

### 5. Balance / supply conservation & no-unauthorized-mint
The master money invariant: value is neither created nor destroyed except by authorized mint/burn. **Consequence:** the entire class of "inflation bug" drains — rounding that credits more than debits, double-credit on retry. **Catches:** [invariant-testing.md](invariant-testing.md) via [trident-fuzzing.md](trident-fuzzing.md). **Recipe:** snapshot `initial = sum(all token/lamport balances)` in `#[init]`; after every flow and in `#[end]`, `assert!(sum(balances) == initial)` for transfer flows, and `assert!(total_supply == prev_supply)` unless the flow was an authorized mint/burn (then assert the exact expected delta). This single invariant catches #2, #4, and #7 when they actually move value.

### 6. `init_if_needed` re-initialization
An init handler (or Anchor `init_if_needed`) that can run twice and **resets state** on the second call. **Consequence:** the `init_if_needed`-on-ATA pattern behind the Nirvana-style reinit risk — an attacker re-initializes an already-funded account, zeroing an authority or reopening a closed vault. **Catches:** [litesvm-integration.md](litesvm-integration.md) (models two real transactions); [mollusk-unit.md](mollusk-unit.md) if expressible as two single-ix runs over carried state. **Recipe:** run init → mutate/fund → run init again; assert the second either **fails** (`AccountAlreadyInitialized` / already-in-use) **or** is provably idempotent (read the account; assert the authority and balance fields are unchanged, not reset to defaults).

### 7. Missing CPI guards / arbitrary CPI / program-id confusion
The program does a CPI to a program id taken from an account/arg without checking it equals the expected program (e.g. `token_program` not pinned to the real SPL Token id). An attacker substitutes a malicious program that fakes success. **Catches:** [litesvm-integration.md](litesvm-integration.md) (real CPI dispatch) + Trident's CPI example in [trident-fuzzing.md](trident-fuzzing.md). **Recipe:** deploy a hostile stub program; invoke the target passing the stub's id as the CPI target; assert the guard rejects (`IncorrectProgramId` / custom). Then assert the happy path with the genuine program id still succeeds — a guard that also breaks the real path is not a fix.

### 8. PDA seed / bump confusion
The program accepts a caller-supplied bump instead of deriving the canonical one, or omits a seed, letting two distinct logical accounts collide or a non-canonical PDA pass validation. **Catches:** [mollusk-unit.md](mollusk-unit.md) / [litesvm-integration.md](litesvm-integration.md). **Recipe:** derive the account with `find_program_address` (canonical bump) for the happy path; then construct an address with a **non-canonical** bump (`create_program_address` with a different bump byte) and assert it is rejected. For seed confusion, pass an account derived from the wrong seed set and assert reject.

### 9. CU regression (DoS via cost blowup)
An instruction's compute grows until it nears the 200k per-ix budget; an attacker maximizes the costly branch (loop bound, account count) to make the instruction fail-by-cost — a cheap liveness DoS. **Catches:** [cu-benchmarking.md](cu-benchmarking.md). **Recipe:** bench the **worst-case** ix shape with `mollusk-svm-bencher`, `must_pass(true)`, commit the markdown report, and `git diff --exit-code` it in CI. The reviewable delta ("+18,420 CU on `swap`") forces every cost increase through code review before it ships.

### 10. Coverage blind spots
The exploit test exists but never actually reaches the vulnerable branch (wrong fixture, short-circuited guard) — a false green. **Catches:** [coverage.md](coverage.md). **Recipe:** run `sbpf-coverage` / `anchor-coverage` over the unit + fuzz suite and confirm the specific guarded line (the `require!`, the `checked_sub`, the owner check) shows as covered. `cargo-llvm-cov` does **not** work on the SBF target — use the DWARF-based tools. Treat an uncovered security branch as an untested branch regardless of how many tests "pass."

## Working order

1. Identify the class (this table). 2. Pick the layer by assertion shape. 3. Write the exploit as a test against the **vulnerable** code; watch it pass (the drain works) or the invariant fire. 4. Apply the fix; the same test now rejects / the invariant holds. 5. Run [coverage.md](coverage.md) to confirm the guard branch was reached. 6. Wire the negative test + fuzz target + CU bench into CI so the bug can never silently return. Tool basics in [testing.md](../solana-dev/references/testing.md).

_Last verified: June 2026_
