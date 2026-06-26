#!/usr/bin/env node
// agent-eval — score a Solana AI agent's tool-call outputs against a golden dataset and
// gate CI on regressions. Zero dependencies (Node >= 18). Library + CLI.
//
// Generic LLM-eval frameworks score text similarity. A Solana agent's job is to emit the
// RIGHT instruction: correct tool, program, accounts, args. These scorers check exactly
// that, structurally. The deeper `svm-outcome` scorer (simulate the produced instruction
// in LiteSVM and assert resulting on-chain state) is documented in
// ../../skill/svm-grounded-scoring.md and reuses the solana-testing harness; this engine
// implements the structural scorers that run with no toolchain.
//
//   node eval.mjs <golden.json> <agent-output.json> [--baseline <baseline-scores.json>]

import { readFileSync } from "node:fs";

const setEq = (a = [], b = []) => {
  const A = new Set(a), B = new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 1 : inter / union; // Jaccard
};

// Score one (expected, produced) task pair across the structural scorers.
export function scoreTask(expected, produced) {
  produced = produced || {};
  const tool = produced.tool === expected.tool ? 1 : 0;
  const program = produced.program === expected.program ? 1 : 0;
  const accounts = setEq(expected.accounts, produced.accounts);
  // arg-validity: all required arg keys present (and non-null)
  const reqArgs = Object.keys(expected.args || {});
  const present = reqArgs.filter((k) => produced.args && produced.args[k] !== undefined && produced.args[k] !== null);
  const argValidity = reqArgs.length === 0 ? 1 : present.length / reqArgs.length;
  // buildability: a tx is buildable only if tool+program known and every account present
  const buildable = tool === 1 && program === 1 && accounts === 1 && argValidity === 1 ? 1 : 0;
  return { tool, program, accounts, argValidity, buildable };
}

export function evaluate(golden, outputs) {
  const byId = new Map(outputs.map((o) => [o.id, o]));
  const dims = ["tool", "program", "accounts", "argValidity", "buildable"];
  const totals = Object.fromEntries(dims.map((d) => [d, 0]));
  const perTask = [];
  for (const task of golden) {
    const s = scoreTask(task.expected, byId.get(task.id));
    perTask.push({ id: task.id, ...s });
    for (const d of dims) totals[d] += s[d];
  }
  const n = golden.length || 1;
  const scores = Object.fromEntries(dims.map((d) => [d, +(totals[d] / n).toFixed(4)]));
  scores.overall = +((dims.reduce((a, d) => a + scores[d], 0) / dims.length)).toFixed(4);
  return { scores, perTask, n: golden.length };
}

// Regression gate: fail if any dimension drops below baseline by more than `tol`.
export function gate(baseline, current, tol = 0.0001) {
  const regressions = [];
  for (const d of Object.keys(current)) {
    if (baseline[d] === undefined) continue;
    if (current[d] < baseline[d] - tol) regressions.push({ dim: d, baseline: baseline[d], current: current[d] });
  }
  return { pass: regressions.length === 0, regressions };
}

if (process.argv[1]?.endsWith("eval.mjs")) {
  const args = process.argv.slice(2);
  const [goldenFile, outFile] = args.filter((a) => !a.startsWith("-"));
  if (!goldenFile || !outFile) { console.error("usage: node eval.mjs <golden.json> <agent-output.json> [--baseline b.json]"); process.exit(1); }
  const golden = JSON.parse(readFileSync(goldenFile, "utf8"));
  const outputs = JSON.parse(readFileSync(outFile, "utf8"));
  const { scores, perTask } = evaluate(golden, outputs);
  console.log("scores:", JSON.stringify(scores));
  for (const t of perTask) if (t.buildable < 1) console.log(`  ✗ ${t.id}: tool=${t.tool} program=${t.program} accounts=${t.accounts} args=${t.argValidity}`);
  const bIdx = args.indexOf("--baseline");
  if (bIdx >= 0) {
    const baseline = JSON.parse(readFileSync(args[bIdx + 1], "utf8"));
    const g = gate(baseline, scores);
    console.log(g.pass ? "GATE: PASS ✅" : `GATE: FAIL ❌ — ${g.regressions.map((r) => `${r.dim} ${r.baseline}->${r.current}`).join(", ")}`);
    process.exit(g.pass ? 0 : 1);
  }
}
