import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeEmitterAllowlist,
  makeReplayGuard,
  trimToWire,
  untrimFromWire,
  resolveCctpRoute,
  CCTP_DOMAINS,
  finalityMet,
  CCTP_FINALITY,
} from "../src/guards.mjs";

test("emitter allowlist accepts known, rejects unknown and chain-mismatched", () => {
  const isAllowed = makeEmitterAllowlist([
    { chain: "ethereum", address: "0xABCdef0000000000000000000000000000000001" },
  ]);
  assert.equal(isAllowed("ethereum", "0xabcDEF0000000000000000000000000000000001"), true); // case-insensitive
  assert.equal(isAllowed("ethereum", "0x0000000000000000000000000000000000000002"), false); // wrong emitter
  assert.equal(isAllowed("polygon", "0xABCdef0000000000000000000000000000000001"), false); // right emitter, wrong chain
});

test("replay guard consumes a message once and rejects the replay", () => {
  const g = makeReplayGuard();
  const h = "vaa-hash-deadbeef";
  assert.equal(g.consume(h), true);  // first time → accept
  assert.equal(g.consume(h), false); // replay → reject (Nomad class)
  assert.equal(g.size(), 1);
});

test("decimal normalization conserves value and isolates dust (9dp → 8dp wire → 6dp)", () => {
  // 1.000000009 of a 9-decimal Solana token
  const amount = 1_000_000_009n;
  const { wire, dust } = trimToWire(amount, 9);
  assert.equal(wire, 100_000_000n); // 1.00000000 at the 8-dp wire
  assert.equal(dust, 9n);           // the 9th-decimal remainder stays on the source

  const credited = untrimFromWire(wire, 6); // mint on a 6-dp chain
  assert.equal(credited, 1_000_000n);       // exactly 1.000000 — correct

  // Conservation: what's credited (re-expressed at 9dp) + dust == original.
  assert.equal(untrimFromWire(wire, 9) + dust, amount);

  // The bug this prevents: naively copying the raw amount into a 6-dp credit
  // would mint 1000.000009 tokens — a 1000x over-credit.
  assert.notEqual(amount, credited);
});

test("decimal normalization scales up when destination has more decimals (6dp → 9dp)", () => {
  const amount = 5_000_000n; // 5.000000 USDC-like (6dp)
  const { wire, dust } = trimToWire(amount, 6); // 6 <= 8 → scale up, no dust
  assert.equal(dust, 0n);
  assert.equal(wire, 500_000_000n);
  assert.equal(untrimFromWire(wire, 9), 5_000_000_000n); // 5.000000000 at 9dp
});

test("CCTP route resolves Solana(5) and rejects identical/unknown domains", () => {
  assert.equal(CCTP_DOMAINS.solana, 5);
  assert.deepEqual(resolveCctpRoute("solana", "base"), { sourceDomain: 5, destinationDomain: 6 });
  assert.throws(() => resolveCctpRoute("solana", "solana"), /identical/);
  assert.throws(() => resolveCctpRoute("solana", "dogechain"), /unknown CCTP destination/);
});

test("finality gate blocks release below the required threshold", () => {
  assert.equal(finalityMet(CCTP_FINALITY.FAST, CCTP_FINALITY.FINALIZED), false); // fast < finalized
  assert.equal(finalityMet(CCTP_FINALITY.FINALIZED, CCTP_FINALITY.FINALIZED), true);
});
