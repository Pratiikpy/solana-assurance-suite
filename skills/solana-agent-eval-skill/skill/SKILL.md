---
name: solana-agent-eval
description: Evaluate a Solana AI agent before you trust it with funds. A dataset→scorer→gate harness that scores an agent's tool-call outputs structurally (right tool, program, accounts, args, buildable) AND — uniquely — grounds the score in execution: simulate the agent's produced instructions in LiteSVM and assert the resulting on-chain state matches ground truth. Regression-gates CI so a model/prompt change that breaks tool selection fails the PR. Extends solana-dev-skill; reuses the solana-testing SVM harness; adapters for solana-agent-kit, eliza, rig. Generic eval frameworks score text; this scores the instruction the agent actually emits.
user-invocable: true
---

# Solana Agent Eval — Score the Decision, Not the Prose

> **Extends**: [solana-dev-skill](../solana-dev/SKILL.md). Reuses the [solana-testing](../solana-testing/SKILL.md) LiteSVM harness for the outcome scorer. Adapters for `solana-agent-kit`, `eliza`, `rig`.

Teams ship Solana agents that pick tools and build transactions with real money, then "test" them with a few manual prompts. A prompt tweak or model bump silently breaks tool selection and nobody notices until an agent sends the wrong instruction. Generic LLM-eval frameworks (Braintrust, DeepEval, OpenAI Evals) score **text similarity** — useless when the job is to emit the *right instruction*: correct tool, program, accounts, args. This skill is the missing harness: a golden dataset, structural scorers, a **LiteSVM-grounded outcome scorer**, and a CI gate that fails the PR on regression. Nothing in the kit, the 47 PRs, or the 501-tool landscape does this for Solana.

## What This Skill Is For

### Build the eval
- Why eval Solana agents; the dataset→scorer→gate loop → [eval-overview.md](eval-overview.md)
- The golden dataset format + how to build one → [datasets.md](datasets.md)

### Score
- Structural scorers (tool/program/accounts/args/buildable) → [scorers.md](scorers.md)
- The differentiator — simulate the produced instructions in LiteSVM, assert on-chain state → [svm-grounded-scoring.md](svm-grounded-scoring.md)
- Adapt any framework's output to the scorer → [adapters.md](adapters.md)

### Gate
- Regression-gate CI on per-scorer deltas → [ci-gating.md](ci-gating.md)
- Pinned versions/links → [resources.md](resources.md)

### Delegate
- The SVM harness the outcome scorer reuses → [solana-testing](../solana-testing/SKILL.md)
- Runtime tx guardrails (different layer — live policy, not offline eval) → kit's agent-guardian / cerberus

## Default Approach (Opinionated)

1. **Score the instruction, not the words.** A Solana agent is right only if its emitted tool/program/accounts/args are right. Text similarity is a vanity metric.
2. **Ground value-moving tools in execution.** For transfer/swap/mint, the structural score is necessary but not sufficient — simulate in LiteSVM and assert the resulting state ([svm-grounded-scoring.md](svm-grounded-scoring.md)).
3. **Gate, don't dashboard.** An eval that doesn't fail the PR is decoration. Commit a baseline; block regressions ([ci-gating.md](ci-gating.md)).
4. **No leakage, keep negatives.** Never tune the dataset to the agent; always include should-refuse / ambiguous cases.

## Operating Procedure

### 1. Build the golden set
`{id, prompt, expected:{tool, program, accounts[], args{}}}` across the agent's real tasks + negative cases. [datasets.md](datasets.md).

### 2. Capture + adapt the agent's outputs
Run the agent over the prompts; adapt its tool-calls to the scorer shape. [adapters.md](adapters.md).

### 3. Score
`node tools/agent-eval/eval.mjs golden.json agent-output.json` → per-scorer + overall; add the SVM-outcome scorer for value-moving tools. [scorers.md](scorers.md), [svm-grounded-scoring.md](svm-grounded-scoring.md).

### 4. Gate
Compare to the committed baseline; fail the PR on regression. [ci-gating.md](ci-gating.md).

### Pick the right agent
| Task | Agent | Model |
|------|-------|-------|
| Build datasets/scorers, wire the gate | **eval-author** | sonnet |
| Audit the eval (leakage, gameability) | **regression-reviewer** | opus |

---

## Progressive Disclosure (Read When Needed)

### Build & score
- [eval-overview.md](eval-overview.md) — the loop, vs generic eval, vs runtime guardrails
- [datasets.md](datasets.md) — golden format, negatives, versioning
- [scorers.md](scorers.md) — structural scorers + custom scorers
- [svm-grounded-scoring.md](svm-grounded-scoring.md) — simulate + assert on-chain state (the differentiator)
- [adapters.md](adapters.md) — solana-agent-kit / eliza / rig

### Gate
- [ci-gating.md](ci-gating.md) — regression gate, GitHub Actions
- [resources.md](resources.md) — pinned versions, frameworks, precedent

### Companion
- [solana-testing](../solana-testing/SKILL.md) — the LiteSVM harness the outcome scorer reuses

---

## Task Routing Guide

| User asks about... | Primary file(s) |
|--------------------|-----------------|
| "how do I test/eval my Solana agent" | eval-overview.md, datasets.md |
| scoring tool selection / accounts / args | scorers.md |
| "did the agent's tx actually do the right thing" | svm-grounded-scoring.md |
| eval solana-agent-kit / eliza / rig | adapters.md |
| fail CI when the agent regresses | ci-gating.md |
| **simulate a program / test it** | solana-testing |
| **stop a live agent tx at runtime** | kit agent-guardian / cerberus |

---

## Commands

| Command | Description |
|---------|-------------|
| `/build-eval-set` | Capture an agent's tool-call outputs across prompts into the golden dataset format (+ negative cases) |
| `/run-eval` | Score a dataset + agent output; report per-scorer scores and failing tasks |
| `/eval-gate` | Compare current scores to the committed baseline; fail on regression (wire into CI) |

## Agents

| Agent | Purpose |
|-------|---------|
| **eval-author** | Builds datasets + scorers (structural + SVM-grounded), wires the gate; runs and pastes real output |
| **regression-reviewer** | Audits the eval itself for leakage, gameable scorers, and indefensible thresholds |

## Tool & proof

`tools/agent-eval/` is the runnable scorer + gate. `examples/eval-run/` is the **verified proof**:
a golden dataset + a correct agent (scores 1.0) + a regressed agent that dropped an SPL `mint`
account (overall 0.95, buildable 0.8) — and the **CI gate fires** on the `accounts`/`buildable`
regression while passing when unchanged (**4/4 tests pass**). See
[examples/eval-run](../examples/eval-run) and [EVAL_REPORT.md](../EVAL_REPORT.md).
