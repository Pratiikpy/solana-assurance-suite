---
name: solana-testing
description: Prove a Solana program is safe before mainnet. Covers the full pre-deployment testing pyramid — Mollusk single-instruction unit tests, LiteSVM integration tests (Rust + TypeScript), Trident coverage-guided fuzzing, invariant/property testing, compute-unit regression benchmarking, SBF coverage, the Anchor test harness, and CI gating — mapped to the real bug classes that drain funds (missing signer/owner checks, init_if_needed reinit, arithmetic overflow, unauthorized mint, CPI confusion, account substitution). Extends solana-dev-skill: for writing programs (Anchor, Pinocchio) and core LiteSVM/Mollusk/Surfpool basics, delegates to the core skill; this skill owns the depth — fuzzing, invariants, coverage, CU gates, and the bug-class→test playbook.
user-invocable: true
---

# Solana Testing — Prove It Before Mainnet

> **Extends**: [solana-dev-skill](../solana-dev/SKILL.md) — Core Solana development (programs, frontend, security). The core skill introduces LiteSVM, Mollusk, and Surfpool basics; **this skill owns the depth**: fuzzing, invariants, coverage, CU regression gates, the Anchor/TS harnesses, CI, and the bug-class → test mapping.

A test you didn't write is an exploit someone else will. Most Solana hacks that drained funds — missing signer checks, `init_if_needed` reinitialization, unchecked arithmetic, account substitution, arbitrary CPI — are caught by a test that takes minutes to write. This skill turns any coding agent into a Solana test engineer that builds the **whole pyramid**, not just a happy-path `it("works")`.

## What This Skill Is For

Use this skill when the user asks for:

### Generating the whole suite at once
- Turn an Anchor IDL into the full adversarial test suite + a Mainnet-Readiness report → [test-generation.md](test-generation.md) (`tools/soltest-gen`)

### Writing & scaffolding tests
- Unit-testing a single instruction with exact account/CU assertions → [mollusk-unit.md](mollusk-unit.md)
- Integration-testing multi-instruction flows, PDAs, CPI → [litesvm-integration.md](litesvm-integration.md)
- TypeScript client/program tests → [ts-testing-kit.md](ts-testing-kit.md)
- The Anchor test workflow (`anchor test`, mocha/litesvm template) → [anchor-harness.md](anchor-harness.md)

### Finding bugs you didn't think to test
- Coverage-guided fuzzing of an Anchor/native program → [trident-fuzzing.md](trident-fuzzing.md)
- Encoding money invariants (conservation, no-unauthorized-mint, authority) → [invariant-testing.md](invariant-testing.md)
- "Which test catches this exploit class?" → [bug-class-playbook.md](bug-class-playbook.md)

### Hardening the pipeline
- Compute-unit regression gates → [cu-benchmarking.md](cu-benchmarking.md)
- SBF code coverage (it is *not* `cargo-llvm-cov`) → [coverage.md](coverage.md)
- CI that fails the PR on a missing test → [ci-harness.md](ci-harness.md)

### Delegate to the core skill
- Writing the program itself (Anchor / Pinocchio) → [programs/anchor.md](../solana-dev/references/programs/anchor.md)
- LiteSVM / Mollusk / Surfpool *basics* and the `@solana/kit` client → [testing.md](../solana-dev/references/testing.md)
- Static security review of source → core `security.md` and the security-lane skills (Trail of Bits, safe-solana-builder)

> **This skill is dynamic testing** — it runs your program and asserts on real execution. It is **not** a static analyzer or auditor; it is the tier that proves the analyzer's findings and catches the bugs static analysis misses.

## Default Stack Decisions (Opinionated, June 2026)

