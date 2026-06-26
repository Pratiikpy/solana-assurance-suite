import { defineConfig, devices } from "@playwright/test";

// Synpress + Phantom needs a HEADED real Chromium (MV3 extension). On Linux CI, wrap with xvfb.
// Generous timeouts: Solana confirmations + the extension popup loop are slow.
export default defineConfig({
  testDir: "./tests",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,        // deterministic order: nonces/blockhash/shared state settle predictably
  retries: 0,        // never paper over a real failure with a retry (see human-level-qa.md)
  use: {
    headless: false, // real Phantom extension
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    video: "on",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    permissions: ["clipboard-read", "clipboard-write"],
  },
  // every user-facing flow on desktop AND mobile viewport
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  // let Playwright start the dApp, or set E2E_BASE_URL to a deployed preview
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "pnpm dev", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000 },
});
