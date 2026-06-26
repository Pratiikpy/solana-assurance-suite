# Eligibility Export — Producing the Claimant Set (June 2026)

The scan gives you a verdict per wallet. This file turns that into the artifact a distribution actually consumes: a **merkle root** committed on-chain and a set of **proofs** handed to claimants. Plus the methodology you publish so the result is defensible. Detection that never produces a clean claimant list is a research project, not an airdrop.

## Step 1 — filter to the eligible set

The engine's [`eligibility()`](../tools/sybil-scan/sybil-scan.mjs) helper does exactly this. Two policies:

```js
import { scan, eligibility } from "../tools/sybil-scan/sybil-scan.mjs";
const result = scan(wallets);

// (a) strict: drop every flagged wallet
const eligible = eligibility(wallets, result);

// (b) one-representative-per-cluster: keep a single wallet from each sybil cluster.
//     Use when policy is "a farm is still one human who deserves one allocation."
const eligibleRep = eligibility(wallets, result, { keepRepresentative: true });
```

`keepRepresentative` is a real policy lever, not a hack. A 20-wallet farm is usually one operator; collapsing it to one claim is often *fairer* and far less litigable than a blanket zero — the operator can't credibly complain about getting one allocation, and you avoid the "you denied my main wallet too" appeal. Pick per launch; document which you chose ([scoring-and-thresholds.md](scoring-and-thresholds.md) covers allowlist/denylist overrides you apply here too).

Apply overrides, then materialize allocations:

```js
const allow = new Set(["TEAM_WALLET", /* ... */]);
const finalEligible = [...new Set([...eligible, ...[...allow]])];

// allocation policy: flat, weighted-by-activity, capped — your call. Flat shown.
const PER_WALLET = 100_000_000n;                 // base units (e.g. 100 tokens @ 6 decimals)
const allocations = finalEligible.map(id => ({ claimant: id, amount: PER_WALLET }));
```

## Step 2 — build the merkle tree

The on-chain standard is the **jito-foundation/distributor** program (`merkle-distributor`, program ID `mERKcfxMC5SqJn4Ld4BUris3WKZZ1ojjWJ3A3J5CKxv`) and its forks (`@streamflow/distributor`, ProjectOpenSea's `merkle-distributor-svm`). All share the same idea: commit a 32-byte root on-chain, store the tree off-chain, claimants present a proof. See [resources.md](resources.md) for repos/versions.

Each leaf is the hash of `(index, claimant, amount)`. Match the program's exact leaf encoding (jito's uses `keccak256` over the borsh-packed node, double-hashed at the leaf to avoid second-preimage attacks); below is a self-contained, dependency-light builder that mirrors the layout. **In production, generate the tree with the distributor's own CLI/SDK so the encoding is guaranteed to match the on-chain verifier** — a mismatched hash function means every proof fails.

```js
import { keccak_256 as keccak } from "@noble/hashes/sha3";   // or the program's hasher

const u8 = (s) => new TextEncoder().encode(s);               // placeholder; use real pubkey bytes
const concat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const le8 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };

function leafHash(index, claimant, amount) {
  // double-hash the leaf (preimage-resistance), matching distributor convention
  return keccak(concat(keccak(concat(le8(index), pubkeyBytes(claimant), le8(amount)))));
}

function buildTree(entries) {                                // entries: [{claimant, amount}]
  const leaves = entries.map((e, i) => leafHash(i, e.claimant, e.amount));
  const layers = [leaves];
  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1], next = [];
    for (let i = 0; i < prev.length; i += 2) {
      const a = prev[i], b = prev[i + 1] ?? prev[i];         // dup last if odd
      const [lo, hi] = compare(a, b) <= 0 ? [a, b] : [b, a]; // sorted pair (commutative)
      next.push(keccak(concat(lo, hi)));
    }
    layers.push(next);
  }
  return { root: layers[layers.length - 1][0], layers };
}

function proofFor(layers, index) {
  const proof = [];
  for (let l = 0; l < layers.length - 1; l++) {
    const layer = layers[l];
    const pair = index ^ 1;                                  // sibling
    if (pair < layer.length) proof.push(layer[pair]);
    index >>= 1;
  }
  return proof;
}
function compare(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; }
```

