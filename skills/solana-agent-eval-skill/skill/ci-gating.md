# CI Gating — Block Regressions on Every PR

An eval that nobody runs is a unit test that never executes. The point of [`../tools/agent-eval/eval.mjs`](../tools/agent-eval/eval.mjs) is to run on every PR, compute per-scorer deltas against a **committed baseline**, comment the table, and **fail the PR** if any dimension regresses. The harness already ships the gate; CI just wires it.

## The gate, exactly as implemented

`gate(baseline, current, tol = 0.0001)` compares two score objects dimension-by-dimension and returns `{ pass, regressions }`. It fails only on a *drop* beyond tolerance — never on an improvement, never on a new dimension absent from the baseline:

```js
// from tools/agent-eval/eval.mjs — verbatim behavior
export function gate(baseline, current, tol = 0.0001) {
  const regressions = [];
  for (const d of Object.keys(current)) {
    if (baseline[d] === undefined) continue;               // new dimension: not gated
    if (current[d] < baseline[d] - tol) regressions.push({ dim: d, baseline: baseline[d], current: current[d] });
  }
  return { pass: regressions.length === 0, regressions };
}
```

Dimensions: `tool`, `program`, `accounts`, `argValidity`, `buildable`, `overall` — plus `outcome` once you wire [`svm-grounded-scoring.md`](svm-grounded-scoring.md). The CLI exits non-zero when the gate fails, which is all CI needs:

```bash
node tools/agent-eval/eval.mjs golden.json agent-output.json --baseline baseline.json
# prints "GATE: PASS ✅" or "GATE: FAIL ❌ — accounts 1->0.95, buildable 1->0.8" and exit 1
```

The committed proof is [`../examples/eval-run`](../examples/eval-run): `golden.json` (5 tasks) + `agent-v1.json` (correct, scores 4/4 — all dimensions 1.0) + `agent-v2.json` (drops the SPL `mint` account → `accounts` 0.75 on that task, `buildable` 0). Its [`run.test.mjs`](../examples/eval-run/run.test.mjs) asserts the gate **fires** on v1→v2 and **passes** on v1→v1 (no false alarm). That is the regression detector you are wiring into CI, already proven offline.

## Baseline discipline

The baseline is the scores of `main` (or the last accepted release), committed to the repo. Treat it like a snapshot file:

- Generate it from the merged-to-main agent output: `node tools/agent-eval/eval.mjs golden.json main-output.json` → capture the `scores:` object into `eval/baseline.json`.
- Update it **only** in a PR that intentionally moves a number, with the score change called out in the description. An unexplained baseline bump is a silently-accepted regression.
- A `tol` of `0.0001` means exact-equality in practice (scores are 4-decimal). Loosen `tol` only for a deliberately sampled, nondeterministic agent (see below) — never to paper over a real drop.

## Per-PR smoke vs nightly full

Per-PR runs gate fast on a small, deterministic slice; the nightly run exercises the full suite and refreshes the trend. Same harness, two scopes.

| | Per-PR smoke | Nightly full |
|---|---|---|
| Dataset | core golden slice (the [`eval-run`](../examples/eval-run) 5 + critical paths) | full golden set + `svm-outcome` tasks |
| Scorers | structural (zero-dependency, no toolchain) | structural **+** SVM outcome (LiteSVM) |
| Sampling | temperature 0, single pass | median-of-N to measure variance |
| Gate | hard fail the PR | fail + open an issue, post trend |
| Runtime | seconds | minutes (builds SBF, seeds state) |

Keep the per-PR job dependency-free so it never flakes on a toolchain: the structural scorers are pure Node ≥18. Push LiteSVM/SBF work (which needs `cargo build-sbf` and the reused [`../../solana-testing-skill/skill/litesvm-integration.md`](../../solana-testing-skill/skill/litesvm-integration.md) harness) to nightly where build time is affordable.

## GitHub Actions — per-PR gate

