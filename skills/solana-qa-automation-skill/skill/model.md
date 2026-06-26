# The Model — The Full Full-Stack web3 QA Pyramid

The 14-layer release-gating model, reverse-engineered from two production web3 monorepos (an Arbitrum/Stylus Rust+Foundry repo and an EVM/FHE pnpm repo) and mapped onto Solana. Every layer is **automated in CI**, emits **one manifest entry**, and is rolled up by a single release gate. Program-runtime correctness delegates to [../solana-testing](../solana-testing/SKILL.md); this skill owns everything around it.

Read order: this file (the model) → [release-gate.md](release-gate.md) (the roll-up) → per-layer files. The four columns that matter for every layer: **tools**, **CI trigger / how-automated**, **what gates release**, **chain-agnostic ↔ Solana mapping**.

## L0 — Static / lint / type

- **Tools**: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `tsc --noEmit`, ESLint (flat config), `scripts/check-banned-words.mjs`, voice/writing checkers.
- **CI**: one `lint` job, `runs-on: ubuntu-latest`, `timeout-minutes: 10`, `permissions: {contents: read}`. Shell steps run under `set -euo pipefail` so the first failure aborts.
- **Gates release**: any fmt diff, any clippy warning (`-D warnings` promotes warn→error), any tsc error, any ESLint error, any banned word. Hard-fail.
- **Solana mapping**: `cargo fmt`/`clippy` run on the **program crate** (`programs/<name>`), not Stylus crates; add `cargo clippy -p <program> --all-targets -- -D warnings` and `anchor build` (which surfaces IDL/macro lint). `tsc`/ESLint cover the SDK + frontend identically. See [static-lint.md](static-lint.md).

## L1 — Unit (frontend)

- **Tools**: Vitest (`vitest run`), node environment, `setupFiles` to stub `next/headers`.
- **CI**: `pnpm --filter <pkg> test`; `reporters: ['default','github-actions']` under `CI`.
- **Gates release**: any failing spec. Hard-fail.
- **Solana mapping**: unchanged — Vitest tests the wallet-adapter glue, PDA-derivation helpers, instruction builders, and API routes. The chain underneath is irrelevant to a unit test of the TS layer. See [unit-property.md](unit-property.md).

## L1 — Unit / property (contracts)

- **Tools**: `cargo test --workspace --all-features` + `proptest` (host-target property tests); Foundry `forge test` with `[fuzz] runs = 256, seed = "0xdeadbeef", max_test_rejects = 65_536`.
- **CI**: `test-rust` + `test-solidity` jobs; deterministic seed makes fuzz runs reproducible across CI and local.
- **Gates release**: any unit failure, any property counterexample, or a coverage regression below the ratcheting floor (`forge coverage --report lcov` parsed against a `FLOOR`).
- **Solana mapping**: the EVM `forge fuzz` / Stylus host `proptest` layer maps to **Mollusk single-instruction tests + LiteSVM integration + Trident coverage-guided fuzzing**, all delegated to [../solana-testing](../solana-testing/mollusk-unit.md). This file ([unit-property.md](unit-property.md)) keeps only the **frontend/services** unit + property slot; program-runtime fuzz/invariants leave the building.

## L1 — Formal

- **Tools**: **Kani** model-checking (`#[kani::proof]` harnesses, `cargo kani`) + a **proof-count anti-erosion gate** against `docs/kani-baseline.txt`. Halmos (EVM symbolic execution) in the source repo.
- **CI**: `kani` job, `timeout-minutes: 45`; harness-count gate runs under `set -euo pipefail`; per-crate `cargo kani` (workspace-excluded crates iterated individually).
- **Gates release**: any counterexample (`VERIFICATION:- FAILED`), **or** proof count dropping below baseline (delete a harness → red unless `kani-baseline.txt` is edited with a written reason).
- **Solana mapping**: Kani maps **directly** to a Solana program crate — pure-math/state-transition invariants (overflow, monotonicity, freshness predicates) prove identically on a `programs/<name>` crate. **Halmos is EVM-bytecode-only → drop on Solana** (no EVM, no symbolic SMT over SBF). See [formal.md](formal.md).

## L2 — Integration + indexer

