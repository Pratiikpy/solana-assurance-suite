// Proof for solana-loops: the Stop-gate refuses to let a loop fake "done", honors
// blocked-with-reason, completes only on real evidence, and can't run forever.
//   node verify.mjs   (or node --test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate } from "../../tools/loop-runner/stop-gate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const made = [];
function freshState(items) {
  const dir = mkdtempSync(join(tmpdir(), "loop-proof-"));
  made.push(dir);
  mkdirSync(join(dir, "proof"), { recursive: true });
  writeFileSync(join(dir, "loop.json"), JSON.stringify({ items }, null, 2));
  return dir;
}
const mark = (dir, id) => writeFileSync(join(dir, "proof", `${id}.ok`), "ok");
const item = (id, status, extra = {}) => ({ id, status, verify: { file: `proof/${id}.ok` }, ...extra });

test("re-verifies: a self-reported 'done' with no proof is NOT done (anti-fake-green)", () => {
  const dir = freshState([item("t1", "done"), item("t2", "done"), item("t3", "done")]); // all claim done, zero proof
  const r = evaluate(dir);
  assert.notEqual(r.decision, "DONE", "must not trust the 'done' flag");
  assert.equal(r.decision, "CONTINUE");
  assert.equal(r.failing.length, 3, "all three re-verified as unsatisfied");
});

test("blocked-with-reason counts as satisfied; blocked-without-reason does not", () => {
  const dir = freshState([
    item("t1", "blocked", { blockReason: "waiting on a mainnet RPC key from the operator" }),
    item("t2", "blocked", { blockReason: "" }),   // no real reason
    item("t3", "done"),                            // claims done, no proof
  ]);
  const r = evaluate(dir);
  const failingIds = r.failing.map((f) => f.id).sort();
  assert.deepEqual(failingIds, ["t2", "t3"], "only the legitimately-blocked item is satisfied");
});

test("DONE only when every item is verified from ground truth", () => {
  const dir = freshState([item("t1", "pending"), item("t2", "pending"), item("t3", "pending")]);
  mark(dir, "t1"); mark(dir, "t2"); mark(dir, "t3");
  const r = evaluate(dir);
  assert.equal(r.decision, "DONE");
  assert.equal(r.satisfied, 3);
});

test("guardrail: STOPs at max sessions instead of looping forever", () => {
  const dir = freshState([item("t1", "pending")]); // never satisfied
  let r = evaluate(dir, { max: 2, stuck: Infinity });
  assert.equal(r.decision, "CONTINUE");
  r = evaluate(dir, { max: 2, stuck: Infinity });
  assert.equal(r.decision, "STOP");
  assert.match(r.reason, /max sessions/);
});

test("guardrail: STOPs when stuck on the same failing item", () => {
  const dir = freshState([item("t1", "pending")]);
  let r = evaluate(dir, { max: Infinity, stuck: 2 });
  assert.equal(r.decision, "CONTINUE");
  r = evaluate(dir, { max: Infinity, stuck: 2 });
  assert.equal(r.decision, "STOP");
  assert.match(r.reason, /stuck/);
});

test("summary", () => {
  console.log("\n  Stop-gate proven: re-verifies (no fake-done) · blocked-with-reason honored · DONE only on real evidence · max-session + stuck guardrails fire.");
  for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
  assert.ok(true);
});
