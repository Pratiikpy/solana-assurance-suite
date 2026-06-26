# TypeScript testing kit

Fast program/client testing in TypeScript with the **`litesvm`** npm package (**1.2.0**) and **`@solana/kit`** (**6.10.0**, the package formerly known as web3.js v2).

## Library choices (get these right)

- **Use `@solana/kit`**, not legacy `@solana/web3.js` 1.x. web3.js `1.98.4` is **maintenance-only** — no new features. Kit is the modular, tree-shakeable successor: `address`/`Address` (opaque base58 strings, not a `PublicKey` class), explicit codecs, functional transaction builders.
- **`litesvm` (npm 1.2.0)** is an in-process SVM — no validator boot, no RPC server, deterministic clock. Drive your built `.so` directly.
- **`solana-bankrun` (0.4.0) is DEPRECATED** — its own README says to migrate to litesvm. Do not start new suites on bankrun.

> Gotcha: upstream examples and AI output frequently mix kit's `address`/`Address` with the classic `publicKey`/`PublicKey`. They are not interchangeable. litesvm's TS API takes a `PublicKey`-shaped object in 1.x; if you live in kit-land you may hold `Address` strings and must convert at the boundary. **Verify against the version actually installed** (`npm ls litesvm @solana/kit`) rather than trusting a blog.

## Install

```bash
npm i -D litesvm @solana/kit
npm i -D vitest            # or use the built-in node:test runner
```

## Core API

```ts
import { LiteSVM } from "litesvm";

const svm = new LiteSVM();

svm.airdrop(payer.publicKey, 1_000_000_000n);   // lamports as bigint
const result = svm.sendTransaction(tx);          // -> TransactionMetadata | FailedTransactionMetadata
const bal    = svm.getBalance(recipient);        // bigint | null
const acct   = svm.getAccount(somePubkey);       // AccountInfo-like | null
```

- `airdrop(pubkey, lamports)` — lamports are **bigint** (`1_000_000_000n` = 1 SOL).
- `sendTransaction(tx)` — returns metadata on success or a `FailedTransactionMetadata` on failure. It does **not throw** on program error; you must branch on the return type and read `.err()`/logs from the failure object.
- `getBalance(pubkey)` / `getAccount(pubkey)` — synchronous reads against the in-process bank.
- Load a program: `svm.addProgramFromFile(programId, "target/deploy/prog.so")` (or `svm.addProgram(programId, bytes)`).

## Clock / time control

No real slots — advance time explicitly instead of sleeping. Critical for testing vesting, cooldowns, auctions, epoch logic:

```ts
const clock = svm.getClock();
clock.unixTimestamp = clock.unixTimestamp + 86_400n;   // jump 1 day
svm.setClock(clock);
svm.warpToSlot(1_000_000n);                            // jump slot
```

## Runnable test (node:test)

Drives a program, asserts success, then decodes state. Adjust the failure check to your runner.

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { LiteSVM, FailedTransactionMetadata } from "litesvm";
import { Keypair, PublicKey, Transaction, SystemProgram } from "@solana/web3.js"; // litesvm 1.x types

test("transfer moves lamports", () => {
  const svm = new LiteSVM();
  const payer = new Keypair();
  const dest  = new Keypair();

  svm.airdrop(payer.publicKey, 1_000_000_000n);

  const ix = SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: dest.publicKey,
    lamports: 500_000_000,
  });
  const tx = new Transaction();
  tx.recentBlockhash = svm.latestBlockhash();
  tx.feePayer = payer.publicKey;
  tx.add(ix);
  tx.sign(payer);

  const res = svm.sendTransaction(tx);
  assert.ok(!(res instanceof FailedTransactionMetadata), "tx should succeed");

  assert.equal(svm.getBalance(dest.publicKey), 500_000_000n);
});
```

## Testing an instruction builder + account decoding

Build the instruction with your client code, send it, then decode the resulting account to assert on-chain state — this is what catches serialization bugs that a builder-only unit test misses.

```ts
test("init writes the expected account state", () => {
  const svm = new LiteSVM();
  const programId = PublicKey.unique();
  svm.addProgramFromFile(programId, "target/deploy/counter.so");

  const payer = new Keypair();
  svm.airdrop(payer.publicKey, 1_000_000_000n);

  // 1. your real instruction builder under test
  const { ix, counterPda } = buildInitIx({ programId, authority: payer.publicKey });

  const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: svm.latestBlockhash() }).add(ix);
  tx.sign(payer);

  const res = svm.sendTransaction(tx);
  assert.ok(!(res instanceof FailedTransactionMetadata), res.toString());

  // 2. decode the account litesvm now holds
  const acct = svm.getAccount(counterPda);
  assert.ok(acct, "PDA should exist");
  const decoded = decodeCounter(acct.data);   // your borsh/anchor decoder
  assert.equal(decoded.count, 0n);
  assert.equal(decoded.authority.toBase58(), payer.publicKey.toBase58());
});
```

To assert a **failure path**, send a tx you expect to revert and inspect the failure:

```ts
const res = svm.sendTransaction(badTx);
assert.ok(res instanceof FailedTransactionMetadata);
assert.match(res.toString(), /custom program error: 0x1771/);   // your error code
```

## See also

- [litesvm-integration.md](./litesvm-integration.md) — Rust-side litesvm (`litesvm` crate 0.13.0)
- [anchor-harness.md](./anchor-harness.md) — `anchor test`, litesvm vs Surfpool, `anchor-litesvm` provider
- [../core/frontend-framework-kit.md](../core/frontend-framework-kit.md) — `@solana/kit` in app code
- [../core/kit/overview.md](../core/kit/overview.md) — kit primitives (`Address`, codecs, tx builders)

_Last verified: June 2026_
