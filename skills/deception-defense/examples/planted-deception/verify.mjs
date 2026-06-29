// Proof for deception-defense: run the scanner on a fixture app with planted deception
// defects + clean controls, and score precision / recall / FP. Evidence over claims.
//   node --test        (or)   node verify.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { scan } from "../../tools/deception-scan/deception-scan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures");
const expected = JSON.parse(readFileSync(join(here, "expected.json"), "utf8")).planted;

const findings = scan(fixtures);
const key = (f) => `${f.file}|${f.pattern}`;
const expectedKeys = new Set(expected.map((e) => `${e.file}|${e.pattern}`));
const firedKeys = new Set(findings.map(key));

const truePos = [...expectedKeys].filter((k) => firedKeys.has(k));
const falseNeg = [...expectedKeys].filter((k) => !firedKeys.has(k));
const cleanHits = findings.filter((f) => /\.clean\./.test(f.file)).map(key);
const falsePos = [...firedKeys].filter((k) => !expectedKeys.has(k)); // includes any clean-file alarm
const precision = truePos.length / (truePos.length + falsePos.length || 1);
const recall = truePos.length / (expectedKeys.size || 1);

test("clean control files are silent (no false positives)", () => {
  assert.deepEqual(cleanHits, [], `clean files must produce no findings, got: ${cleanHits.join(", ")}`);
});

test("every planted deception defect is caught (recall)", () => {
  assert.deepEqual(falseNeg, [], `missed: ${falseNeg.join(", ")}`);
});

test("precision 1.000 — no false alarms", () => {
  assert.deepEqual(falsePos, [], `false alarms: ${falsePos.join(", ")}`);
  assert.equal(precision, 1);
});

test("summary", () => {
  console.log(`\n  planted defect classes : ${expectedKeys.size}`);
  console.log(`  precision=${precision.toFixed(3)}  recall=${recall.toFixed(3)}  FP=${falsePos.length}`);
  console.log(`  raw findings: ${findings.length} across ${new Set(findings.map((f) => f.file)).size} files`);
  for (const p of [...new Set(findings.map((f) => f.pattern))].sort())
    console.log(`    - ${p}: ${findings.filter((f) => f.pattern === p).length}`);
  assert.ok(recall >= 0.9 && precision === 1, "PASS");
});
