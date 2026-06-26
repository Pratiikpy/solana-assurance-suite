# Resources — Pinned Index

Dated, pinned versions for everything this skill touches. Numbers drift; **verify against what is actually installed** (`npm ls`, `cargo tree`, `crates.io`) before trusting any line here. Items not confirmed against a primary source this cycle are marked **[unverified]**.

## Solana agent frameworks (the systems under eval)

### solana-agent-kit — SendAI
- **npm `solana-agent-kit` 2.0.10** (core package). Monorepo, pnpm workspaces + Turborepo; engines Node ≥22, pnpm ≥8. Apache-2.0.
- Composable plugin architecture (V2): `.use(Plugin)` merges plugin `methods` (programmatic) and `actions` (AI tools). Plugins: `@solana-agent-kit/plugin-token`, `-nft`, `-defi`, `-misc`, `-blinks`; `@solana-agent-kit/adapter-mcp` (MCP server).
- `Action` = `{ name, similes, description, examples, schema (zod), handler(agent, input) }`. Framework adapters: `createVercelAITools`, `createLangchainTools`, `createOpenAITools` — all convert `Action[]` to framework tools (128-tool limit warned).
- Repo: https://github.com/sendaifun/solana-agent-kit · docs: https://kit.sendai.fun · npm: https://www.npmjs.com/package/solana-agent-kit
- Local: `resources/agents/solana-agent-kit` (verified: core `package.json` version 2.0.10, `packages/core/src/types/action.ts`).

### elizaOS
- **`2.0.0-alpha`** line (root `eliza` package `2.0.0-alpha.176`; lerna workspace channel `2.0.0-alpha.475` — alpha, moves fast). TypeScript agentic OS, formerly ai16z, rebranded ElizaOS Jan 2025.
- `Action` = `{ name, description, similes?, examples?, validate, handler }`; `handler(runtime, message, state, options, callback, responses) => Promise<ActionResult>`. Output via `HandlerCallback(content: Content, actionName?)` and/or `ActionResult { success, data, ... }`.
- Solana integration plugins: `@elizaos/plugin-solana` (core), `plugin-solana-v2` (uses `@solana/web3.js` v2 / kit), `@elizaos/plugin-solana-agent-kit` **0.25.6-alpha.1** (bridges SAK actions into eliza). **[unverified]** exact plugin-solana version against the alpha core.
- Repo: https://github.com/elizaOS/eliza · docs: https://docs.elizaos.ai · npm: https://www.npmjs.com/package/@elizaos/plugin-solana
- Local: `resources/agents/eliza` (verified: `Action`/`Handler`/`HandlerCallback`/`ActionResult` in `packages/typescript/src/types/components.ts`; root + lerna versions).

### rig — 0xPlaygrounds (Rust)
- **`rig-core 0.35.0`** (core crate); **`rig 0.36.0`** facade (feature-gated companion crates, e.g. `features = ["lancedb", "fastembed"]`). Use the facade for integrations, `rig-core` for bare provider abstractions.
- `Tool` trait: `const NAME`, `type Args`, `type Output`, `definition(prompt) -> ToolDefinition`, `call(args) -> Result<Output, Error>`. Derive helper `tool_macro` (`rig_derive`). 20+ providers (Anthropic, OpenAI, Cohere, Gemini, DeepSeek, Mistral, Ollama, xAI, …).
- Repo: https://github.com/0xPlaygrounds/rig · docs: https://docs.rig.rs · crate: https://crates.io/crates/rig-core
- Local: `resources/agents/rig` (verified: `rig/rig-core/Cargo.toml` version 0.35.0; `Tool` trait in `rig/rig-core/src/tool/mod.rs`).

## Simulation substrate (reused from solana-testing)

- **LiteSVM** — Rust crate **`litesvm 0.13.0`**; npm **`litesvm 1.2.x`**. Same engine, **independent version numbers — never assume they match.** In-process SVM, no validator, deterministic clock. Replaces deprecated `solana-bankrun` and slow `solana-test-validator`.
  - Crate: https://crates.io/crates/litesvm · npm: https://www.npmjs.com/package/litesvm · repo: https://github.com/LiteSVM/litesvm
- **`@solana/kit` 6.10.0** — web3.js v2 successor; opaque `Address` strings (not `PublicKey`), explicit codecs, functional tx builders. Legacy `@solana/web3.js` `1.98.4` is **maintenance-only**. litesvm's TS API still takes `PublicKey`-shaped objects in 1.x — convert at the boundary.
  - npm: https://www.npmjs.com/package/@solana/kit
- Sibling skill harness (the code this skill reuses — see [`svm-grounded-scoring.md`](svm-grounded-scoring.md)):
  - [`../../solana-testing-skill/skill/litesvm-integration.md`](../../solana-testing-skill/skill/litesvm-integration.md) — Rust LiteSVM API, PDA/CPI/`init_if_needed` patterns.
  - [`../../solana-testing-skill/skill/ts-testing-kit.md`](../../solana-testing-skill/skill/ts-testing-kit.md) — npm litesvm + `@solana/kit`.
  - [`../../solana-testing-skill/skill/bug-class-playbook.md`](../../solana-testing-skill/skill/bug-class-playbook.md) — outcome assertions map onto these bug classes.

