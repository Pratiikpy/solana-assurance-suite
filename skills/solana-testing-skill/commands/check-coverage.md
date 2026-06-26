---
description: Run SBF coverage with sbpf-coverage or anchor-coverage (NOT cargo-llvm-cov, which can't target SBF), report line/branch coverage, and flag whether tests reach the security-critical branches (auth checks, error paths). For extracted pure logic, use cargo-llvm-cov.
argument-hint: "[program crate, defaults to detected]"
---

Measure test coverage for the program at `$ARGUMENTS` (or the detected program). See `skill/testing-pyramid.md` and `skill/bug-class-playbook.md`.

## 1. Pick the right tool — SBF cannot be measured by cargo-llvm-cov
`cargo-llvm-cov` instruments the host target and **cannot target the SBF program**. For on-chain coverage use the SBF-aware tools:
```
# native / generic SBF programs
sbpf-coverage --manifest-path <program>/Cargo.toml

# Anchor programs
anchor-coverage           # runs the Anchor test suite under SBF coverage
```
Run the relevant one and capture line + branch coverage.

## 2. Report line/branch coverage
Summarize overall line% and branch% per file/instruction. Call out any instruction handler under, say, the team's threshold. Raw numbers without the security read in step 3 are not enough.

## 3. Flag security-critical branches explicitly
Coverage % alone hides the branches that matter. Inspect whether tests actually execute:
- **Authorization checks** — `is_signer`, owner asserts, authority/admin equality checks, PDA/bump verification. An uncovered auth branch is a finding even at 90% line coverage.
- **Error paths** — every `require!`/`return Err(...)`/`ProgramError::Custom` arm. If the only covered path is the happy one, the negative tests are missing.
- **Boundary/overflow guards** — checked-math failure arms, zero/empty/max handling.
List each security-critical branch and mark COVERED / NOT COVERED. For anything NOT COVERED, name the missing negative test and hand off to `test-author` to add it (with a specific-error assertion).

## 4. Pure logic extracted to host code
For pure logic factored out of the on-chain path (math, serialization, validation helpers) into a normal lib, run it under standard host coverage:
```
cargo llvm-cov --lib
```
This is correct here precisely because it is NOT SBF code. Report it separately so SBF and host coverage aren't conflated.

## 5. Report
Tool used, line/branch numbers, the COVERED/NOT-COVERED table for security-critical branches, and the concrete list of missing negative tests.