```yaml
# .github/workflows/agent-eval.yml
name: agent-eval
on:
  pull_request:
    branches: [main]

permissions:
  contents: read
  pull-requests: write          # required to comment the results table

jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }

      - name: Prove the harness itself (offline fixtures)
        run: node --test examples/eval-run/

      - name: Run the agent over the golden prompts
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}   # or your model provider
        run: node scripts/run-agent.mjs examples/eval-run/golden.json > agent-output.json
        # scripts/run-agent.mjs uses an adapter from adapters.md; temperature 0 for determinism

      - name: Score + gate against committed baseline
        id: gate
        run: |
          node tools/agent-eval/eval.mjs examples/eval-run/golden.json agent-output.json \
            --baseline eval/baseline.json | tee eval-out.txt
          # the CLI exits 1 on regression -> the step (and job) fails here

      - name: Comment results on the PR
        if: always()                                       # comment on pass AND fail
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const body = '### agent-eval\n```\n' + fs.readFileSync('eval-out.txt','utf8') + '\n```';
            const { data: comments } = await github.rest.issues.listComments(
              { ...context.repo, issue_number: context.issue.number });
            const prev = comments.find(c => c.body.startsWith('### agent-eval'));
            const args = { ...context.repo, body };
            prev ? await github.rest.issues.updateComment({ ...args, comment_id: prev.id })
                 : await github.rest.issues.createComment({ ...args, issue_number: context.issue.number });
```

The `tee` keeps the CLI's `scores:` line and per-task `✗` failures in the comment; the non-zero exit on regression fails the job and blocks merge (with branch protection requiring this check). Re-using one sticky comment per PR avoids comment spam on re-runs.

## GitHub Actions — nightly full + SVM outcome

```yaml
# .github/workflows/agent-eval-nightly.yml
name: agent-eval-nightly
on:
  schedule: [{ cron: "0 7 * * *" }]    # 07:00 UTC daily
  workflow_dispatch:

jobs:
  full:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - uses: dtolnay/rust-toolchain@stable          # for cargo build-sbf (outcome scorer)
      - run: npm ci                                  # litesvm 1.2.x + @solana/kit 6.x

      - name: Build SBF programs the outcome scorer simulates
        run: cargo build-sbf                         # produces target/deploy/*.so

      - name: Full structural + SVM-outcome eval (median of 5)
        env: { OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }} }
        run: node scripts/run-eval-full.mjs --runs 5 --golden eval/golden.full.json --baseline eval/baseline.json

      - name: Open an issue on regression
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.create({ ...context.repo,
              title: `agent-eval nightly regressed (${new Date().toISOString().slice(0,10)})`,
              labels: ['eval-regression'],
              body: require('fs').readFileSync('eval-out.txt','utf8') });
```

`run-eval-full.mjs` runs each prompt N times, takes the **median** per dimension to absorb sampling noise, then calls `evaluate()` + `gate()` — adding the `outcome` dimension via the LiteSVM scorer. A nondeterministic agent regressing only on the tail shows up as a median drop, not a single unlucky sample.

## Handling a sampling-driven agent

Real agents sample. Three levers, in order of preference:
1. **Temperature 0 in CI.** Cheapest determinism; the per-PR smoke uses this.
2. **Median-of-N.** Run each prompt N≥5 times, median per dimension; gate the median. Used nightly.
3. **Tolerance band.** Raise `tol` to the measured run-to-run stddev (e.g. `0.02`) *only* for sampled runs, and document it. Never use `tol` to swallow a structural regression — those are deterministic and should gate at `0.0001`.

## Pitfalls

- **Forgetting `pull-requests: write`.** The comment step 403s without it; the gate still fails the build, but reviewers lose the table.
- **Baseline drift.** If `eval/baseline.json` is regenerated in the same PR that regresses, the gate passes against itself. Review baseline diffs like schema changes.
- **Gating a flaky agent at `tol=0.0001`.** Either pin temperature to 0 or move to median-of-N; do not loosen the gate globally.
- **Provider outage = false fail.** Distinguish "agent produced worse output" (real regression) from "model API errored" (infra). Retry the model call inside `run-agent.mjs`; only feed real outputs to the scorer.

## See also

- [`../examples/eval-run`](../examples/eval-run) — the committed offline proof the gate fires on a real regression.
- [`svm-grounded-scoring.md`](svm-grounded-scoring.md) — the `outcome` dimension added to nightly.
- [`adapters.md`](adapters.md) — how `run-agent.mjs` captures each framework into the scorer shape.
- [`resources.md`](resources.md) — pinned versions used by the nightly toolchain.

_Last verified: June 2026_
