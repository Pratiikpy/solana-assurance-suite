// Phantom wallet setup for Synpress v4.1+ (the Phantom/Solana-capable e2e tool).
// Builds a cached, pre-imported Phantom profile so specs start signed-in-capable.
//
//   npx synpress  ->  compiles this into .cache-synpress/ (a warmed Phantom profile)
//
// NOTE: Synpress added Phantom support in v4.1.0. The wallet-cache + importWallet API
// is documented; some per-method Phantom transaction-approval names are still an open
// docs gap (synpress#1246) — confirm the exact import path/method names against the
// Synpress version you pin. The raw-CDP fallback recipe in
// ../../skill/e2e-realwallet.md works even where a wrapped method isn't exposed yet.

import { defineWalletSetup } from "@synthetixio/synpress"; // confirm path for your pinned v4.1+
import { Phantom } from "@synthetixio/synpress/playwright"; // confirm export name for your version

// Deterministic TEST-ONLY seed. NEVER a mainnet seed. Fund this wallet on devnet.
// Pull from env so it is never committed; .gitignore excludes keys.
const SEED = process.env.E2E_PHANTOM_SEED ?? "test test test test test test test test test test test junk";
const PASSWORD = process.env.E2E_PHANTOM_PASSWORD ?? "TestPassword!123";

export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
  const phantom = new Phantom(context, walletPage, PASSWORD);
  await phantom.importWallet(SEED);
  // Optionally switch Phantom to the test cluster (devnet) here if your build needs it.
  // await phantom.switchNetwork("Devnet");  // confirm method name for your version
});
