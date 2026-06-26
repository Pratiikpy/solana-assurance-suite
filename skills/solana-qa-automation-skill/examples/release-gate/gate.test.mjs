import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { qaGate } from "../../tools/qa-gate/qa-gate.mjs";

const read = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url), "utf8"));

test("all-green manifest → RELEASE ALLOWED", () => {
  const g = qaGate(read("./manifest-green.json"));
  assert.equal(g.pass, true);
  assert.equal(g.blockers.length, 0);
});

test("regressed manifest → RELEASE BLOCKED with the right blockers", () => {
  const g = qaGate(read("./manifest-blocked.json"));
  assert.equal(g.pass, false);
  const names = g.blockers.map((b) => b.name).sort();
  // e2e failed, formal was skipped (untested), coverage/lighthouse below min, load p95 over max
  assert.deepEqual(names, ["coverage", "e2e", "formal", "lighthouse", "load-p95ms"]);
});

test("e2e failure blocks the release", () => {
  const g = qaGate(read("./manifest-blocked.json"));
  assert.ok(g.blockers.find((b) => b.name === "e2e"));
});

test("a skipped REQUIRED layer (formal) blocks — you can't ship what you didn't test", () => {
  const g = qaGate(read("./manifest-blocked.json"));
  const formal = g.blockers.find((b) => b.name === "formal");
  assert.ok(formal);
  assert.match(formal.notes.join(), /skipped/);
});

test("a breached non-required layer (uptime) warns but does NOT block", () => {
  const g = qaGate(read("./manifest-blocked.json"));
  assert.ok(!g.blockers.find((b) => b.name === "uptime"));
  assert.ok(g.warnings.find((w) => w.name === "uptime"));
});

test("max-direction metric blocks when exceeded (load p95 640 > 500)", () => {
  const g = qaGate(read("./manifest-blocked.json"));
  const load = g.blockers.find((b) => b.name === "load-p95ms");
  assert.ok(load);
  assert.match(load.notes.join(), /max threshold breached/);
});