## Generic LLM-eval frameworks (cross-ecosystem precedent)

These are the prior art this skill borrows its *structure* from (datasets, scorers, CI gates) and deliberately diverges from on *substance* (text scoring → SVM-grounded outcome scoring). None is chain-aware; cited as precedent, not dependencies.

- **DeepEval** (Confident AI) — open-source, `pytest`-style `assert_test()`, 50+ metrics, `G-Eval` (LLM-as-judge w/ chain-of-thought). Closest in spirit to per-PR CI gating. https://github.com/confident-ai/deepeval · https://deepeval.com
- **Braintrust** — eval platform: scoring + production tracing + dataset management + CI release enforcement. Precedent for the baseline/gate-on-merge model. https://www.braintrust.dev
- **OpenAI Evals** — registry-style eval definitions, unit-level CI checks. https://github.com/openai/evals
- **Inspect** (UK AI Safety Institute) — Python eval framework: solvers + scorers, strong for agentic/tool-use evals. https://inspect.aisi.org.uk **[unverified]** current version/URL this cycle.

Takeaway: reuse their dataset + scorer + gate *patterns*; the `tool`/`program`/`accounts`/`argValidity`/`buildable`/`outcome` scorers and `gate(baseline, current)` are this skill's chain-specific equivalent. See [`ci-gating.md`](ci-gating.md).

## This skill

- **Scorer engine** — [`../tools/agent-eval/eval.mjs`](../tools/agent-eval/eval.mjs): `scoreTask`, `evaluate`, `gate(baseline, current, tol)`. Zero dependencies, Node ≥18, library + CLI.
- **Offline proof** — [`../examples/eval-run`](../examples/eval-run): `golden.json` (5 tasks) + `agent-v1.json` (4/4) + `agent-v2.json` (regression) + [`run.test.mjs`](../examples/eval-run/run.test.mjs) (`node --test`). Proves the gate fires on a real regression and never false-alarms.
- **Reference files:** [`svm-grounded-scoring.md`](svm-grounded-scoring.md) · [`adapters.md`](adapters.md) · [`ci-gating.md`](ci-gating.md)

## Version compatibility matrix

The fault line is **`PublicKey` (web3.js/litesvm 1.x) vs `Address` (kit 6.x)** — they are not interchangeable, and the agent frameworks straddle it. Pin per language, convert at boundaries.

| Component | Pinned | Address model | Notes |
|---|---|---|---|
| solana-agent-kit (core) | npm 2.0.10 | `PublicKey` internally | Node ≥22, pnpm ≥8; actions carry zod schemas |
| eliza | 2.0.0-alpha | mixed (plugin-solana-v2 → kit) | alpha; expect churn in `Action`/`ActionResult` |
| rig-core / rig | 0.35.0 / 0.36.0 | Rust `Pubkey` (your build) | tool I/O is JSON strings to the model |
| litesvm (Rust) | crate 0.13.0 | `solana_pubkey::Pubkey` | scorer substrate for SBF golden programs |
| litesvm (TS) | npm 1.2.x | `PublicKey` (1.x types) | scorer substrate for JS golden tasks |
| @solana/kit | 6.10.0 | `Address` (base58 string) | app/client code; convert to `PublicKey` for litesvm 1.x |
| @solana/web3.js (legacy) | 1.98.4 | `PublicKey` | maintenance-only; do not start new code on it |

For the eval harness itself: **zero runtime deps, Node ≥18** — the structural scorers never touch any of the above. The litesvm/kit pins matter only for the optional `outcome` scorer and the captured agent run.

## What to watch (re-verify next cycle)

- **eliza is alpha.** The `Action` signature (`handler(runtime, message, state, options, callback, responses)`) and `ActionResult.data` shape can change between alpha tags. Re-confirm `packages/typescript/src/types/components.ts` before trusting the adapter in [`adapters.md`](adapters.md).
- **litesvm npm vs crate skew widens.** Independent release cadence; the 1.2.x ⇆ 0.13.0 gap is normal and will move. Pin both explicitly, never derive one from the other.
- **kit major.** `@solana/kit` 6.x is current; a 7.x would likely touch codecs/tx-builder ergonomics. The litesvm 1.x `PublicKey` boundary is the thing most likely to break on upgrade.
- **SAK plugin split.** 2.x capabilities live in `@solana-agent-kit/plugin-*`; a capability the eval targets may move plugins between minors. Resolve `program`/account roles from the action at runtime, not a frozen table.
- **rig facade vs core versions diverge.** `rig` (facade) and `rig-core` version independently; the `Tool` trait lives in `rig-core`. Pin the one you import.

## Verification commands

```bash
npm ls solana-agent-kit @elizaos/plugin-solana litesvm @solana/kit   # JS pins
cargo tree -i rig-core ; cargo tree -i litesvm                        # Rust pins
node --test examples/eval-run/                                        # harness self-proof
node tools/agent-eval/eval.mjs examples/eval-run/golden.json \
  examples/eval-run/agent-v2.json --baseline /dev/stdin              # see the gate FAIL on the seeded regression
```

_Last verified: June 2026_
