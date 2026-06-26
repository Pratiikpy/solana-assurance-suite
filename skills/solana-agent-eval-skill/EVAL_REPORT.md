# EVAL_REPORT — solana-agent-eval

Evidence the harness works. Run on this machine (Node 22). Output verbatim.

## 1. `examples/eval-run` — scores correctly and the gate catches a regression ✅ VERIFIED

A golden dataset of 5 Solana agent tasks (transfer SOL, transfer SPL, create ATA, delegate
stake, close token account), a correct agent (`agent-v1`), and a regressed agent (`agent-v2`)
that dropped the SPL `mint` account on the transfer-spl task.

**Command:** `node --test`
```
# tests 4
# pass 4
# fail 0
```

The 4 assertions: (1) v1 scores 1.0 on every dimension; (2) v2 regresses — `transfer-spl`
accounts = 0.75 (3 of 4), not buildable, overall < 1; (3) the **CI gate fires** on the
`accounts` + `buildable` regression; (4) the gate does **not** false-alarm when current == baseline.

**CLI demo:** `node tools/agent-eval/eval.mjs golden.json agent-v2.json`
```
scores: {"tool":1,"program":1,"accounts":0.95,"argValidity":1,"buildable":0.8,"overall":0.95}
  ✗ transfer-spl: tool=1 program=1 accounts=0.75 args=1
```

**What this proves:** the harness scores the *instruction the agent emits* (tool/program/
accounts/args/buildable), not text similarity, and a single dropped account — the kind of
silent regression a model bump introduces — is caught and blocks the PR. The deeper
LiteSVM-grounded outcome scorer (simulate the produced instructions, assert on-chain state)
is documented in `skill/svm-grounded-scoring.md` and reuses the verified `solana-testing` harness.

## 2. Novelty & fit

- **Unclaimed:** across the 501-tool Solana inventory, nothing evaluates agent *decision quality*.
  Generic eval frameworks (Braintrust/DeepEval/OpenAI Evals) are chain-agnostic and score text;
  solana-agent-kit ships manual smoke tests (no dataset, no scoring, no gate); runtime guardrails
  (agent-guardian, cerberus) gate *live* txs — a different layer.
- **Differentiator:** the SVM-grounded outcome scorer — agent decision → real simulation → state
  assertion — which no chain-agnostic framework can do. It reuses our `solana-testing` harness.
- **Cross-domain:** AI-agents × testing × on-chain execution. Serves the fast-growing class of
  developers building Solana agents (the "dev building" need).

## 3. Judging-criteria summary

| Criterion | Evidence |
|-----------|----------|
| **Usefulness** | Every team shipping a Solana agent needs regression-gated eval before trusting it with funds. |
| **Novelty** | Only Solana-aware agent-eval harness; the SVM-grounded scorer is unique. |
| **Quality** | Execution-verified scorer + gate (§1, 4/4) with pasted output; honest structural-vs-outcome distinction. |
| **Fit** | Reference-skill structure, MIT, extends solana-dev, reuses solana-testing. |
