#!/usr/bin/env node
// stop-gate — the objective "are we actually done?" gate for a loop. Zero-dep, Node >= 18.
//
// The whole game of an autonomous loop is defining "done" as something machine-verifiable,
// and refusing to let the agent *declare* done when it isn't (the #1 loop failure mode:
// overconfident termination). This gate re-verifies every item from ground truth and ignores
// the agent's self-reported status, then enforces guardrails so the loop can't run forever.
//
//   node stop-gate.mjs <stateDir> [--max N] [--stuck K]
//     exit 0  → DONE      (every item satisfied — stop, success)
//     exit 2  → STOP      (guardrail tripped: max sessions or stuck — stop, surface to operator)
//     exit 1  → CONTINUE  (work remains — run another iteration)
//
// State (in <stateDir>):
//   loop.json        { items: [{ id, status, verify, blockReason? }], ... }   the checklist
//   loop-state.json  { iter, sig, sameCount }   the loop's own memory (this gate maintains it)
//
// An item counts as SATISFIED only if EITHER:
//   • its objective check passes  (verify.file exists, or verify.cmd exits 0)   — verified-with-proof
//   • status === "blocked" AND blockReason is a real, non-empty string          — blocked-with-reason
// A status of "done" with a failing check is NOT satisfied — the gate re-verifies and overrides.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

export function checkItem(item, stateDir) {
  // objective ground-truth check
  let passed = false, how = "none";
  if (item.verify?.file) { passed = existsSync(join(stateDir, item.verify.file)); how = `file:${item.verify.file}`; }
  else if (item.verify?.cmd) {
    how = `cmd:${item.verify.cmd}`;
    try { execSync(item.verify.cmd, { cwd: stateDir, stdio: "ignore" }); passed = true; }
    catch { passed = false; }
  }
  const blocked = item.status === "blocked" && typeof item.blockReason === "string" && item.blockReason.trim().length > 0;
  return { id: item.id, passed, blocked, satisfied: passed || blocked, how, claimed: item.status };
}

export function evaluate(stateDir, opts = {}) {
  const maxSessions = opts.max ?? Infinity;
  const stuckLimit = opts.stuck ?? Infinity;
  const loop = JSON.parse(readFileSync(join(stateDir, "loop.json"), "utf8"));
  const items = loop.items || [];
  const results = items.map((it) => checkItem(it, stateDir));
  const failing = results.filter((r) => !r.satisfied);

  // load + advance loop memory
  let st = { iter: 0, sig: "", sameCount: 0 };
  try { st = JSON.parse(readFileSync(join(stateDir, "loop-state.json"), "utf8")); } catch {}
  st.iter = (st.iter || 0) + 1;
  const sig = failing.map((r) => r.id).sort().join(",");
  st.sameCount = sig && sig === st.sig ? (st.sameCount || 0) + 1 : 1;
  st.sig = sig;

  let decision, reason;
  if (failing.length === 0) { decision = "DONE"; reason = "every item satisfied (verified or blocked-with-reason)"; }
  else if (st.iter >= maxSessions) { decision = "STOP"; reason = `max sessions reached (${st.iter}/${maxSessions}) with ${failing.length} unsatisfied — surface to operator`; }
  else if (st.sameCount >= stuckLimit) { decision = "STOP"; reason = `stuck: same ${failing.length} item(s) unsatisfied for ${st.sameCount} iterations — surface to operator (don't burn tokens)`; }
  else { decision = "CONTINUE"; reason = `${failing.length} item(s) still unsatisfied`; }

  writeFileSync(join(stateDir, "loop-state.json"), JSON.stringify(st, null, 2));
  return { decision, reason, iter: st.iter, total: items.length, satisfied: results.length - failing.length, failing: failing.map((r) => ({ id: r.id, claimed: r.claimed, how: r.how })), results };
}

const isMain = process.argv[1]?.endsWith("stop-gate.mjs");
if (isMain) {
  const a = process.argv.slice(2);
  const stateDir = a.find((x) => !x.startsWith("--")) || ".";
  const max = a.includes("--max") ? Number(a[a.indexOf("--max") + 1]) : Infinity;
  const stuck = a.includes("--stuck") ? Number(a[a.indexOf("--stuck") + 1]) : Infinity;
  const r = evaluate(stateDir, { max, stuck });
  const C = { DONE: "\x1b[32m", CONTINUE: "\x1b[33m", STOP: "\x1b[31m", reset: "\x1b[0m" };
  console.log(`${C[r.decision]}[${r.decision}]${C.reset} ${r.reason}`);
  console.log(`  iter ${r.iter} · ${r.satisfied}/${r.total} satisfied` + (r.failing.length ? ` · unsatisfied: ${r.failing.map((f) => `${f.id}(claimed:${f.claimed})`).join(", ")}` : ""));
  process.exit(r.decision === "DONE" ? 0 : r.decision === "STOP" ? 2 : 1);
}
