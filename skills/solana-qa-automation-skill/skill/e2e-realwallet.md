# L3 — Human-level E2E against a real Phantom wallet

> The only layer that proves a human can actually drive your dApp: open it, connect Phantom, **read the approval popup before signing**, approve a tx, sign a SIWS message, and watch a **real signature reach `finalized`** — re-verified on a second RPC. Everything below it ([unit-property.md](unit-property.md), [integration-indexer.md](integration-indexer.md), [formal.md](formal.md)) can be green while the connect button is broken. This is the **Phantom mechanics** file; the **methodology** — the act→audit loop, adversarial coverage, the launch-ready gate — lives in [human-level-qa.md](human-level-qa.md). E2E feeds the gate ([release-gate.md](release-gate.md)). Program correctness is delegated to [../solana-testing](../solana-testing/SKILL.md).

## Tool: Synpress v4.1+, not dappwright

Use **Synpress ≥ 4.1.0** (`@synthetixio/synpress`). Synpress is Playwright-based and **added Phantom/Solana support in v4.1.0** (announced 2026; `synpress.io/integrations` lists Phantom). It side-loads the *real* Phantom MV3 extension — real keypair, real popups, real signatures.

Do **not** use `dappwright`: MetaMask / Coinbase only, EVM-only, no Phantom, no Solana. If a guide says `dappwright.launch('phantom')`, it's wrong.

> **Honesty note — verify before you trust a method name.** Synpress's *published* docs fully cover the MetaMask Playwright class (`connectToDapp`, `confirmTransaction`, `signMessage`, …) and the Phantom **wallet-cache** flow (`defineWalletSetup`, `importWallet`, `synpress --phantom`, `.cache-synpress`, `*.setup.ts`). The exact Phantom **transaction-approval** method names are **not yet in the published docs as of June 2026** (tracked in synpress-io/synpress#1246 — v4.1 shipped examples ahead of docs). The Phantom page-object methods below (`connectToDapp`, `confirmTransaction`, `confirmSignature`) mirror the MetaMask class shape and the shipped examples. **Pin your `@synthetixio/synpress` version and confirm the real names against `node_modules/@synthetixio/synpress/.../phantom` or the repo `examples/` for that tag.** Names that are load-bearing are flagged "confirm vs pinned." When Synpress's wrapper drops a click on a Phantom popup (MV3 React repaint, §"Raw-CDP fallback"), fall back to the raw recipe below — that recipe is grounded in the real-extension pattern and does not depend on unverified method names.

Alternates: **Backpack**, **Solflare** ship similar extensions. Lead with Phantom (largest base, best Synpress coverage); the flow is wallet-agnostic in shape — swap the page object + seed.

## Two modes — honest about what each proved

Mirrors the arb-builder dual-mode pattern (`E2E_MODE` default `local`, `local` vs `sepolia`; see `apps/verify/playwright.config.ts`). On Solana:

| Mode | Cluster | Asserts | Runs |
|------|---------|---------|------|
| `local` | none / surfpool / `solana-test-validator` | **Honest-pending**: connect + sign succeed; result surface shows `pending`/`null`, **never fake-zero, never a fabricated sig**. On-chain asserts `test.skip` — loudly. | every PR |
| `live` | devnet (mainnet gated) | A **real finalized signature**: `getSignatureStatuses` → `confirmed`→`finalized`, `err === null`, receipt resolves on Solana Explorer / Solscan, **re-read on an alternate RPC**. | nightly + pre-release, founder-gated |

