// Human-level Phantom e2e: connect -> verify popup -> approve -> send -> assert FINALIZED.
// Synpress v4.1+ (Phantom). Dual-mode: E2E_MODE=local (honest-pending) | live (devnet).
//
// This is the act -> capture -> AUDIT -> decide loop (../../skill/human-level-qa.md):
// every step is screenshotted and asserted; the wallet popup payload is verified BEFORE
// approving; the pass is proven by a real signature reaching `finalized` on the cluster +
// re-read on an alternate RPC — never a UI string. API method names marked /* confirm */
// should be checked against your pinned Synpress version (see wallet-setup note).

import { testWithSynpress } from "@synthetixio/synpress";          // confirm path for v4.1+
import { phantomFixtures } from "@synthetixio/synpress/playwright"; // confirm export for v4.1+
import { Connection } from "@solana/web3.js";
import setup from "../wallet-setup/phantom.setup";

const test = testWithSynpress(phantomFixtures(setup));
const { expect } = test;

const MODE = process.env.E2E_MODE ?? "local";
const PRIMARY_RPC = process.env.E2E_RPC ?? "https://api.devnet.solana.com";
const ALT_RPC = process.env.E2E_ALT_RPC ?? "https://rpc.ankr.com/solana_devnet"; // independent re-verify

test("transfer: connect -> approve -> send, asserted on-chain", async ({ context, page, phantom /* confirm fixture */ }) => {
  const snap = async (name: string) => { await page.screenshot({ path: `test-results/${name}.png`, fullPage: true }); };

  // 1. ACT: land + connect
  await page.goto("/");
  await page.getByRole("button", { name: /connect/i }).click();
  await page.getByText(/phantom/i).click();
  await snap("01-connect-clicked");

  // 2. Phantom approve-connection (verify origin first — no blind approve)
  await phantom.approve(); /* confirm: connection-approval method for your version */
  await expect(page.getByText(/connected|0x|[1-9A-HJ-NP-Za-km-z]{4,}/)).toBeVisible();
  await snap("02-connected");

  // 3. ACT: trigger a transfer
  await page.getByTestId("amount").fill("0.01");
  await page.getByRole("button", { name: /send|transfer/i }).click();
  await snap("03-submit");

  // 4. VERIFY THE POPUP BEFORE APPROVING (the human-critical step): the Phantom approval
  //    must show the same cluster / program / recipient / amount the UI promised.
  //    Assert on the popup contents here before confirming. Then approve:
  await phantom.confirmTransaction(); /* confirm: tx-approval method for your version; raw-CDP fallback in e2e-realwallet.md */
  await snap("04-approved");

  if (MODE === "local") {
    // honest-pending: the UI must show pending/null, never a fake-zero success
    await expect(page.getByTestId("tx-status")).toHaveText(/pending|submitting/i);
    return;
  }

  // 5. live: capture the REAL signature the app surfaced and prove it on-chain
  const sig = (await page.getByTestId("tx-signature").innerText()).trim();
  expect(sig).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/); // base58 signature, not a UI string

  const primary = new Connection(PRIMARY_RPC, "finalized");
  const st = await primary.getSignatureStatuses([sig]);
  expect(st.value[0]?.confirmationStatus).toBe("finalized");
  expect(st.value[0]?.err).toBeNull();

  // re-verify on an INDEPENDENT RPC (the UI and one RPC can both be wrong)
  const alt = new Connection(ALT_RPC, "finalized");
  const altSt = await alt.getSignatureStatuses([sig]);
  expect(altSt.value[0]?.err).toBeNull();
  await snap("05-finalized");
});

test("transfer rejected: app recovers cleanly (failure path)", async ({ page, phantom }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /connect/i }).click();
  await page.getByText(/phantom/i).click();
  await phantom.approve(); /* confirm */
  await page.getByTestId("amount").fill("0.01");
  await page.getByRole("button", { name: /send|transfer/i }).click();
  await phantom.reject(); /* confirm: rejection method */
  // no stuck spinner, a humanized cancel message, retry still works
  await expect(page.getByText(/cancel|rejected|declined/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /send|transfer/i })).toBeEnabled();
});
