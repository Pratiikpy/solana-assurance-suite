# Scorers — What Each Number Means, and What It Can't See

Every scorer here is **deterministic and structural**: no LLM judge, no embeddings, no toolchain. Given an expected tool-call and a produced one, it returns a number in `[0, 1]`. That is a deliberate design choice — the structural layer is cheap, reproducible, and catches the failure mode that breaks Solana agents (wrong instruction shape) without the verbosity/position biases of an LLM judge. The *effect*-level check that goes beyond shape lives in [svm-grounded-scoring.md](svm-grounded-scoring.md). For where these sit in the loop see [eval-overview.md](eval-overview.md); for the data they score see [datasets.md](datasets.md).

All five are implemented in [`tools/agent-eval/eval.mjs`](../tools/agent-eval/eval.mjs) in one function, `scoreTask(expected, produced)`:

```js
export function scoreTask(expected, produced) {
  produced = produced || {};                                    // missing output => everything 0
  const tool = produced.tool === expected.tool ? 1 : 0;
  const program = produced.program === expected.program ? 1 : 0;
  const accounts = setEq(expected.accounts, produced.accounts); // Jaccard, [0,1]
  const reqArgs = Object.keys(expected.args || {});
  const present = reqArgs.filter((k) =>
    produced.args && produced.args[k] !== undefined && produced.args[k] !== null);
  const argValidity = reqArgs.length === 0 ? 1 : present.length / reqArgs.length;
  const buildable = tool === 1 && program === 1 && accounts === 1 && argValidity === 1 ? 1 : 0;
  return { tool, program, accounts, argValidity, buildable };
}
```

A note on `produced || {}`: if the agent emitted **nothing** for a task id, every dimension is 0. That is correct — a non-answer to a positive task is a failure, and a non-answer to a should-refuse task scores `tool === 1` (because `expected.tool === "none"` and `undefined !== "none"` … see the blind spot below).

## 1. Tool-selection — `tool`

```js
const tool = produced.tool === expected.tool ? 1 : 0;
```

Exact-match on the action name. Did the agent pick `transfer_token` when it should have, vs `transfer_sol` or nothing.

- **Catches:** the most consequential class of error — choosing the wrong capability entirely. "Send 10 USDC" answered with a `transfer_sol` is a 0 here even if every account happens to line up. Also the decisive scorer for **should-refuse / ambiguous** cases (`expected.tool: "none"`): emitting any action scores 0.
- **Blind spot:** exact-string equality. An agent that exposes the same capability under a different name (`spl_transfer` vs `transfer_token`) scores 0 despite being correct. Normalize tool names in your adapter to the dataset's vocabulary, or maintain an alias map — the analogue of solana-agent-kit actions carrying `similes[]`. Also note the should-refuse subtlety: a *missing* output (`produced` undefined) yields `undefined !== "none"` → scores **1** for a refuse case, which is the right answer (the agent correctly emitted nothing), but means "agent crashed and produced nothing" and "agent correctly refused" are indistinguishable at this layer. Distinguish them upstream by recording an explicit refusal sentinel.

## 2. Program-match — `program`

```js
const program = produced.program === expected.program ? 1 : 0;
```

Exact-match on the base58 program id the instruction targets.

- **Catches:** targeting the wrong program — the single most security-relevant structural check. A `transfer` aimed at a look-alike or malicious program id is a 0 here regardless of how plausible the accounts look. Also catches the **Token vs Token-2022** mismatch: `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` vs `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` are different programs, so a Token-2022 mint operation that emits the legacy SPL program scores 0 (and vice-versa). See [datasets.md](datasets.md) on labeling program by the mint's actual owner.
- **Blind spot:** it only knows the *top-level* program of the modeled instruction. It does not see CPI targets, nor multiple instructions in one transaction. An agent that targets the right program but makes a malicious inner CPI passes this scorer — that requires the SVM outcome check, which executes the whole thing.

## 3. Account-set Jaccard — `accounts`