- **Tools**: localnet (Anvil on EVM; **surfpool / `solana-test-validator`** on Solana), real Ed25519/secp256k1 signing; indexer guard scripts (`check-event-indexing.mjs`, `check-entity-writers.mjs`); subgraph `graph test` (matchstick) on Solana → mapping/parser tests.
- **CI**: `subgraph` job pinned to `ubuntu-22.04` (matchstick binary lags on 24); guard scripts run after codegen+build+test.
- **Gates release**: integration suite failure, or **indexer drift** — an emitted event/log with no writer, or an entity nobody indexes.
- **Solana mapping**: EVM event-log indexing → **Solana program-log / Anchor-event / account-change indexing** (Geyser, Helius webhooks, or a custom log parser). The guard becomes: every `emit!` / `msg!`-logged event has a parser, every indexed account has a writer. matchstick → your Solana indexer's unit tests. See [integration-indexer.md](integration-indexer.md).

## L3 — E2E (real wallet)

- **Tools**: **Playwright + Synpress 4.1+** driving a real wallet **browser extension** (Phantom on Solana / MetaMask on EVM). Dual mode: `local` asserts a *pending* state; `live` asserts a **finalized** signature.
- **CI**: gated e2e job; `live` mode runs against devnet/testnet with a funded throwaway key.
- **Gates release**: any flow failure (connect→unlock→approve→sign→send). In `live` mode the assertion is a **finalized tx signature** read back from chain — not a UI toast.
- **Solana mapping**: MetaMask→**Phantom**; `eth_sendTransaction`→`signAndSendTransaction`; `status=1` receipt→**`getSignatureStatuses` with `confirmationStatus: "finalized"`**; revert→`InstructionError`. The dual-mode pattern is identical. See [release-gate.md](release-gate.md) and the `/scaffold-e2e` command.

## L4 — Load + compute

- **Tools**: **k6** with thresholds (`http_req_duration p(95)<2000`, `http_req_failed rate<0.02`); a compute/budget probe treating **CU and rent as data**.
- **CI**: scheduled or pre-release load job; thresholds are pass/fail in k6's own exit code.
- **Gates release**: k6 threshold breach (p95 ≥ 2000ms or error-rate ≥ 0.02), or the program exceeding its CU/rent budget.
- **Solana mapping**: EVM gas budget → **compute-unit budget** (200k default / 1.4M max per ix) + **rent-exemption lamports** per account. The load target is the **RPC** (`sendTransaction`/`getAccountInfo` throughput) rather than a gas-priced mempool. CU regression benchmarking delegates to [../solana-testing](../solana-testing/cu-benchmarking.md).

## L5 — Lighthouse perf / a11y

- **Tools**: `@lhci/cli` (`lhci autorun --config=.lighthouserc.json`), `minScore 0.90`.
- **CI**: `frontend` job builds then runs LHCI mobile. Currently **soft-gated** (`|| echo "Lighthouse below threshold (soft-fail until prod URL)"`) with a dated TODO to harden once the prod URL is the LHCI target.
- **Gates release**: below 0.90 on perf/a11y/best-practices/SEO. **Soft-gate → harden**: warns now, will block once the prod URL lands. The dated TODO is the contract.
- **Solana mapping**: **fully chain-agnostic** — Lighthouse audits the rendered dApp, identical on any chain. No mapping needed. See [lighthouse-a11y.md](lighthouse-a11y.md).

## L6 — Security / secrets

- **Tools**: **gitleaks** (`gitleaks-action`, full history, `fetch-depth: 0`) + a **context-aware raw-key backstop** (`git grep` for `--private-key 0x<64hex>` and `*KEY*…0x<64hex>` in key contexts, path-excluding test/seed/`.env.example`) + `cargo-audit`.
- **CI**: `secrets-scan` job, `timeout-minutes: 5`. The backstop is a follow-up to a real incident (a deployer key leaked into a temp log).
- **Gates release**: any gitleaks finding or any raw-key literal in tracked source. Hard-fail.
- **Solana mapping**: EVM `0x`-prefixed hex private key / mnemonic → **base58 secret key + `id.json` byte-array keypair**. The backstop regex flips to catch a committed `id.json` (`[NNN,NNN,...]` 64-int array) and base58 secrets, plus `cargo-audit` on the program crate's deps. See [security-secrets.md](security-secrets.md).

## L7 — Uptime / keeper freshness / indexer drift

