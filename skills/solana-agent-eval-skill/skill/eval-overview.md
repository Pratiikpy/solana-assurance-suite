# Evaluating Solana Agents — Why, and What's Different

An LLM agent on Solana has one job that matters: when a user says "send 10 USDC to Alice," it must emit the **right instruction** — `transfer_token` against `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`, with the source, dest, owner, **and mint** accounts, and `amount = 10_000_000`. A fluent, confident, well-phrased response that drops the mint account or sends the wrong amount is not "almost right" — it is a transaction that either fails to build or moves the wrong money. This skill evaluates that decision quality **offline, before a single lamport moves**.

This file is the map. The loop is dataset → scorer → gate:
- **Dataset** — golden tasks pairing a prompt with the expected tool/program/accounts/args → [datasets.md](datasets.md)
- **Scorers** — structural checks that turn a produced tool-call into per-dimension scores → [scorers.md](scorers.md)
- **Gate** — a CI step that fails the PR when any dimension regresses below baseline → [scorers.md](scorers.md#the-gate-must-hold-all)
- **Outcome scorer** — the differentiator: simulate the produced instruction in LiteSVM and assert resulting on-chain state → [svm-grounded-scoring.md](svm-grounded-scoring.md)

> **Companion:** this skill reuses the in-process SVM harness from [solana-testing](../solana-testing/SKILL.md). That skill proves a *program* is safe; this one proves an *agent* decides correctly. The outcome scorer is the bridge.

## Why a Solana agent needs its own eval

Generic agent-eval frameworks — Braintrust, DeepEval, OpenAI Evals, Inspect — are built around scoring *text* or, at best, a tool call's *name and arguments* against a reference. That is necessary but not sufficient on Solana, for three structural reasons:

1. **The output is an instruction, not prose.** The correctness criterion is not "does this read like the reference answer" — it is "does this instruction reference the exact program and the complete, ordered account set the runtime requires." A missing `AccountMeta` is `ProgramError`, not a stylistic nit. Text similarity cannot see it.
2. **Solana fails closed on under-specification.** Drop one required account and the transaction does not *degrade* — it reverts. So a scorer must be exact about the account *set*, not fuzzy. (See the `transfer_token`-drops-`mint` regression baked into [the proof](#the-proof-examples-eval-run).)
3. **The same prose maps to different on-chain effects.** "Stake 10 SOL" and "stake 10 USDC-worth of SOL" read alike; one is a `Stake11111…` delegation, the other is nonsense. Only executing the produced instruction tells you what actually happens — hence the SVM outcome scorer.

The 2026 consensus across the agent-eval field backs this: for tool-calling agents you assert on the **actual call (tool name + arguments), not similar-sounding text**. The named techniques are *exact-match on tool args*, *trajectory match* (right tools in the right order), and *trajectory single-tool-use* (was the right tool present). LLM-as-judge on prose carries documented verbosity and position biases and, in one 2026 study, a trajectory-opaque judge missed 44% of safety violations that hybrid deterministic-plus-judge grading caught. The structural scorers here are the deterministic layer; the SVM scorer goes one level deeper than any of them — it grades the *effect*, not the call.

## Where this sits relative to the agent frameworks

The agent under test is whatever emits tool calls — typically [solana-agent-kit / SendAI](https://github.com/sendaifun/solana-agent-kit), [ElizaOS](https://github.com/elizaOS/eliza), or [rig](https://github.com/0xPlaygrounds/rig) (commonly via riglr). The eval is framework-agnostic by design: it consumes a normalized JSON array of produced tool-calls (`{id, tool, program, accounts[], args{}}`), so any framework that can be coaxed into emitting-without-sending feeds the same harness.

That last clause is load-bearing. solana-agent-kit v2 makes it first-class: construct the kit with `config.signOnly: true` and `signOrSendTX` returns the **signed transaction object instead of broadcasting** — you decompile it to instructions and feed them to the scorers (and to the SVM outcome scorer) with zero mainnet exposure. ElizaOS and rig/riglr build and send transactions *inside* the action/tool handler with no equivalent top-level dry-run toggle, so for those you intercept at the transaction-builder boundary. Either way the adapter's job is to produce the normalized record; see [datasets.md](datasets.md#building-eval-sets-from-real-agent-tool-flows).

> **Token-2022 is not exotic in 2026.** SendAI ships a dedicated `DEPLOY_TOKEN_2022` action and branches on `TOKEN_2022_PROGRAM_ID` (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`) vs `TOKEN_PROGRAM_ID` by mint owner. A token task's `expected.program` must match the mint's actual owner program, and ATA derivation must pass the correct token-program argument. Goldens that hard-code legacy SPL Token for a Token-2022 mint will mis-score correct agents.

## Where this sits relative to other Solana tooling

| Layer | What it checks | When it runs | This skill? |
|-------|----------------|--------------|-------------|
| **solana-agent-kit smoke tests** | "does this one action still build a tx" — ad hoc, manual, per-action | dev-time, by hand | No — replaced by a versioned golden dataset + a measured score |
| **This eval harness** | *decision quality* — right tool/program/accounts/args, and right on-chain effect, across a whole dataset | offline, in CI, on every PR | **Yes** |
| **Runtime guardrails** (agent-guardian, cerberus) | a *live* outgoing transaction against policy — spend caps, allowlists, simulation-before-send | production, per transaction | No — orthogonal; runs after deploy |

These are complementary, not substitutes. solana-agent-kit's per-action smoke tests answer "does the plumbing work"; they don't measure whether the agent *chose* the right action across a representative task set, and they rot because nothing enforces them. Runtime guardrails gate a transaction the agent has already decided to send — they catch a bad decision at the last moment, in production, transaction by transaction. This harness moves that judgment *left*: it catches the bad decision offline, on the PR that introduced it, across the whole dataset, before anything ships. A regression like "v2 silently dropped the SPL `mint` account" is exactly the class a guardian would only catch live (as a failed/blocked tx); the eval gate catches it at commit time.

## The proof — `examples/eval-run`

The harness ships with a runnable, verified proof, not a description of one. It is zero-dependency (Node ≥ 18, `node --test`):

- [`golden.json`](../examples/eval-run/golden.json) — five real Solana tasks (SOL transfer, SPL transfer, ATA create, stake delegation, close token account) with full `expected` records.
- [`agent-v1.json`](../examples/eval-run/agent-v1.json) — a correct agent: scores **1.0 on every dimension**.
- [`agent-v2.json`](../examples/eval-run/agent-v2.json) — a regressed agent that **dropped the `mint` account** from `transfer_token`. The account-set Jaccard for that task falls to 3/4 = 0.75, `buildable` flips to 0, and the overall score drops.
- [`run.test.mjs`](../examples/eval-run/run.test.mjs) — **4/4 tests** asserting: v1 is perfect, v2 regresses on `accounts` + `buildable`, the CI gate *fires* on v2-vs-v1, and the gate does *not* false-alarm when current equals baseline.

```
$ cd examples/eval-run && node --test
# tests 4
# pass 4
# fail 0
```

The scoring engine is [`tools/agent-eval/eval.mjs`](../tools/agent-eval/eval.mjs) — `scoreTask`, `evaluate`, and `gate`, dissected in [scorers.md](scorers.md). Run it standalone:

```
$ node tools/agent-eval/eval.mjs examples/eval-run/golden.json examples/eval-run/agent-v2.json \
    --baseline baseline.json
scores: {"tool":1,"program":1,"accounts":0.95,"argValidity":1,"buildable":0.8,"overall":0.95}
  ✗ transfer-spl: tool=1 program=1 accounts=0.75 args=1
GATE: FAIL ❌ — accounts 1->0.95, buildable 1->0.8
```

## Read next

- New to the format → [datasets.md](datasets.md): the golden schema, building sets from real tool flows, trigger/negative cases, versioning, leakage.
- Want the scoring detail → [scorers.md](scorers.md): each structural scorer, what it catches, its blind spot, and how to add your own.
- Want the real differentiator → [svm-grounded-scoring.md](svm-grounded-scoring.md): simulate the produced instruction in LiteSVM and assert on-chain state.

_Last verified: June 2026_