1. **Unit layer → Mollusk** (`mollusk-svm` 0.13.x). One instruction, exact `Check`s, fastest feedback.
2. **Integration layer → LiteSVM** (Rust crate 0.13.x / npm `litesvm` 1.2.x). In-process SVM; replaces `solana-test-validator` and the now-**deprecated** `solana-bankrun`.
3. **Fuzz layer → Trident** (`trident-cli` 0.12 stable, 0.13-rc). Coverage-guided, bundles TridentSVM — no honggfuzz/AFL.
4. **CU regression → `mollusk-svm-bencher`**, committed markdown diffed in CI.
5. **Mainnet-state E2E → Surfpool** (1.4.x; now the default `anchor test` validator backend).
6. **Client SDK in examples → `@solana/kit`** (6.x). Never legacy `@solana/web3.js` 1.x for new code.
7. **Coverage → DWARF trace mapping** (`sbpf-coverage` / `anchor-coverage`). `cargo-llvm-cov` does **not** work on the SBF target.

> Crate vs npm versions diverge: Rust `litesvm` is 0.13.x, npm `litesvm` is 1.2.x — do not conflate. Deps are the modular `solana-*` crates (`solana-account`, `solana-pubkey`, …), not monolithic `solana-sdk`. Any guide pinning `solana-sdk = "1.18"` is stale.

## Operating Procedure

### 1. Classify the test layer
Pick the cheapest layer that can catch the failure. Most assertions belong at the bottom.

| Layer | Use for | Skill file |
|-------|---------|------------|
| Unit (Mollusk) | One instruction; signer/owner/CU/account-state checks | [mollusk-unit.md](mollusk-unit.md) |
| Integration (LiteSVM) | Multi-ix flows, PDA lifecycle, CPI, `init_if_needed` reinit | [litesvm-integration.md](litesvm-integration.md) |
| Fuzz/invariant (Trident) | Unknown inputs; conservation, overflow, authority invariants | [trident-fuzzing.md](trident-fuzzing.md), [invariant-testing.md](invariant-testing.md) |
| Client (TS) | Instruction builders, account decoding, app integration | [ts-testing-kit.md](ts-testing-kit.md) |
| Mainnet-fork E2E (Surfpool) | Real on-chain state: live AMMs, oracles, mints | [ci-harness.md](ci-harness.md) → core `surfpool/overview.md` |

### 2. Pick the right agent
| Task | Agent | Model |
|------|-------|-------|
| Author/scaffold unit + integration tests, fix red tests | **test-author** | sonnet |
| Design fuzz targets, encode invariants, triage crashes | **fuzz-engineer** | opus |

### 3. Map the threat to a test
Before writing tests, run the program through [bug-class-playbook.md](bug-class-playbook.md): each fund-draining bug class maps to the exact layer + assertion that catches it. Write the **negative** test (the exploit) first, watch it fail on the vulnerable code, then confirm it passes on the fix.

### 4. Build the pyramid (bottom-heavy)
Mollusk units + CU bench → LiteSVM integration → Trident invariants → a few Surfpool E2E. See [testing-pyramid.md](testing-pyramid.md).

### 5. Gate it in CI
Tests that aren't enforced rot. Wire `cargo test` + CU-bench diff + a fuzz smoke run + coverage floor into CI: [ci-harness.md](ci-harness.md).

---

## Progressive Disclosure (Read When Needed)

Load one file at a time — do not read the whole skill up front.

### Strategy
- [testing-pyramid.md](testing-pyramid.md) — which layer, how many tests, in what order
- [bug-class-playbook.md](bug-class-playbook.md) — fund-draining bug → the test that catches it
- [test-generation.md](test-generation.md) — IDL → full adversarial suite + readiness gate (`tools/soltest-gen`)

### Unit & integration
- [mollusk-unit.md](mollusk-unit.md) — single-instruction harness, `Check`s, token helpers
- [litesvm-integration.md](litesvm-integration.md) — in-process SVM flows, PDAs, CPI, time travel
- [anchor-harness.md](anchor-harness.md) — `anchor test`, litesvm template, `anchor.toml`
- [ts-testing-kit.md](ts-testing-kit.md) — `litesvm` npm + `@solana/kit` client tests