```js
const setEq = (a = [], b = []) => {
  const A = new Set(a), B = new Set(b);
  if (A.size === 0 && B.size === 0) return 1;                 // both empty => trivially equal
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 1 : inter / union;                     // |A ∩ B| / |A ∪ B|
};
```

Jaccard similarity over the **set** of account roles: intersection over union. `1.0` only when the produced set exactly equals the expected set. This is the scorer that earns its keep on Solana.

- **Catches:** the dropped-account regression — the exact failure baked into the proof. `transfer_token` expects `["source","dest","owner","mint"]`; the regressed agent in [`agent-v2.json`](../examples/eval-run/agent-v2.json) emits only `["source","dest","owner"]`, so intersection 3 / union 4 = **0.75**. On Solana that missing `mint` is a hard build/execution failure, and a 0.75 here is the early warning. Jaccard also penalizes *extra* accounts (a spurious account inflates the union), which catches over-specification that can change instruction semantics.
- **Blind spot:** it's a **set**, so **order is ignored**. Solana instructions are positional — `AccountMeta` order matters, and signer/writable flags matter. Two instructions with the same account set in different orders both score 1.0 here but only one builds correctly. The structural layer accepts this on purpose (role-name ordering is brittle to encode); ordering and flags are exactly what the SVM outcome scorer verifies by actually executing the instruction. If you need order sensitivity without full simulation, score a sequence-equality variant alongside Jaccard (the analogue of `trajectory_exact_match` vs `trajectory_single_tool_use` in the broader agent-eval field).

## 4. Arg-validity — `argValidity`

```js
const reqArgs = Object.keys(expected.args || {});
const present = reqArgs.filter((k) =>
  produced.args && produced.args[k] !== undefined && produced.args[k] !== null);
const argValidity = reqArgs.length === 0 ? 1 : present.length / reqArgs.length;
```

Fraction of required argument keys that are **present and non-null** in the produced call. A task with no required args (`{}`) scores 1 trivially.

- **Catches:** omitted required arguments — an agent that calls `transfer_token` without an `amount`, or `deploy_token_2022` without `decimals`. Partial credit (2 of 3 required keys present = 0.667) localizes *which* args are dropping across the dataset.
- **Blind spot:** **presence, not correctness**. `amount: 1` and `amount: 10000000` both score 1.0 — the scorer cannot tell a one-lamport transfer from the intended ten-USDC one, and it has no view on decimal/unit errors, slippage bounds, or off-by-a-factor-of-1e9 mistakes. This is intentional: argument *value* correctness is unit- and context-dependent and is the SVM outcome scorer's job — it executes the instruction and asserts the destination balance actually increased by the right amount. Treat a perfect `argValidity` as "no missing fields," never "the numbers are right."

## 5. Buildability — `buildable` (all-must-hold)

```js
const buildable = tool === 1 && program === 1 && accounts === 1 && argValidity === 1 ? 1 : 0;
```

A conjunction: 1 only if tool, program, account-set, **and** arg presence are *all* perfect. This is the headline pass/fail per task — it answers "could this produced call plausibly be assembled into a transaction at all." Any single structural defect drops it to 0.

- **Catches:** the bottom line. The v2 regression scores `tool=1, program=1, accounts=0.75, argValidity=1` on `transfer-spl` → `buildable = 0`. One dropped account, and the whole task is unbuildable, which is exactly Solana's fail-closed reality. Because it's a min-style AND, `buildable` is the most sensitive dimension and the one most worth gating on.
- **Blind spot:** it is **necessary, not sufficient**. `buildable = 1` means the call is *structurally* assemblable; it does **not** mean the transaction would succeed on-chain or produce the intended effect — wrong account *order*, wrong arg *values*, a failing CPI, insufficient funds, or a missing signer flag all pass `buildable` and only surface under simulation. "Buildable" is the gate to *attempting* execution; [svm-grounded-scoring.md](svm-grounded-scoring.md) is where "and it actually worked" is proven.

## Aggregation and the per-task view

`evaluate(golden, outputs)` joins outputs to goldens by `id`, scores each task, and averages each dimension across the dataset (rounded to 4 dp), plus an `overall` = mean of the five dimension means:

