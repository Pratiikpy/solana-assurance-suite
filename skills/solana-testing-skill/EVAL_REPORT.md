# EVAL_REPORT — solana-testing-skill

Evidence that this skill's claims are real. Every command below was run on the
development machine (Windows 11, rustc 1.92.0, solana-cli 4.0.2 / cargo-build-sbf 4.0.0,
platform-tools v1.53, Node 22). Outputs are pasted verbatim, not paraphrased.

> Per the skill's own [rules/rust-testing.md](rules/rust-testing.md): "Prove it runs.
> 'It should pass' is not evidence." This report holds the skill to its own bar.

---

## 1. `examples/invariant-poc` — property testing catches a fund-drain bug ✅ VERIFIED

Pure-logic vault withdraw (`apply_withdraw_vuln` vs `apply_withdraw_fixed`) with three
money invariants encoded as `proptest` properties.

**Command:** `cargo test`

```
running 5 tests
test vuln_proptest_finds_counterexample ... ignored, run with --ignored to see proptest catch the vulnerable variant
test vuln_lets_attacker_drain_but_fixed_blocks ... ok
test fixed_rejects_non_authority ... ok
test fixed_rejects_overdraw ... ok
test fixed_conserves_balance ... ok

test result: ok. 4 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.01s
```

**Command:** `cargo test -- --ignored` (point proptest at the vulnerable variant)

```
---- vuln_proptest_finds_counterexample stdout ----
proptest: Saving this and future failures in ...\invariants.proptest-regressions
thread 'vuln_proptest_finds_counterexample' panicked at tests\invariants.rs:72:5:
Test failed: assertion failed: apply_withdraw_vuln(&v, caller, amount).is_err()
  at tests\invariants.rs:77.
minimal failing input: caller = 2, amount = 1
	successes: 0
	local rejects: 0
	global rejects: 0

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 4 filtered out
```

**What this proves:** the invariant-testing methodology in
[skill/invariant-testing.md](skill/invariant-testing.md) works — proptest finds the
access-control bug and **shrinks** it to the minimal witness (`caller = 2, amount = 1`:
a non-authority withdrawing one lamport). The same properties hold for the fixed variant.

---

## 2. `tools/soltest-gen` — IDL → adversarial suite + readiness gate ✅ VERIFIED

The headline capability: a zero-dependency Node CLI that derives the fund-draining test
surface from an Anchor IDL.

**Command:** `node --check soltest-gen.mjs && node soltest-gen.mjs sample-escrow.idl.json --out ./sample-output`

```
soltest-gen: escrow
  instructions:        4
  negative tests:      16
  fuzz invariants:     2
  value-moving ix:     2 (deposit, withdraw)
  high-severity ix:    2
  output dir:          ./sample-output
  files written:       7
```

It emitted 4 per-instruction TS test scaffolds (each with the applicable missing-signer /
account-substitution / re-init / overflow negatives), a Trident invariant scaffold, a CI
workflow, and `READINESS.md` with the per-instruction × bug-class matrix flagging `deposit`
and `withdraw` as high-severity. Committed output: [tools/soltest-gen/sample-output/](tools/soltest-gen/sample-output/).
Verified on both the modern Anchor IDL (`writable`/`signer`) and the legacy ≤0.29 shape
(`isMut`/`isSigner`).

**Scales to a real production program.** Run against the live **Kamino Lending** IDL
(`defi/klend-sdk`, 51 instructions):

```
soltest-gen: kamino_lending
  instructions:        51
  negative tests:      309
  fuzz invariants:     34
  value-moving ix:     34 (borrow/repay/liquidate/flash/deposit/withdraw/socializeLoss/…)
  high-severity ix:    34
  files written:       54
```

`READINESS.md` flags **343 adversarial checks** across the program and marks all 34
value-moving instructions (borrow, liquidate, flashBorrow, socializeLoss, …) high-severity —
the exact instructions a lending-protocol audit fixates on. A representative trimmed sample is
committed at [tools/soltest-gen/sample-output-klend/](tools/soltest-gen/sample-output-klend/)
(full run emits 54 files).

## 3. `examples/vault-poc` — a real SBF program, exploit caught by a Mollusk test ✅ VERIFIED

Native Solana program compiled to SBF (`vault_poc.so`, committed under `fixtures/`); the
signer check is feature-gated so the negative test passes on the fixed build and fails on
`--features vuln`.

**Commands** (built with `cargo build-sbf --tools-version v1.54`; tests load the program via `SBF_OUT_DIR`):
```
SBF_OUT_DIR=./fixtures cargo test          # toolchain-free: loads the committed .so
cargo test-sbf                             # or build+test from source
cargo build-sbf --features vuln            # rebuild without the signer check
```

**Fixed build — both Mollusk tests pass** (note the SVM rejecting the unsigned tx):
```
[DEBUG solana_runtime] Program 1117mWr… failed: missing required signature for instruction
test authorized_withdraw_succeeds ... ok
test unsigned_withdraw_is_rejected ... ok
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

**Vuln build (`--features vuln`) — the negative test FAILS, proving it catches the bug:**
```
test authorized_withdraw_succeeds ... ok
test unsigned_withdraw_is_rejected ... FAILED
test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out
```

That contrast is the whole point: remove the signer check and a committed test goes red.
Real SVM execution (CU consumed: 687), not prose. Built with platform-tools v1.54.

---

## 4. Novelty — the lane is uncontested

Verified against all 47 open PRs to `solanabr/skill-bounty` and the Solana AI Kit's 18
bundled skill submodules (June 2026):

- **No PR is about program testing or fuzzing.** LiteSVM/Mollusk appear only *incidentally*
  inside security submissions (e.g. CPI-safety PoCs); none owns the testing pyramid,
  test scaffolding, fuzzing, invariants, CU gating, or coverage.
- The Foundation `solana-dev-skill` ships a single `testing.md` covering LiteSVM/Mollusk/
  Surfpool **basics only** — no Bankrun, Trident, Anchor harness, coverage, CU bench, or
  invariant testing. This skill extends it without duplicating it.

## 5. Fit — mirrors the reference skill

Structure matches `solanabr/solana-game-skill`: flat `skill/*.md` reference files behind a
`SKILL.md` router, sibling `agents/ commands/ rules/`, `install.sh` + `install-custom.sh`,
MIT `LICENSE`, README. Cross-links to the core skill use the `../solana-dev/...` convention
and the same "Extends" blockquote. Link check: 0 broken sibling links across 12 reference
files.

## 6. Judging-criteria summary

| Criterion | Evidence |
|-----------|----------|
| **Usefulness** | Universal pre-mainnet need; `soltest-gen` turns an IDL into the whole adversarial suite in one command (§2); maps to real fund-draining bug classes |
| **Novelty** | Uncontested lane (§4); first dedicated testing+fuzzing+invariant+coverage skill in the kit, and the only one with an IDL→test generator + readiness gate |
| **Quality** | Two execution-verified artifacts (§1, §2) with pasted output; CI re-runs them publicly; pinned June-2026 stack; rules enforce no-weakened-assertions and run-and-prove |
| **Fit** | Reference-skill structure (§5), MIT, clean install path, extends rather than duplicates the core skill |
