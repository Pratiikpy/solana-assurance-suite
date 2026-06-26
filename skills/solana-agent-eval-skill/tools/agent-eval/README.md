# agent-eval

Score a Solana AI agent's tool-call outputs against a golden dataset and gate CI on
regressions. Zero dependencies (Node ≥ 18). Library + CLI.

```bash
node eval.mjs <golden.json> <agent-output.json> [--baseline <baseline-scores.json>]
```

## Scorers

| Dimension | Checks |
|-----------|--------|
| `tool` | the agent picked the right tool |
| `program` | the right program id |
| `accounts` | account set match (Jaccard vs expected) |
| `argValidity` | required args present + non-null |
| `buildable` | all of the above hold → the tx could actually be built |

`evaluate(golden, outputs)` → `{ scores, perTask, n }`. `gate(baseline, current)` → fails if
any dimension drops below baseline. The deeper **SVM-grounded outcome scorer** (simulate the
produced instructions in LiteSVM, assert on-chain state) is in
[`../../skill/svm-grounded-scoring.md`](../../skill/svm-grounded-scoring.md) and reuses the
`solana-testing` harness — use it for value-moving tools where "structurally valid" isn't enough.

## Verified

[`../../examples/eval-run`](../../examples/eval-run): a correct agent scores 1.0; a regressed
agent (dropped an SPL `mint` account) drops to 0.95 overall / 0.8 buildable and the gate fires.
**4/4 tests pass.** Output in [`../../EVAL_REPORT.md`](../../EVAL_REPORT.md).

_Last verified: June 2026 — Node 22._