```js
const { scores, perTask } = evaluate(golden, outputs);
// scores:  { tool, program, accounts, argValidity, buildable, overall }
// perTask: [ { id, tool, program, accounts, argValidity, buildable }, ... ]
```

The CLI prints `scores` and then lists every task whose `buildable < 1`, so a failing run points straight at the offending task:

```
scores: {"tool":1,"program":1,"accounts":0.95,"argValidity":1,"buildable":0.8,"overall":0.95}
  ✗ transfer-spl: tool=1 program=1 accounts=0.75 args=1
```

## The gate — must hold all

A score is only useful if a regression *fails the build*. `gate(baseline, current, tol)` does exactly that:

```js
export function gate(baseline, current, tol = 0.0001) {
  const regressions = [];
  for (const d of Object.keys(current)) {
    if (baseline[d] === undefined) continue;
    if (current[d] < baseline[d] - tol) regressions.push({ dim: d, baseline: baseline[d], current: current[d] });
  }
  return { pass: regressions.length === 0, regressions };
}
```

Any dimension that drops below its baseline by more than `tol` (default `1e-4`, absorbing float noise) is a regression; one regression fails the gate. The CLI exits non-zero so CI goes red:

```bash
node tools/agent-eval/eval.mjs golden.json agent-output.json --baseline baseline.json
# GATE: FAIL ❌ — accounts 1->0.95, buildable 1->0.8   (exit 1)
```

This is the same contract the broader agent-eval field reaches for — a stored baseline plus a threshold, failing the build on regression — and it is what [`run.test.mjs`](../examples/eval-run/run.test.mjs) proves in 4/4 tests: the gate fires on the v2 regression and does *not* false-alarm when current equals baseline. Establish `baseline.json` from a known-good agent run and re-baseline only on a reviewed, intentional change (and never across dataset versions — see [datasets.md](datasets.md#versioning-and-leakage)). Gate on `accounts` and `buildable` first; they're the most sensitive to the dropped-account class.

## Adding a custom scorer

The contract is small: a pure function `(expected, produced) -> number in [0,1]`. To add one — say an **order-sensitive** account check that complements Jaccard — extend `scoreTask` and register the new dimension in `evaluate`'s `dims` list so it's averaged and gated automatically:

```js
// in eval.mjs — sequence equality over account roles (order matters)
const seqEq = (a = [], b = []) =>
  a.length === b.length && a.every((x, i) => x === b[i]) ? 1 : 0;

export function scoreTask(expected, produced) {
  produced = produced || {};
  // ...existing tool/program/accounts/argValidity/buildable...
  const accountOrder = seqEq(expected.accounts, produced.accounts);   // new dimension
  return { tool, program, accounts, argValidity, buildable, accountOrder };
}

// add it to the averaged + gated set
const dims = ["tool", "program", "accounts", "argValidity", "buildable", "accountOrder"];
```

Because `evaluate` derives `scores` and `overall` from `dims`, and `gate` iterates every key in `current`, a new dimension is averaged, reported per-task, and gated with no further wiring. Keep custom scorers deterministic and bounded to `[0,1]`; anything requiring execution or an LLM belongs in a separate stage — the outcome scorer for on-chain effects ([svm-grounded-scoring.md](svm-grounded-scoring.md)), or an explicit judge stage for genuinely open-ended prose. The same `Score`-shaped contract maps cleanly onto Braintrust (`Score{name, score}`), DeepEval (`BaseMetric.measure -> float`), and Inspect (`@scorer` → `Score{value}`) if you ever export to those harnesses.

> **The structural scorers prove the call has the right *shape*. They cannot prove it has the right *effect*.** That is not a gap to apologize for — it's the layering. Right-shape is cheap, deterministic, and catches the dropped-account/wrong-program/missing-arg classes at PR time. Right-effect requires execution → [svm-grounded-scoring.md](svm-grounded-scoring.md), which simulates the produced instruction in LiteSVM (reusing the [solana-testing](../solana-testing/litesvm-integration.md) harness) and asserts the resulting on-chain state.

_Last verified: June 2026_