## Step 3 — export root + proofs

```js
import { writeFileSync } from "node:fs";
const entries = allocations.map(a => ({ claimant: a.claimant, amount: a.amount.toString() }));
const { root, layers } = buildTree(entries);

const tree = {
  merkleRoot: Buffer.from(root).toString("hex"),
  mint: process.env.MINT,
  total: entries.reduce((n, e) => n + BigInt(e.amount), 0n).toString(),
  claimants: entries.map((e, i) => ({
    index: i, claimant: e.claimant, amount: e.amount,
    proof: proofFor(layers, i).map(h => Buffer.from(h).toString("hex")),
  })),
};
writeFileSync("merkle_tree.json", JSON.stringify(tree, null, 2));
console.log("root", tree.merkleRoot, "| claimants", tree.claimants.length);
```

Deploy the root with the distributor CLI (jito): `./target/release/cli new-distributor --mint <MINT> --merkle-tree-path merkle_tree.json …`, then a claimant runs `… claim --merkle-tree-path merkle_tree.json` with their keypair. Your claim UI fetches that claimant's `proof` from the published tree and submits it. On-chain enforcement of the proof at claim time is in [integration.md](integration.md).

## Step 4 — make the methodology publishable

A merkle root is opaque; transparency is what makes an airdrop trusted rather than accused. Publish, alongside the root:

- **The root and tree.** Pin `merkle_tree.json` to IPFS/Arweave and reference the CID in your announcement. Anyone can recompute the root from it and confirm it matches what's on-chain — that single check proves you didn't quietly edit the list after publishing.
- **The exclusion report.** From `result.clusters`, publish each suspicious cluster: funder, size, which signals fired — and from `result.cohorts`, each cross-funder behavioral cohort: its `(fingerprint|amount)` key, size, distinct-funder count, and window. Not the verdict in isolation — the *evidence*. (Don't dox legit users; publish funders, keys, and counts, not full per-wallet histories.)
- **The numbers, honestly.** Candidates, eligible, flagged, clusters, and your validation metrics. From the [planted-cluster proof](../examples/planted-cluster/): precision 1.0, recall 0.985 — "0 legit users excluded, ~1.5% of sophisticated sybils evade funding-graph detection (one truly-lone wallet sharing no funder, behavior, or timing)." State the limitation; see [scoring-and-thresholds.md](scoring-and-thresholds.md).
- **The config.** `minCluster`, `burstWindow`, `uniformity`, the two-signal rule, `keepRepresentative` on/off. Reproducibility = trust.
- **The appeals link.** Always.

```js
const methodology = {
  generatedAt: new Date().toISOString(),
  totals: { candidates: wallets.length, eligible: finalEligible.length,
            flagged: result.flaggedCount, suspiciousClusters: result.clusters.filter(c => c.suspicious).length,
            behavioralCohorts: result.cohorts.length },
  config: { minCluster: 5, burstWindow: 3600, uniformity: 0.7, requireSignals: 2, cohortMin: 4, cohortWindow: 900, keepRepresentative: false },
  validation: { dataset: "planted-cluster", precision: 1.0, recall: 0.985, f1: 0.992, falsePositives: 0 },
  limitations: "Funding-graph clustering cannot detect a truly-lone sybil that shares no funder, behavior, amount, or timing with any other wallet (~1.5% on validation). The cross-funder behavioral-cohort signal catches fresh-funder farms; a single hand-built wallet still evades. Layered with proof-of-humanity at claim time.",
  clusters: result.clusters.filter(c => c.suspicious).map(c => ({ funder: c.funder, size: c.size, signals: c.signals, risk: c.risk })),
  cohorts: result.cohorts.map(c => ({ key: c.key, size: c.size, distinctFunders: c.distinctFunders, window: c.window })),
  merkleRoot: tree.merkleRoot,
  treeCid: "ipfs://…",
  appeals: "https://…",
};
writeFileSync("methodology.json", JSON.stringify(methodology, null, 2));
```

The whole point: a third party can take `methodology.json` + `merkle_tree.json`, recompute the root, see exactly who was excluded and why, and reproduce your scan from the published config. That is what turns "trust us" into "verify us."

_Last verified: June 2026_
