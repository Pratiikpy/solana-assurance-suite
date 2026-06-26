#!/usr/bin/env node
// Generate a synthetic airdrop-participant dataset with KNOWN ground-truth labels:
//   - 200 legit independent wallets (unique funders, diverse timing/amounts/behavior)
//   - 40 legit wallets funded by ONE CEX hot wallet (the false-positive trap: same
//     funder, but real users => diverse timing/amounts/fingerprints)
//   - 3 sybil farms (one funder each -> 20 wallets, burst timing, identical amount +
//     fingerprint + CEX)
//   - 5 "sophisticated" evasive sybils (unique funders, legit-looking) => SHOULD evade
//     funding-cluster detection (honest recall < 1.0)
// Deterministic via a seeded PRNG so the proof reproduces exactly.

import { writeFileSync } from "node:fs";

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(1337);
const ri = (n) => Math.floor(rand() * n);
const pick = (arr) => arr[ri(arr.length)];

const MONTH = 2592000;
const FP = ["swap", "nft-mint", "stake", "lp", "vote", "memo", "claim", "bridge"];
const CEX = ["coinbase", "binance", "kraken", "okx", null, null];
const wallets = [];
let id = 0;

// 200 legit independent
for (let i = 0; i < 200; i++)
  wallets.push({ id: `L${id++}`, funder: `F${ri(1e6)}`, fundedAt: ri(MONTH),
    amount: [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1][ri(7)], cex: pick(CEX), fingerprint: pick(FP), isSybil: false });

// 40 legit funded by one CEX hot wallet — diverse everything (must NOT be flagged)
for (let i = 0; i < 40; i++)
  wallets.push({ id: `C${id++}`, funder: "CEX_HOT_WALLET", fundedAt: ri(MONTH),
    amount: [0.03, 0.07, 0.12, 0.3, 0.8, 1.5][ri(6)], cex: "binance", fingerprint: pick(FP), isSybil: false });

// 3 sybil farms — one funder, burst, identical amount+fingerprint+cex (must be flagged)
for (let f = 0; f < 3; f++) {
  const funder = `SYBIL_FUNDER_${f}`, t0 = ri(MONTH), amt = [0.011, 0.022, 0.033][f];
  const cx = ["kraken", "coinbase", "okx"][f];
  for (let i = 0; i < 20; i++)
    wallets.push({ id: `S${id++}`, funder, fundedAt: t0 + ri(600), amount: amt, cex: cx, fingerprint: "claim", isSybil: true });
}

// 4 sophisticated sybils using a FRESH funder each (defeats funder-clustering — every
// cluster is size 1) BUT sharing an identical behavioral fingerprint + amount in a tight
// window. Amount 0.09 appears in no legit set, so the cohort signal catches them, FP-free.
const cohortT0 = ri(MONTH);
for (let i = 0; i < 4; i++)
  wallets.push({ id: `E${id++}`, funder: `F${ri(1e6)}`, fundedAt: cohortT0 + ri(500),
    amount: 0.09, cex: pick(CEX), fingerprint: "vote", isSybil: true });
// 1 truly-lone sophisticated sybil: unique funder, unique behavior, spread timing.
// It shares nothing with anyone — it STILL evades. Recall is never 1.0 (honest).
wallets.push({ id: `E${id++}`, funder: `F${ri(1e6)}`, fundedAt: ri(MONTH),
  amount: 0.15, cex: pick(CEX), fingerprint: "memo", isSybil: true });

// shuffle (seeded)
for (let i = wallets.length - 1; i > 0; i--) { const j = ri(i + 1); [wallets[i], wallets[j]] = [wallets[j], wallets[i]]; }

writeFileSync(new URL("./dataset.json", import.meta.url), JSON.stringify({ wallets }, null, 0));
const sybil = wallets.filter((w) => w.isSybil).length;
console.log(`generated ${wallets.length} wallets: ${sybil} sybil (60 single-funder farmed + 4 fresh-funder cohort + 1 lone evader), 40 CEX-funded legit decoys, 200 legit`);