- **Tools**: **Upptime** (RPC health checks), keeper self-loop crons, indexer-drift reconciliation (`reconcile-chain-scribe.mjs`).
- **CI**: scheduled workflows (Upptime runs on its own cron); alerts via Discord webhook on `failure() && ref==main`.
- **Gates release**: **does not gate a PR** — this is **observability**, not a merge gate. It alerts (Discord/badge) and feeds the dashboard. In the manifest it is a **non-required** layer: a breach **warns without blocking**.
- **Solana mapping**: EVM `eth_blockNumber` liveness → **`getHealth` + slot-lag** (`getSlot` vs cluster). Keeper freshness → your crank/keeper's last-run timestamp. Indexer drift → on-chain account state vs indexed state. See [uptime-keeper.md](uptime-keeper.md).

## GATE — Release gate

- **Tools**: `node tools/qa-gate/qa-gate.mjs qa-manifest.json --report QA_PROOF.md` — a zero-dependency roll-up.
- **CI**: final job, `needs:` every layer; non-zero exit fails the PR.
- **Gates release**: **any required layer `fail` OR `skip` = no-go.** A skipped required layer is a gap, not a pass — you cannot ship what you did not test. Non-required layers (L7) warn only.
- **Evidence rule**: every claimed pass carries real evidence — a finalized on-chain signature (`status=1`/`finalized`), a screenshot, and the ground-truth read. A green badge with no CI run behind it is treated as **RED**. See [release-gate.md](release-gate.md).

## Layer roll-up

| Layer | Gates a PR? | Solana delta |
|-------|:-----------:|--------------|
| L0 static/lint/type | yes | clippy/fmt on program crate + `anchor build` |
| L1 unit-frontend | yes | none |
| L1 unit/property contracts | yes | → Mollusk/LiteSVM/Trident (solana-testing) |
| L1 formal | yes | Kani direct; **drop Halmos** |
| L2 integration+indexer | yes | surfpool; log/account indexing |
| L3 e2e real wallet | yes | Phantom; finalized-sig assertion |
| L4 load+compute | yes | RPC load; CU/rent budget |
| L5 lighthouse | soft→hard | none |
| L6 security/secrets | yes | base58/`id.json` backstop |
| L7 uptime/keeper | **no** (warn) | `getHealth`/slot-lag |
| GATE | — | required fail **or skip** = no-go |

## Cross-cutting principles (apply to every layer)

These are not layers — they are the rules every layer obeys, lifted from the source repos:

1. **A skipped required layer is a gap, not a pass.** The gate blocks on `skip` exactly as it blocks on `fail`. CI cannot quietly disable a job and ship green. Only L7 is non-required.
2. **Evidence-or-it-didn't-happen.** A claimed pass carries a real artifact: a finalized on-chain signature (`confirmationStatus: "finalized"`, no `InstructionError`), a screenshot at both viewports, and the ground-truth account read. A badge with no run URL behind it is RED.
3. **Honest-pending is a first-class state.** Surfaces return `pending`/`null`, never a fake zero. The e2e `local` mode asserts *pending*; `live` asserts *finalized* — they are different gates, not the same gate run twice.
4. **Anti-erosion baselines.** Two ratchets: the coverage floor (parsed from `lcov`, fails below `FLOOR`, only moves up) and the formal proof-count baseline (`docs/kani-baseline.txt`, can't silently drop). See [formal.md](formal.md).
5. **Least privilege + SHA-pinned CI.** Every action is pinned to a 40-char SHA; jobs declare `permissions:` explicitly (`{contents: read}` by default, widened only where a job must write — e.g. the Kani job opens a status PR). Secrets are scanned (L6); soft-gates (L5) carry a *dated* TODO to harden.

## How a layer becomes a manifest entry

Each CI job writes one entry — `{ layer, status: pass|fail|skip, required, evidence }` — and the final gate job (`needs:` all of them) rolls them up:

```jsonc
{ "layer": "L1-formal", "status": "pass", "required": true,
  "evidence": "https://github.com/org/repo/actions/runs/123#kani" }
```

The gate's verdict: **BLOCK** if any `required` entry is `fail` or `skip`; non-required breaches (L7) warn. This is the contract that makes the pyramid a *release gate* and not just a test suite. See [release-gate.md](release-gate.md).

See also: [static-lint.md](static-lint.md) · [unit-property.md](unit-property.md) · [formal.md](formal.md) · [release-gate.md](release-gate.md) · [../solana-testing](../solana-testing/SKILL.md).

_Last verified: June 2026_
