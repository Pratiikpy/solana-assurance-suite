#!/usr/bin/env node
// Run sybil-scan on the planted dataset and assert it recovers the planted farms with
// high precision/recall WITHOUT flagging the CEX-funded legit decoys. Also reports what
// a naive "same funder => sybil" baseline would have wrongly flagged, to show the
// multi-signal approach is non-trivial. Exits non-zero on failure (CI gate).

import { readFileSync } from "node:fs";
import { scan } from "../../tools/sybil-scan/sybil-scan.mjs";

const { wallets } = JSON.parse(readFileSync(new URL("./dataset.json", import.meta.url), "utf8"));
const { flagged, clusters, cohorts } = scan(wallets);

let tp = 0, fp = 0, fn = 0, tn = 0;
const falsePositives = [];
for (const w of wallets) {
  const pred = flagged.has(w.id);
  if (w.isSybil && pred) tp++;
  else if (!w.isSybil && pred) { fp++; falsePositives.push(w.id); }
  else if (w.isSybil && !pred) fn++;
  else tn++;
}
const precision = tp / (tp + fp || 1);
const recall = tp / (tp + fn || 1);
const f1 = (2 * precision * recall) / (precision + recall || 1);

// naive funder-only baseline
const counts = new Map();
for (const w of wallets) counts.set(w.funder, (counts.get(w.funder) || 0) + 1);
let naiveFalseFlags = 0;
for (const w of wallets) if (!w.isSybil && counts.get(w.funder) >= 5) naiveFalseFlags++;

console.log(`flagged ${flagged.size} wallets | TP=${tp} FP=${fp} FN=${fn} TN=${tn}`);
console.log(`precision=${precision.toFixed(3)}  recall=${recall.toFixed(3)}  f1=${f1.toFixed(3)}`);
console.log(`false positives: ${falsePositives.length ? falsePositives.join(",") : "none"}`);
console.log(`evaded (truly-lone sophisticated sybils missed): ${fn}`);
const freshFunderCohorts = cohorts.filter((c) => c.distinctFunders > 1);
console.log(`cross-funder behavioral cohorts caught: ${freshFunderCohorts.length} (${freshFunderCohorts.map((c) => `${c.key} x${c.size}`).join(", ") || "none"})`);
console.log(`naive "same-funder" baseline would FALSE-FLAG ${naiveFalseFlags} legit wallets (the CEX-funded users); multi-signal FP=${fp}`);

// Gate: high precision (no legit users punished), strong recall (the cohort signal lifts it
// past the funder-clustering ceiling), strictly better than naive on false positives, and the
// fresh-funder cohort must be caught.
const PASS = precision >= 0.95 && recall >= 0.95 && fp < naiveFalseFlags && freshFunderCohorts.length >= 1;
console.log(PASS ? "PASS ✅" : "FAIL ❌");
process.exit(PASS ? 0 : 1);
