import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluate, gate } from "../../tools/agent-eval/eval.mjs";

const read = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url), "utf8"));
const golden = read("./golden.json");
const v1 = read("./agent-v1.json");
const v2 = read("./agent-v2.json");

test("agent v1 (correct) scores perfectly across all dimensions", () => {
  const { scores } = evaluate(golden, v1);
  assert.equal(scores.tool, 1);
  assert.equal(scores.program, 1);
  assert.equal(scores.accounts, 1);
  assert.equal(scores.buildable, 1);
  assert.equal(scores.overall, 1);
});

test("agent v2 (dropped the SPL `mint` account) regresses on accounts + buildable", () => {
  const { scores, perTask } = evaluate(golden, v2);
  // transfer-spl had 4 expected accounts, produced 3 → Jaccard 3/4 = 0.75, not buildable
  const spl = perTask.find((t) => t.id === "transfer-spl");
  assert.equal(spl.accounts, 0.75);
  assert.equal(spl.buildable, 0);
  assert.ok(scores.accounts < 1, "accounts dimension should drop");
  assert.ok(scores.buildable < 1, "buildable dimension should drop");
  assert.ok(scores.overall < 1, "overall should regress");
});

test("CI gate FIRES on the regression (v1 baseline vs v2 current)", () => {
  const base = evaluate(golden, v1).scores;
  const cur = evaluate(golden, v2).scores;
  const g = gate(base, cur);
  assert.equal(g.pass, false, "gate must catch the regression");
  const dims = g.regressions.map((r) => r.dim);
  assert.ok(dims.includes("accounts"));
  assert.ok(dims.includes("buildable"));
});

test("CI gate PASSES when current matches baseline (no false alarm)", () => {
  const base = evaluate(golden, v1).scores;
  const same = evaluate(golden, v1).scores;
  assert.equal(gate(base, same).pass, true);
});
