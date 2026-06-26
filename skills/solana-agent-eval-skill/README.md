# solana-agent-eval-skill

**Eval your Solana AI agent before you trust it with funds.**

> **Extends**: [solana-dev-skill](https://github.com/solana-foundation/solana-dev-skill). Reuses the `solana-testing` LiteSVM harness for outcome scoring. Adapters for `solana-agent-kit`, `eliza`, `rig`.

A progressively-loaded skill for Claude Code / Codex: a **dataset → scorer → CI-gate** harness that scores what a Solana agent actually emits — the *instruction* (tool, program, accounts, args) — and grounds the score in execution by simulating the produced instructions in LiteSVM.

## The problem

Teams ship Solana agents that select tools and build transactions with real money, then "test" with a handful of manual prompts. A prompt tweak or model bump silently breaks tool selection and nobody notices until the agent sends the wrong instruction. Generic LLM-eval frameworks (Braintrust, DeepEval, OpenAI Evals) score **text similarity** — meaningless when correctness means emitting the *right* instruction. Across the 501-tool Solana landscape, nothing evaluates agent **decision quality**: solana-agent-kit ships manual smoke tests (no dataset, no scoring, no gate); runtime guardrails (agent-guardian, cerberus) gate *live* txs — a different layer.

## What's included

| Component | Contents |
|-----------|----------|
| **Tool** (`tools/agent-eval`) | Zero-dep scorer + regression gate: tool-selection, program, account-set (Jaccard), arg-validity, buildability. **Verified runnable.** |
| **Skill** (`skill/`) | `SKILL.md` router + 7 references: overview, datasets, scorers, **svm-grounded-scoring**, adapters, ci-gating, resources |
| **Agents** (`agents/`) | `eval-author` (build datasets/scorers/gate), `regression-reviewer` (audit the eval for leakage/gameability) |
| **Commands** (`commands/`) | `/build-eval-set`, `/run-eval`, `/eval-gate` |
| **Rules** (`rules/`) | `eval-honesty.md` — no dataset leakage, report real scores, keep negative cases |
| **Example** (`examples/eval-run`) | Golden set + correct agent (1.0) + regressed agent (dropped SPL `mint`) → **CI gate fires; 4/4 tests pass** |

## The differentiator: SVM-grounded scoring

Generic eval scores text. This scores the **outcome**: take the agent's produced instructions, simulate them in LiteSVM (reusing the `solana-testing` harness), and assert the resulting on-chain state matches ground truth — *agent decision → real simulation → state assertion*. No chain-agnostic framework can do this. See `skill/svm-grounded-scoring.md`.

## Verified proof

```bash
cd examples/eval-run && node --test    # 4/4 pass
```
```
scores (regressed agent): {"tool":1,"program":1,"accounts":0.95,"argValidity":1,"buildable":0.8,"overall":0.95}
  ✗ transfer-spl: accounts=0.75  →  CI gate FIRES on accounts + buildable
```
A correct agent scores 1.0; an agent that drops one SPL `mint` account regresses and the gate blocks the PR — the exact silent failure a model bump introduces. Full output in [EVAL_REPORT.md](EVAL_REPORT.md).

## Installation

```bash
./install.sh          # ~/.claude/skills, clones core skill if missing
./install-custom.sh   # choose location; optionally copy agents/commands/rules
```

## License

MIT — see [LICENSE](LICENSE). Built for the [Solana AI Kit](https://github.com/solanabr/solana-ai-kit) bounty.