The defining rule (arb-builder audit #28): a job that *names itself* "devnet/live" but silently runs `local` and `skip`s every on-chain assertion is **lying in the Actions UI**. Name the job for what it runs. `live` must emit a signature or it **`fail`s — never `skip`s** (the gate's evidence rule, [release-gate.md](release-gate.md)).

```ts
// tests/e2e/_mode.ts
export const MODE = (process.env.E2E_MODE ?? 'local') as 'local' | 'live';
export const CLUSTER = process.env.SOLANA_CLUSTER ?? 'https://api.devnet.solana.com';
export const CLUSTER_ALT = process.env.SOLANA_CLUSTER_ALT ?? 'https://devnet.helius-rpc.com';
export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
export const liveOnly = (fn: () => Promise<void>) =>
  MODE === 'live' ? fn() : test.skip(true, 'local mode: on-chain assertion skipped (honest-pending)');
```

## The core loop — ACT → CAPTURE → AUDIT → DECIDE

From [human-level-qa.md](human-level-qa.md) §6: **never chain actions blind.** Every interaction is followed by a screenshot you *actually read* (DOM assert + vision), and you proceed only if the audit passes. A saved-but-unread screenshot is not verification (§19 anti-patterns). On Solana the audit additionally reads the **signature shape** and, in `live`, the **cluster** — the UI can lie (§19.3 source-of-truth).

```ts
// tests/e2e/_audit.ts — one act→audit step
export async function step(page: Page, name: string, act: () => Promise<void>, assertVisible: () => Promise<void>) {
  await act();                                                   // 1. ACT — one interaction
  await page.screenshot({ path: `evidence/${name}.png`, fullPage: true }); // 2. CAPTURE
  await assertVisible();                                         // 3. AUDIT (DOM); vision-read the PNG out-of-band
  // 4. DECIDE — assertVisible throws on failure ⇒ flow stops here, evidence already captured
}
```

## Wallet setup file + cache

Synpress bakes extension state **once** into `.cache-synpress/`, keyed by a hash of the setup fn, then every test reuses it. Setup files match `*.setup.{ts,js,mjs}` in `test/wallet-setup/`.

```ts
// test/wallet-setup/phantom.setup.ts
import { defineWalletSetup } from '@synthetixio/synpress';
import { Phantom } from '@synthetixio/synpress/playwright';

// Burner seed — DEVNET ONLY, zero mainnet value. Inject via env in CI; never
// hardcode a funded key (see security-secrets.md base58/id.json backstop).
const SEED_PHRASE = process.env.E2E_PHANTOM_SEED!;            // 12/24-word devnet seed
export const PASSWORD = process.env.E2E_PHANTOM_PASSWORD ?? 'SynpressTest1!';

export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
  const phantom = new Phantom(context, walletPage, PASSWORD);
  await phantom.importWallet(SEED_PHRASE);                    // private-key import also supported post-setup
  // Point Phantom at devnet so popups + RPC match the spec's cluster.
  // (Network-switch helper name varies by version — confirm vs pinned.)
});
```

```bash
npx synpress test/wallet-setup --phantom   # hash setup → write .cache-synpress/<hash>
```

`.gitignore` the cache; rebuild it as a CI step (reproducible from the seed).

## Funding a devnet test wallet

```bash
solana airdrop 2 "$E2E_WALLET_PUBKEY" --url devnet || true   # faucet is rate-limited; tolerate
solana balance "$E2E_WALLET_PUBKEY" --url devnet             # assert >0 before live flows
```

Faucet throttled? Fall back to a pre-funded devnet wallet (CI secret) or a direct transfer from a funded persona (§"Multi-context"). A swap/transfer also needs the SPL token account — create + fund it in `globalSetup`, not in the spec. Never fake a balance (§19).

## Fixtures

```ts
// tests/e2e/_fixtures.ts
import { testWithSynpress } from '@synthetixio/synpress';
import { phantomFixtures } from '@synthetixio/synpress/playwright'; // confirm export vs pinned
import phantomSetup, { PASSWORD } from '../../test/wallet-setup/phantom.setup';

// Provides: context, page, phantomPage, extensionId.
export const test = testWithSynpress(phantomFixtures(phantomSetup));
export const expect = test.expect;
export { PASSWORD };
```

## Verify the popup BEFORE approving — no blind-sign

A careful human reads the Phantom popup before clicking Approve. **Assert the popup payload matches the dApp screen** — correct cluster, program/recipient, action, and amount. A mismatch between UI intent and the wallet payload is a **severe defect regardless of what the product does** ([human-level-qa.md](human-level-qa.md) §0.2). Phantom renders the recipient, SOL/SPL amount, fee, and the program/instruction summary in `notification.html`; the SIWS popup renders the SIWS message (domain, statement, nonce). Read them off the popup page before approving:

```ts
// Detect Phantom's approval popup as a separate Page (MV3 notification.html)
async function phantomPopup(context: BrowserContext, extensionId: string) {
  return await expect.poll(
    () => context.pages().find(p => p.url().includes(extensionId) && p.url().includes('notification')),
    { timeout: 15_000 },
  ).toBeTruthy().then(() =>
    context.pages().find(p => p.url().includes(extensionId) && p.url().includes('notification'))!);
}

// Assert the popup shows what the dApp promised — THEN approve.
const popup = await phantomPopup(context, extensionId);
await popup.screenshot({ path: 'evidence/phantom-approve-popup.png' });
await expect(popup.getByText(recipientPubkey.slice(0, 8))).toBeVisible(); // recipient matches UI
await expect(popup.getByText(/0\.01\s*SOL/i)).toBeVisible();              // amount matches UI
await expect(popup.getByText(/devnet/i)).toBeVisible();                   // correct cluster
```

## The human-level spec — connect → verify popup → approve → sign → assert finalized

```ts
// tests/e2e/transfer.spec.ts
import { test, expect, PASSWORD } from './_fixtures';
import { Phantom } from '@synthetixio/synpress/playwright';
import { Connection } from '@solana/web3.js';
import { MODE, CLUSTER, CLUSTER_ALT, BASE_URL, liveOnly } from './_mode';
import { step } from './_audit';

test.describe('@transfer human-level SOL transfer', () => {
  test('connect, verify popup, approve, sign, reach finalized', async ({
    context, page, phantomPage, extensionId,
  }) => {
    const phantom = new Phantom(context, phantomPage, PASSWORD, extensionId);
    const errors: string[] = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));        // a flow that spews console errors is a defect (§14)

    // 1. Load, click Connect → choose Phantom — as a user does.
    await step(page, '01-landing', async () => { await page.goto(BASE_URL); },
      async () => { await expect(page.getByRole('button', { name: /connect/i })).toBeVisible(); });
    await step(page, '02-pick-phantom', async () => {
      await page.getByRole('button', { name: /connect/i }).click();
      await page.getByRole('button', { name: /phantom/i }).click();
    }, async () => { /* Phantom connect popup opens next */ });

    // 2. Phantom popup: unlock + read it + Approve the connection.
    await phantom.connectToDapp();                            // unlock (cached pw) + approve connect
    await step(page, '03-connected', async () => {},
      async () => { await expect(page.getByTestId('wallet-pubkey')).toBeVisible(); });

    // 3. Trigger a transfer → VERIFY the approval popup → confirm.
    await step(page, '04-fill', async () => {
      await page.getByTestId('recipient').fill(process.env.E2E_RECIPIENT!);
      await page.getByTestId('amount').fill('0.01');
      await page.getByRole('button', { name: /send/i }).click();
    }, async () => {});
    // --- verify-before-sign block (above) goes here ---
    await phantom.confirmTransaction();                       // confirm — verify name vs pinned

    // 4. SIWS / off-chain Ed25519 signature → read SIWS popup → approve.
    //    (Ed25519 vs EVM EIP-712: see integration-indexer.md.)
    await step(page, '05-siws', async () => {
      await page.getByRole('button', { name: /sign in with solana/i }).click();
    }, async () => {});
    await phantom.confirmSignature();                         // approve off-chain sig — verify name vs pinned

    // 5. Assert as a human verifies — the SIGNATURE, on-chain, not a UI string.
    const sigText = (await page.getByTestId('tx-signature').textContent())?.trim();

    if (MODE === 'local') {
      await expect(page.getByTestId('tx-status')).toHaveText(/pending|submitted|null/i); // honest-pending
      await expect(page.getByTestId('balance')).not.toHaveText('0');                     // no fake-zero
    }

    await liveOnly(async () => {
      expect(sigText).toMatch(/^[1-9A-HJ-NP-Za-km-z]{86,88}$/);    // base58 64-byte sig shape

      // Ground truth: poll to finalized. NO arbitrary sleeps (§10 auto-wait).
      const conn = new Connection(CLUSTER, 'finalized');
      await expect.poll(async () => {
        const { value } = await conn.getSignatureStatuses([sigText!], { searchTransactionHistory: true });
        return value[0]?.confirmationStatus ?? null;
      }, { timeout: 60_000, intervals: [1_000, 2_000, 5_000] }).toBe('finalized');

      const { value } = await conn.getSignatureStatuses([sigText!]);
      expect(value[0]?.err).toBeNull();                            // finalized-but-failed is still a fail

      // Re-verify on an ALTERNATE RPC (one RPC can lie / be stale).
      const alt = new Connection(CLUSTER_ALT, 'finalized');
      const tx = await alt.getTransaction(sigText!, { maxSupportedTransactionVersion: 0 });
      expect(tx?.meta?.err).toBeNull();

      // Human-verifiable receipt: the UI explorer link points at the real sig.
      await expect(page.getByRole('link', { name: /explorer|solscan/i }))
        .toHaveAttribute('href', new RegExp(sigText!));
    });

    expect(errors, `console errors during a passing flow: ${errors.join('; ')}`).toEqual([]);
  });
});
```

## Wallet FAILURE paths — not just approve

Happy path is half the job ([human-level-qa.md](human-level-qa.md) §11, §13). Each must surface a humanized error and leave the app in a sane state — no white screen, no stuck spinner, no UI/source-of-truth divergence.

```ts
test('@reject user rejects the tx → clean cancel, retry works', async ({ context, page, phantomPage, extensionId }) => {
  const phantom = new Phantom(context, phantomPage, PASSWORD, extensionId);
  /* connect + fill + send … */
  const popup = await phantomPopup(context, extensionId);
  await popup.getByRole('button', { name: /reject|cancel/i }).click();   // or phantom.rejectTransaction() — confirm vs pinned
  await expect(page.getByText(/cancell?ed|rejected/i)).toBeVisible();
  await expect(page.getByTestId('submit')).toBeEnabled();                // no stuck spinner; retry available
});
```

- **User rejects** connect/sign → clean cancel, no stuck spinner, retry works.
- **Wrong cluster** (Phantom on mainnet, dApp on devnet) → app prompts switch and recovers; the verify-before-sign block catches a cluster mismatch.
- **Insufficient SOL / rent-exempt minimum** → humanized error ("not enough SOL for fees + rent"), no broken state. Drain the burner or use a fresh empty wallet to trigger.
- **Wallet locked / disconnected mid-flow** → close the popup or re-lock Phantom between steps; app must handle re-auth gracefully, not hang.

## Multi-context, multi-user — follow one value across surfaces

Multi-party means **multi-context**, never one account switching ([human-level-qa.md](human-level-qa.md) §5, §12). One `BrowserContext` per persona = isolated IndexedDB/localStorage. Drive them in turn, passing the **real signature** between them, and confirm one datum agrees on **every surface**: sender UI ↔ recipient UI ↔ Solscan ↔ RPC read.

```ts
// Alice (sender) and Bob (recipient) — separate contexts, separate Phantom caches.
const alicePopup = await phantomPopup(aliceCtx, aliceExtId);   // Alice approves
const sig = (await alice.getByTestId('tx-signature').textContent())!.trim();
await alice.screenshot({ path: 'evidence/alice-sent.png' });   // act → audit

// Follow the SAME value onto Bob's screen (sync/freshness, §8) — no manual reload.
await expect.poll(() => bob.getByTestId('incoming').textContent(), { timeout: 30_000 })
  .toContain('0.01');
await bob.screenshot({ path: 'evidence/bob-received.png' });

// …and onto the source of truth.
const conn = new Connection(CLUSTER, 'finalized');
expect((await conn.getSignatureStatuses([sig])).value[0]?.confirmationStatus).toBe('finalized');
```

Keep `workers: 1` / sequential ordering so blockhash/nonce/balance stay deterministic even with multiple contexts open.

## Raw-CDP fallback — driving the Phantom MV3 popup directly

Synpress v4.1+ **wraps** the steps below for Phantom (primary path: use `new Phantom(...)` + its methods). Keep this recipe for when a Synpress click is dropped on a popup (MV3 React tree repaints between hover and press, so Playwright `click()` silently no-ops — the same failure mode the real-extension recipe documents for MetaMask/Rabby), or when you need a wallet Synpress doesn't yet cover. It's the mechanical truth underneath the wrapper.

```ts
// 1. Launch headed with the unpacked Phantom extension (MV3 needs a real display).
const ctx = await chromium.launchPersistentContext(profileDir, {
  headless: false, viewport: { width: 1280, height: 800 },
  recordVideo: { dir: 'evidence/video' },
  args: [ `--disable-extensions-except=${PHANTOM_EXT}`, `--load-extension=${PHANTOM_EXT}`,
          '--disable-blink-features=AutomationControlled', '--no-sandbox' ],
});

// 2. Extension id from the MV3 service worker (poll ~30s for it to register).
const sw = await expect.poll(
  () => ctx.serviceWorkers().find(w => w.url().startsWith('chrome-extension://')),
  { timeout: 30_000 }).toBeTruthy()
  .then(() => ctx.serviceWorkers().find(w => w.url().startsWith('chrome-extension://'))!);
const extId = sw.url().split('/')[2];

// 3. Detect the popup as a separate Page (notification.html under the ext id).
const popup = ctx.pages().find(p => p.url().includes(extId) && p.url().includes('notification'))!;

// 4. Click with raw CDP mouse events — Playwright click() drops on the repaint.
async function cdpClick(p: Page, x: number, y: number) {
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed',  x, y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

// 5. Walk the CTA state machine until the popup closes — Phantom reuses one
//    button across stages. For Connect popups, the dApp must already be on the
//    right cluster. Screenshot each advance; 60–90s of no progress = failure.
for (const label of ['Unlock', 'Connect', 'Approve', 'Confirm', 'Sign']) {
  const btn = popup.getByRole('button', { name: new RegExp(label, 'i') });
  if (await btn.isVisible().catch(() => false)) {
    const box = await btn.boundingBox();
    if (box) await cdpClick(popup, box.x + box.width / 2, box.y + box.height / 2);
    await popup.screenshot({ path: `evidence/popup-${label}.png` });
  }
}
```

## Flake control — wait for confirmation, never sleep

- **No `page.waitForTimeout`.** Poll `getSignatureStatuses` / `expect.poll` with backoff. Done = cluster says `finalized`, not "N seconds passed."
- `confirmed` for fast feedback; `finalized` for the gate — devnet forks roll back `confirmed`.
- Mirror arb-builder config: `retries: CI ? 2 : 0`, `trace: 'retain-on-failure'`, `video: 'retain-on-failure'`, `workers: CI ? 1 : undefined` (popups don't parallelize cleanly), longer timeout in `live` (`90_000`) than `local` (`30_000`).
- Handle Phantom's "scam site" / blocklist interstitial deterministically on dev URLs; don't blind-click past it.

## Multi-viewport

Run desktop + mobile, same as `apps/verify/playwright.config.ts` (`@mobile` grep tags split `chromium-desktop` from `mobile-safari`). Phantom's extension is desktop-Chromium; for mobile, assert the responsive dApp UI + the **Mobile Wallet Adapter / deep-link** connect path. A real Phantom-mobile signature needs MWA against a device/emulator — capture that as a separate live job; **don't fake it** (§19).

```ts
projects: [
  { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] }, grepInvert: /@mobile/ },
  { name: 'mobile-safari',    use: { ...devices['iPhone 14'] },      grep: /@mobile/ },
],
timeout: MODE === 'live' ? 90_000 : 30_000,
use: { baseURL: BASE_URL, trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'retain-on-failure' },
```

## Evidence rule — what makes an e2e "pass"

A pass requires **all three**, or it didn't happen (§16, §19):

1. A **real finalized signature** (`err === null`) — re-read on an **alternate RPC**.
2. An **audited** screenshot per transition (both viewports) — read, not just saved — plus the verify-before-sign popup shot.
3. The **on-chain read** written to evidence and the explorer link asserted against the real sig.

```ts
test.afterEach(async ({ page }, t) => {
  await page.screenshot({ path: `evidence/${t.project.name}-${t.title}.png`, fullPage: true });
});
page.on('console', m => fs.appendFileSync('evidence/console.log', `${m.type()}: ${m.text()}\n`));
```

In `live`, write `evidence/onchain.json` (sig + `confirmationStatus` + `err` + alt-RPC result + explorer URL). That JSON + screenshots back the e2e manifest entry for [release-gate.md](release-gate.md):

```json
{ "name": "e2e", "status": "pass", "required": true,
  "detail": "Synpress/Phantom: 6 flows + 4 failure-paths green; live sig 5h2k…finalized, err=null, alt-RPC confirmed" }
```

This ties directly into the **launch-ready gate** ([human-level-qa.md](human-level-qa.md) §17.1): wallet flows count only when connect + approve **and** reject/wrong-cluster/locked are handled cleanly, the popup was verified before signing, source of truth matches the UI, and the coverage audit has zero gaps. A connect-only or screenshot-only run is **not** a pass.

## CI wiring

Pattern from `arb builder/.github/workflows/e2e.yml` (`permissions: {}` top-level, SHA-pinned actions, artifact upload on failure, Discord alert):

```yaml
name: E2E (Phantom real-wallet — local pending-UI)   # name it for what it RUNS (audit #28)
on: { pull_request: { paths: ['apps/web/**', 'tests/e2e/**'] }, schedule: [{ cron: '0 3 * * *' }], workflow_dispatch: {} }
permissions: {}
jobs:
  e2e:
    name: Phantom E2E (local pending-UI)
    runs-on: ubuntu-latest
    timeout-minutes: 20
    permissions: { contents: read }
    steps:
      - uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7
      - uses: actions/setup-node@1e60f620b9541d16bece96c5465dc8ee9832be0b # v4.0.3
        with: { node-version: 20 }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: npx synpress test/wallet-setup --phantom          # build .cache-synpress
        env: { E2E_PHANTOM_SEED: ${{ secrets.E2E_PHANTOM_SEED }}, E2E_PHANTOM_PASSWORD: ${{ secrets.E2E_PHANTOM_PASSWORD }} }
      - run: xvfb-run -a pnpm exec playwright test --project=chromium-desktop  # MV3 extension needs a display
      - if: failure()
        uses: actions/upload-artifact@0b2256b8c012f0828dc542b3febcab082c67f72b # v4.3.4
        with: { name: e2e-evidence, path: evidence/, retention-days: 30 }
```

The `live` (devnet) job is a separate, founder-gated workflow setting `E2E_MODE=live` + `SOLANA_CLUSTER`/`SOLANA_CLUSTER_ALT` + a funded `E2E_PHANTOM_SEED`. It **must emit a finalized signature** as evidence — a `skip` there is a gate failure, not a pass.

## Runnable validator

[../examples/phantom-e2e](../examples/phantom-e2e) is the runnable evidence-validator: it ingests `evidence/onchain.json`, re-reads the cluster (and the alternate RPC), and confirms the signature is real and `finalized` (`err === null`) before the e2e layer may report `pass`. That re-read turns a screenshot into evidence.

## Cross-links
- [human-level-qa.md](human-level-qa.md) — the methodology: act→audit loop, adversarial coverage, source-of-truth, launch-ready gate. This file is the Phantom mechanics for that methodology.
- [release-gate.md](release-gate.md) — e2e feeds the gate; `live` mode requires a real signature as evidence (no sig ⇒ `fail`, not `skip`).
- [integration-indexer.md](integration-indexer.md) — Ed25519 message signing (vs EVM EIP-712) and the indexer the explorer link reads from.
- [../solana-testing](../solana-testing/SKILL.md) — program-level correctness; not re-tested here.
- [../examples/phantom-e2e](../examples/phantom-e2e) — runnable evidence validator.

Sources: [Synpress v4.1.0 Phantom announcement](https://x.com/Synpress_/status/1919085348048552226) · [synpress.io/integrations](https://synpress.io/integrations) · [docs.synpress.io — Playwright](https://docs.synpress.io/docs/guides/playwright) · [docs.synpress.io — Wallet Cache](https://docs.synpress.io/docs/guides/wallet-cache) · [synpress#1246 — Phantom docs gap](https://github.com/synpress-io/synpress/issues/1246)

_Last verified: June 2026_
