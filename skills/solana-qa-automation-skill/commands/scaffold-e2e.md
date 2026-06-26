---
description: Scaffold a dual-mode (local honest-pending vs live finalized-signature) Playwright + Synpress v4.1+ Phantom e2e skeleton for a Solana dApp — config, wallet cache, a connect→approve→send spec, multi-viewport projects, and console/network instrumentation.
argument-hint: [base-url] [--cluster devnet]
---

Generate a real-wallet e2e skeleton for the dApp in this repo. The wallet tool is **Synpress ≥ 4.1.0** (`@synthetixio/synpress`) driving the **real Phantom extension** — Synpress added Phantom/Solana support in v4.1.0. Do **not** use `dappwright`: it drives MetaMask/Coinbase (EVM) only, cannot unlock Phantom, and cannot approve a Solana tx. Full mechanics and the honesty note on Phantom method names: [../skill/e2e-realwallet.md](../skill/e2e-realwallet.md).

## What to generate

Detect-then-act — prefer the repo's existing scripts/config; only scaffold what's absent, and leave the repo's own tooling intact. Pin `@synthetixio/synpress` and confirm Phantom page-object method names against the pinned build (`node_modules/.../phantom` or its tagged `examples/`).

1. **`playwright.config.ts`** — headed-capable Chromium (the extension needs a display; CI uses `xvfb-run`), `video: 'on'`, `trace: 'retain-on-failure'`, generous timeouts for RPC + confirmation (`live` 90s / `local` 30s), `workers: CI ? 1 : undefined` (real-wallet popups don't parallelize cleanly), `retries: CI ? 2 : 0`, and a `webServer` that starts the dApp. Multi-viewport projects:
   ```ts
   projects: [
     { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] }, grepInvert: /@mobile/ },
     { name: 'mobile-safari',    use: { ...devices['iPhone 14'] },      grep: /@mobile/ },
   ],
   ```

2. **`test/wallet-setup/phantom.setup.ts`** + cache — `defineWalletSetup(PASSWORD, …)` importing a **devnet-only burner seed** from env (`E2E_PHANTOM_SEED`; never hardcode a funded key — see security-secrets), importing the wallet, and pointing Phantom at the target cluster. Build the cache once: `npx synpress test/wallet-setup --phantom` → `.cache-synpress/<hash>` (gitignore it).

3. **`tests/e2e/_mode.ts`** — the dual-mode switch:
   ```ts
   export const MODE = (process.env.E2E_MODE ?? 'local') as 'local' | 'live';
   export const CLUSTER = process.env.SOLANA_CLUSTER ?? 'https://api.devnet.solana.com';
   export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
   export const liveOnly = (fn: () => void) =>
     MODE === 'live' ? fn() : test.skip(true, 'local mode: on-chain assertion skipped (honest-pending)');
   ```

4. **`tests/e2e/_fixtures.ts`** — one configured `test` built from `testWithSynpress(phantomFixtures(phantomSetup))`, exposing `context`, `page`, `phantomPage`, `extensionId`.

5. **A sample spec** — connect → unlock → approve → sign → send, with the mode-aware assertion:
   - Load the dApp, click Connect → choose Phantom; `phantom.connectToDapp()` (unlock + approve).
   - Trigger an action → confirm the Phantom **transaction** popup (`confirmTransaction()` — verify name vs pinned version); plus a SIWS/`signMessage` flow (`confirmSignature()`).
   - **`local` mode (every PR):** honest-pending — the result surface shows `pending`/`null`/`submitted`, **never a fake-zero balance or a fabricated signature**; on-chain assertions `test.skip` loudly.
   - **`live` mode (nightly + pre-release):** assert a **real finalized signature** — base58 shape (`/^[1-9A-HJ-NP-Za-km-z]{86,88}$/`), poll `getSignatureStatuses` to `finalized` with backoff (**no `waitForTimeout`**), `err === null`, and the explorer link points at the real sig.

6. **Instrumentation** — on every context capture console errors, page errors, and failed/4xx/5xx requests to `evidence/`; screenshot `fullPage` in `afterEach` per viewport; in `live` mode write the on-chain read (sig + `confirmationStatus` + `err` + explorer URL) to `evidence/onchain.json`. That JSON + the screenshots back the `e2e` manifest entry for the gate.

## Naming honesty

Name the job for what it actually runs. A job called "live/devnet" that silently runs `local` and skips every on-chain assertion is lying in the Actions UI. `live` mode must produce a finalized signature or it **fails** — it does not `skip`.

After scaffolding, fund the burner (`solana airdrop 2 <pubkey> --url devnet || true`; faucet rate-limited → fall back to a pre-funded CI secret) and run `npx synpress test/wallet-setup --phantom` then `pnpm exec playwright test`. For CI wiring, run `/setup-ci-qa`. To execute the human-level suite end to end, use the **qa-orchestrator** agent.
