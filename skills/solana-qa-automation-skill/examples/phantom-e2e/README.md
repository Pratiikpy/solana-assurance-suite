# phantom-e2e — human-level e2e against a real Phantom wallet (scaffold)

A starting Synpress v4.1+ + Playwright spec that drives a **real Phantom extension** through
the full human flow: connect → unlock → **verify the approval popup before signing** → approve
→ send → assert a **finalized** signature (re-read on an independent RPC), plus the reject
failure path. Dual-mode: `E2E_MODE=local` (honest-pending) vs `live` (devnet finalized-sig).

> **This is a reference scaffold, not the offline-verified proof.** It requires a headed
> browser + the Phantom extension + a running dApp + a funded devnet wallet, so it runs in
> CI / locally — not in this repo's offline test run. The skill's *offline-verified* artifact
> is the release gate at [`../release-gate`](../release-gate) (`node --test`, 6/6). This folder
> is the concrete Phantom e2e starting point that `/scaffold-e2e` generates.

## Run

```bash
pnpm add -D @playwright/test @synthetixio/synpress @solana/web3.js   # confirm Synpress pkg/path for v4.1+
npx synpress                          # build the cached Phantom profile from wallet-setup/
E2E_PHANTOM_SEED="<devnet test seed>" \
E2E_MODE=live E2E_BASE_URL=http://localhost:3000 \
  npx playwright test
```

## Files

- `wallet-setup/phantom.setup.ts` — `defineWalletSetup` importing a TEST-ONLY seed into Phantom (cached).
- `tests/connect-send.spec.ts` — the human-level flow + a reject failure path; asserts a real
  base58 signature reaches `finalized` with `err == null`, re-verified on an alternate RPC.
- `playwright.config.ts` — headed, video on, generous timeouts, desktop + mobile projects.

## Honesty note

Synpress added Phantom/Solana support in **v4.1.0**; the wallet-cache + `importWallet` API is
documented, but some per-method Phantom transaction-approval names are still an open docs gap
([synpress#1246](https://github.com/Synthetixio/synpress/issues/1246)). Calls marked `/* confirm */`
should be checked against your pinned version; where a wrapped method isn't exposed yet, use the
raw-CDP MV3 popup recipe in [`../../skill/e2e-realwallet.md`](../../skill/e2e-realwallet.md) — it
drives the Phantom `notification` popup directly and is version-independent.

_Last verified (structure/flow): June 2026. Live run requires browser + Phantom + devnet funds._
