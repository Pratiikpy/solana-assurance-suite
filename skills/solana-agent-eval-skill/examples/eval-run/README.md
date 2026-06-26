# eval-run — scoring + the regression gate, proven

A self-checking proof. A golden dataset of 5 Solana agent tasks, a correct agent
(`agent-v1`), and a regressed agent (`agent-v2`) that dropped the SPL `mint` account on the
transfer task. `run.test.mjs` scores both and asserts the gate behavior.

## Run

```bash
node --test
```

## Verified output (Node 22)

```
# tests 4
# pass 4
# fail 0
```

CLI:
```bash
node ../../tools/agent-eval/eval.mjs golden.json agent-v2.json
# scores: {"tool":1,"program":1,"accounts":0.95,"argValidity":1,"buildable":0.8,"overall":0.95}
#   ✗ transfer-spl: accounts=0.75
```

## What it proves

- A correct agent scores **1.0** on every dimension.
- An agent that drops a single required account regresses (`accounts` 0.95, `buildable` 0.8) —
  the kind of silent failure a model/prompt change introduces.
- The **CI gate fires** on the `accounts`/`buildable` regression, and does **not** false-alarm
  when current == baseline.

The structural scorers run with no toolchain. For value-moving tools, layer the
LiteSVM-grounded outcome scorer ([../../skill/svm-grounded-scoring.md](../../skill/svm-grounded-scoring.md))
to assert the produced instructions actually reach the right on-chain state.

_Last verified: June 2026 — Node 22._
