#!/usr/bin/env node
// sybil-scan — cluster wallets by funding/behavioral signals and score sybil risk.
// Zero dependencies (Node >= 18). Library + CLI.
//
//   node sybil-scan.mjs <participants.json> [--out report.json] [--min 5] [--threshold 50]
//
// Input JSON: { "wallets": [ { id, funder, fundedAt(unix s), amount, cex, fingerprint }, ... ] }
//   - funder:      the address that first funded the wallet (the funding edge)
//   - fundedAt:    unix seconds of that first funding
//   - amount:      funding amount (SOL)
//   - cex:         exchange/deposit tag if the funding traces to one (nullable)
//   - fingerprint: a behavioral signature (e.g. ordered set of programs touched)
//
// The detector groups by funder, then requires MULTIPLE corroborating signals
// (timing burst + amount uniformity + shared behavior/CEX) before flagging — so a
// CEX hot wallet that funds many *legitimate* users (diverse timing/amounts) is NOT
// flagged, while a sybil farm (one funder, burst, identical amounts) is. Naive
// "same funder => sybil" over-flags; this does not.

import { readFileSync, writeFileSync } from "node:fs";

export function scan(wallets, opts = {}) {
  const MIN = opts.minCluster ?? 5;       // min wallets per funder to even consider
  const BURST = opts.burstWindow ?? 3600; // seconds; tighter => more suspicious
  const UNIF = opts.uniformity ?? 0.7;    // share of a cluster matching the mode
  const COHORT_MIN = opts.cohortMin ?? 4;       // min wallets to call a behavioral cohort
  const COHORT_WINDOW = opts.cohortWindow ?? 900; // seconds; tight burst of identical behavior

  const byFunder = new Map();
  for (const w of wallets) {
    if (!byFunder.has(w.funder)) byFunder.set(w.funder, []);
    byFunder.get(w.funder).push(w);
  }

  const modeShare = (ws, key) => {
    const counts = {};
    let total = 0;
    for (const w of ws) {
      const v = w[key];
      if (v === null || v === undefined) continue;
      counts[v] = (counts[v] || 0) + 1;
      total++;
    }
    if (!total) return 0;
    return Math.max(...Object.values(counts)) / ws.length;
  };

  const clusters = [];
  const flagged = new Set();
  for (const [funder, ws] of byFunder) {
    const size = ws.length;
    const times = ws.map((w) => w.fundedAt);
    const spread = Math.max(...times) - Math.min(...times);
    const burst = spread <= BURST;
    const amountUniform = modeShare(ws, "amount") >= UNIF;
    const fpShared = modeShare(ws, "fingerprint") >= UNIF;
    const cexShared = modeShare(ws, "cex") >= UNIF;

    const signals = { burst, amountUniform, fpShared, cexShared };
    const signalCount = Object.values(signals).filter(Boolean).length;
    // Require size + at least TWO corroborating signals. cex-only (1 signal) is not
    // enough — that's the CEX-funded-legit case.
    const suspicious = size >= MIN && signalCount >= 2;
    const risk = suspicious
      ? Math.min(100, 40 + Math.min(size, 30) + signalCount * 8)
      : size >= MIN ? 20 : 0;

    if (suspicious) for (const w of ws) flagged.add(w.id);
    clusters.push({ funder, size, spread, signals, signalCount, suspicious, risk });
  }

  // ── Cross-funder behavioral cohorts ──────────────────────────────────────────
  // A scripted farm that uses a FRESH funder per wallet defeats funder-clustering
  // entirely (every cluster is size 1). But the wallets still betray themselves:
  // they share an identical behavioral fingerprint + amount and fire in a tight
  // window. Group by (fingerprint|amount); inside each group, slide a window and
  // flag any burst of >= COHORT_MIN — even when every funder is distinct.
  const byBehavior = new Map();
  for (const w of wallets) {
    const k = `${w.fingerprint}|${w.amount}`;
    if (!byBehavior.has(k)) byBehavior.set(k, []);
    byBehavior.get(k).push(w);
  }
  const cohorts = [];
  for (const [key, ws] of byBehavior) {
    if (ws.length < COHORT_MIN) continue;
    const sorted = [...ws].sort((a, b) => a.fundedAt - b.fundedAt);
    let i = 0;
    for (let j = 0; j < sorted.length; j++) {
      while (sorted[j].fundedAt - sorted[i].fundedAt > COHORT_WINDOW) i++;
      if (j - i + 1 >= COHORT_MIN) {
        const members = sorted.slice(i, j + 1);
        const distinctFunders = new Set(members.map((m) => m.funder)).size;
        for (const m of members) flagged.add(m.id);
        cohorts.push({ key, size: members.length, distinctFunders, window: sorted[j].fundedAt - sorted[i].fundedAt, members: members.map((m) => m.id) });
        break; // one record per behavior key is enough for the report
      }
    }
  }

  clusters.sort((a, b) => b.risk - a.risk);
  return { clusters, cohorts, flagged, flaggedCount: flagged.size, total: wallets.length };
}

// Produce an eligibility list: drop flagged wallets (optionally keep 1 representative
// per sybil cluster). Returns the wallet ids that pass.
export function eligibility(wallets, result, { keepRepresentative = false } = {}) {
  const flagged = result.flagged;
  if (!keepRepresentative) return wallets.filter((w) => !flagged.has(w.id)).map((w) => w.id);
  const seenFunder = new Set();
  const out = [];
  for (const w of wallets) {
    if (!flagged.has(w.id)) { out.push(w.id); continue; }
    if (!seenFunder.has(w.funder)) { seenFunder.add(w.funder); out.push(w.id); } // 1 rep
  }
  return out;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("sybil-scan.mjs")) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("-"));
  if (!file) { console.error("usage: node sybil-scan.mjs <participants.json> [--out r.json]"); process.exit(1); }
  const outIdx = args.indexOf("--out");
  const { wallets } = JSON.parse(readFileSync(file, "utf8"));
  const result = scan(wallets, {});
  const eligible = eligibility(wallets, result);
  const suspiciousClusters = result.clusters.filter((c) => c.suspicious);
  console.log(`sybil-scan: ${wallets.length} wallets, ${byCount(result.clusters)} funders`);
  console.log(`  suspicious clusters: ${suspiciousClusters.length}`);
  console.log(`  behavioral cohorts:  ${result.cohorts.length}`);
  console.log(`  flagged wallets:     ${result.flaggedCount}`);
  console.log(`  eligible wallets:    ${eligible.length}`);
  for (const c of suspiciousClusters.slice(0, 10)) {
    const s = Object.entries(c.signals).filter(([, v]) => v).map(([k]) => k).join("+");
    console.log(`  ⚠️  ${c.funder}: ${c.size} wallets, risk ${c.risk}, signals=[${s}]`);
  }
  for (const c of result.cohorts.filter((c) => c.distinctFunders > 1).slice(0, 10)) {
    console.log(`  ⚠️  cohort [${c.key}]: ${c.size} wallets across ${c.distinctFunders} distinct funders in ${c.window}s (fresh-funder farm)`);
  }
  if (outIdx >= 0) {
    writeFileSync(args[outIdx + 1], JSON.stringify({ result, eligible }, null, 2));
    console.log(`  wrote ${args[outIdx + 1]}`);
  }
}
function byCount(clusters) { return clusters.length; }
