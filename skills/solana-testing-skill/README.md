# solana-testing-skill

**Prove your Solana program is safe before mainnet.**

> **Extends**: [solana-dev-skill](https://github.com/solana-foundation/solana-dev-skill) — core Solana development (programs, frontend, security). This skill is the **testing depth** the core skill leaves open. It sits *downstream* of the static auditors (Trail of Bits, QEDGen, safe-solana-builder): they surface candidate bugs; this skill writes the test that reproduces each and **gates CI on it** — the dynamic-execution tier nothing else in the kit owns.

A progressively-loaded skill for Claude Code / Codex that turns any coding agent into a Solana test engineer. It builds the whole testing pyramid — Mollusk unit tests, LiteSVM integration tests, Trident fuzzing, invariant/property testing, compute-unit regression gates, SBF coverage, and CI — and maps each layer to the **real bug classes that drain funds**.

## The problem

Most Solana exploits that lost money — missing signer checks, `init_if_needed` reinitialization, unchecked arithmetic, account substitution, arbitrary CPI — are caught by a test that takes minutes to write. But the testing story is fragmented: the Foundation skill covers LiteSVM/Mollusk *basics*, nobody owns fuzzing, invariants, coverage, or CU gating, and the stack churns fast (LiteSVM vs the now-deprecated bankrun, Trident's TridentSVM rewrite, `cargo-llvm-cov` silently not working on SBF). Agents write a happy-path `it("works")` and call it tested.

This skill fixes that: it routes the agent to the right layer, makes it write the **negative test first** (the exploit), and refuses to claim "tested" without running it.

## What's included

| Component | Contents |
|-----------|----------|
| **Tool** (`tools/soltest-gen`) | Zero-dep Node CLI: Anchor IDL → full adversarial test suite (missing-signer / wrong-owner / reinit / overflow per instruction) + Trident invariants + CI + a **Mainnet-Readiness report**. **Verified runnable.** |
| **Skill** (`skill/`) | `SKILL.md` router + 13 progressive reference files: testing pyramid, bug-class playbook, test generation, Mollusk, LiteSVM, Trident fuzzing, invariants, CU benchmarking, coverage, Anchor harness, TS/kit, CI, resources |
| **Agents** (`agents/`) | `test-author` (writes/repairs tests without weakening assertions), `fuzz-engineer` (designs fuzz targets, encodes invariants, triages crashes) |
| **Commands** (`commands/`) | `/readiness-gate`, `/scaffold-tests`, `/fuzz-program`, `/add-cu-bench`, `/check-coverage` |
| **Rules** (`rules/`) | `rust-testing.md` — auto-loaded test-quality constraints |
| **Examples** (`examples/`) | `invariant-poc` (pure-logic + proptest, **verified runnable**) and `vault-poc` (real native program + Mollusk tests, **compiles to SBF**) |
| **CI** (`.github/workflows`) | Runs both examples + the generator on every push — public, reproducible proof |

## Installation

```bash
# Standard — installs to ~/.claude/skills, clones core solana-dev skill if missing
./install.sh

# Interactive — choose location, core install, and project agents/commands/rules
./install-custom.sh
```

Or point your kit at this repo as a submodule under `.claude/skills/`.

## Default stack (June 2026)

| Layer | Tool | Version |
|-------|------|---------|
| Unit | `mollusk-svm` | 0.13.x |
| Integration | `litesvm` (crate / npm) | 0.13.x / 1.2.x |
| Fuzzing | Trident (`trident-cli`) | 0.12 stable / 0.13-rc |
| CU regression | `mollusk-svm-bencher` | 0.13.x |
| Mainnet-fork E2E | Surfpool | 1.4.x |
| Client SDK | `@solana/kit` | 6.x |
| Coverage | `sbpf-coverage` / `anchor-coverage` | DWARF-based |

> `solana-bankrun` is **deprecated** — this skill uses LiteSVM. Dev-deps are the modular `solana-*` crates, not monolithic `solana-sdk`. `cargo-llvm-cov` does **not** target SBF.

## Agents

| Agent | Model | Purpose |
|-------|-------|---------|
| `test-author` | sonnet | Writes/repairs Mollusk/LiteSVM/TS tests; turns red green without weakening the assertion |
| `fuzz-engineer` | opus | Designs Trident targets, encodes money invariants, minimizes & triages crashes |

## Commands

| Command | Description |
|---------|-------------|
| `/scaffold-tests` | Detect the program, generate Mollusk + LiteSVM skeletons with negative tests stubbed |
| `/fuzz-program` | Set up Trident, derive targets from the IDL, scaffold flows + money invariants |
| `/add-cu-bench` | Add a `mollusk-svm-bencher` benchmark + the CI step that diffs CU deltas |
| `/check-coverage` | Run SBF coverage, flag whether tests reach the security-critical branches |

## Usage examples

```
> scaffold tests for my Anchor escrow program
> what should I test so this withdraw can't be drained?
> fuzz this program for invariant violations before the audit
> my compute units jumped — add a regression bench and gate it in CI
```

## Repository structure

```
solana-testing-skill/
├── skill/
│   ├── SKILL.md                 # router / entry point
│   ├── testing-pyramid.md       bug-class-playbook.md
│   ├── mollusk-unit.md          litesvm-integration.md
│   ├── trident-fuzzing.md       invariant-testing.md
│   ├── cu-benchmarking.md       coverage.md
│   ├── anchor-harness.md        ts-testing-kit.md
│   ├── ci-harness.md            resources.md
├── agents/        test-author.md, fuzz-engineer.md
├── commands/      scaffold-tests.md, fuzz-program.md, add-cu-bench.md, check-coverage.md
├── rules/         rust-testing.md
├── examples/      invariant-poc/ (verified), vault-poc/ (SBF)
├── install.sh     install-custom.sh
├── EVAL_REPORT.md README.md  LICENSE (MIT)
```

## Proof it works

See [EVAL_REPORT.md](EVAL_REPORT.md) for captured test output: `invariant-poc` runs green
and `proptest` shrinks the vault bug to a minimal counterexample (`caller = 2, amount = 1`);
`vault-poc` compiles to SBF and its Mollusk negative test passes on the fixed build.

## License

MIT — see [LICENSE](LICENSE). Built for the [Solana AI Kit](https://github.com/solanabr/solana-ai-kit) bounty.
