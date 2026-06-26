// bridge-guards — the verification logic every cross-chain integrator needs, as
// pure, testable functions. These are the checks whose ABSENCE caused the big bridge
// hacks: unverified/duplicated messages (Wormhole/Nomad), unrestricted emitters, and
// silent decimal mismatches. Zero dependencies; BigInt for token amounts.

// ── Emitter allowlist ────────────────────────────────────────────────────────
// Consume a cross-chain message ONLY from a known (chain, emitter) pair. An open
// consumer is how a forged message gets minted. Addresses compared case-insensitively.
export function makeEmitterAllowlist(entries) {
  const set = new Set(entries.map((e) => `${e.chain}:${String(e.address).toLowerCase()}`));
  return function isAllowed(chain, address) {
    return set.has(`${chain}:${String(address).toLowerCase()}`);
  };
}

// ── Replay guard ─────────────────────────────────────────────────────────────
// Every attestation/VAA must be consumed at most once. Nomad's $190M loss was a
// replay of a trusted message. Track the message hash; reject the second use.
export function makeReplayGuard() {
  const seen = new Set();
  return {
    consume(messageHash) {
      if (seen.has(messageHash)) return false; // replay → reject
      seen.add(messageHash);
      return true;
    },
    has: (h) => seen.has(h),
    size: () => seen.size,
  };
}

// ── Cross-chain decimal normalization ────────────────────────────────────────
// Wormhole NTT trims token amounts to an 8-decimal wire format for EVM compatibility.
// Copying a raw amount across chains with different decimals silently mis-credits by
// orders of magnitude. Normalize explicitly; keep the un-representable remainder as dust.
export const NTT_WIRE_DECIMALS = 8;

export function trimToWire(amount, fromDecimals, wireDecimals = NTT_WIRE_DECIMALS) {
  if (typeof amount !== "bigint") throw new TypeError("amount must be a BigInt");
  if (fromDecimals <= wireDecimals) {
    return { wire: amount * 10n ** BigInt(wireDecimals - fromDecimals), dust: 0n };
  }
  const factor = 10n ** BigInt(fromDecimals - wireDecimals);
  return { wire: amount / factor, dust: amount % factor }; // dust stays on the source chain
}

export function untrimFromWire(wire, toDecimals, wireDecimals = NTT_WIRE_DECIMALS) {
  if (typeof wire !== "bigint") throw new TypeError("wire must be a BigInt");
  if (toDecimals >= wireDecimals) {
    return wire * 10n ** BigInt(toDecimals - wireDecimals);
  }
  return wire / 10n ** BigInt(wireDecimals - toDecimals);
}

// ── CCTP domain routing ──────────────────────────────────────────────────────
// CCTP identifies chains by numeric domain (NOT chain id). Solana is domain 5.
// Sending to the wrong/identical domain burns funds you can't mint back.
export const CCTP_DOMAINS = Object.freeze({
  ethereum: 0, avalanche: 1, optimism: 2, arbitrum: 3,
  noble: 4, solana: 5, base: 6, polygon: 7,
});

export function resolveCctpRoute(srcName, dstName) {
  const source = CCTP_DOMAINS[srcName];
  const destination = CCTP_DOMAINS[dstName];
  if (source === undefined) throw new Error(`unknown CCTP source domain: ${srcName}`);
  if (destination === undefined) throw new Error(`unknown CCTP destination domain: ${dstName}`);
  if (source === destination) throw new Error("source and destination domain are identical");
  return { sourceDomain: source, destinationDomain: destination };
}

// ── Finality gate ────────────────────────────────────────────────────────────
// Do not release/mint on the destination until the source reached required finality.
// CCTP v2: 1000 = Fast, 2000 = Standard/Finalized.
export const CCTP_FINALITY = Object.freeze({ FAST: 1000, FINALIZED: 2000 });
export function finalityMet(observedThreshold, required) {
  return observedThreshold >= required;
}