### Fuzzing & invariants
- [trident-fuzzing.md](trident-fuzzing.md) — Trident setup, `#[flow_executor]`, running fuzz targets
- [invariant-testing.md](invariant-testing.md) — the money invariants + `proptest` for pure logic

### Pipeline
- [cu-benchmarking.md](cu-benchmarking.md) — `mollusk-svm-bencher`, regression diffs
- [coverage.md](coverage.md) — SBF coverage via DWARF (sbpf-coverage / anchor-coverage)
- [ci-harness.md](ci-harness.md) — GitHub Actions: test, bench, fuzz-smoke, coverage gate
- [resources.md](resources.md) — pinned versions, repos, docs

### Core Solana Dev Skills (from solana-dev-skill)
> Provided by [solana-dev-skill](../solana-dev/SKILL.md) — install if not present.
- [testing.md](../solana-dev/references/testing.md) — LiteSVM/Mollusk/Surfpool **basics**
- [programs/anchor.md](../solana-dev/references/programs/anchor.md) — writing Anchor programs
- [programs/pinocchio.md](../solana-dev/references/programs/pinocchio.md) — native/Pinocchio programs
- [security.md](../solana-dev/references/security.md) — static security checklist (pairs with this skill's dynamic tests)

---

## Task Routing Guide

| User asks about... | Primary skill file(s) |
|--------------------|----------------------|
| "test this instruction", CU assertion | mollusk-unit.md, cu-benchmarking.md |
| "test the whole flow", PDA, CPI, reinit | litesvm-integration.md |
| "fuzz it", "find edge cases", invariants | trident-fuzzing.md, invariant-testing.md |
| "is this exploitable / what should I test for" | bug-class-playbook.md |
| TypeScript / client / `@solana/kit` tests | ts-testing-kit.md |
| `anchor test` setup, mocha, anchor.toml | anchor-harness.md |
| coverage, "how much is tested" | coverage.md |
| CI, "fail the build if untested" | ci-harness.md |
| how many tests / which layer first | testing-pyramid.md |
| compute units too high / regressed | cu-benchmarking.md |
| **mainnet-fork test against a live pool** | ci-harness.md → solana-dev → surfpool/overview.md |
| **writing the program itself** | solana-dev → programs/anchor.md |
| **static audit of source code** | solana-dev → security.md (+ ToB/safe-solana-builder skills) |

---

## Commands

| Command | Description |
|---------|-------------|
| `/readiness-gate` | Run `tools/soltest-gen` on the IDL → adversarial suite + Mainnet-Readiness report; drive the 🔴→🟢 gate |
| `/scaffold-tests` | Detect the program (Anchor/native), generate a Mollusk+LiteSVM test skeleton with signer/owner/reinit negative tests stubbed |
| `/fuzz-program` | Set up Trident, derive fuzz targets from the IDL, scaffold flows + the core money invariants |
| `/add-cu-bench` | Add a `mollusk-svm-bencher` benchmark + the CI step that diffs the CU report |
| `/check-coverage` | Run SBF coverage (sbpf-coverage/anchor-coverage), report uncovered risky branches |

## Agents

| Agent | Purpose |
|-------|---------|
| **test-author** | Writes and repairs Mollusk/LiteSVM/TS tests; turns a red test green without weakening the assertion |
| **fuzz-engineer** | Designs Trident fuzz targets, encodes invariants, minimizes and triages crashing inputs |

## Worked Example

`examples/vault-poc/` is a **real, compiling** native Solana program with a vulnerable and a fixed variant of a withdraw instruction, plus Mollusk tests that **fail on the bug and pass on the fix** — runnable with `cargo test-sbf`. See [examples/vault-poc/README.md](../examples/vault-poc/README.md) and [EVAL_REPORT.md](../EVAL_REPORT.md) for captured output.
