# Bridge Integration Patterns (Wormhole TS SDK)

The unified `@wormhole-foundation/sdk` (meta-package, **v6.1.0**) is the right default for generic token bridging. It re-exports `@wormhole-foundation/sdk-connect` (orchestration) and lazily loads platform packages — `@wormhole-foundation/sdk-solana` for the Solana side, plus protocol packages (`-tokenbridge`, `-cctp`, `-ntt`). Install only what you load.

```bash
npm i @wormhole-foundation/sdk @solana/kit
# platform/protocol code is lazy-loaded by the meta-package; no separate install needed for tokenbridge
```

**Reality check (verify before you ship):** as of v6.1.0 the Solana platform package still emits **legacy `@solana/web3.js@^1.x` `Transaction`/`VersionedTransaction` objects internally** — it is *not* `@solana/kit`-native yet. So you sign with a web3.js-style signer, or bridge kit↔web3.js at the boundary (below). Don't assume kit `TransactionMessage` types flow through the SDK. For protocol-specific flows see [cctp.md](cctp.md) (native USDC burn/mint), [wormhole-ntt.md](wormhole-ntt.md) (your own token, no wrapper), [debridge.md](debridge.md) (DLN intent-based swaps).

## The four-step lifecycle

Every Wormhole token transfer is async and multi-minute: **initiate (source tx) → observe (Guardians sign a VAA) → fetch attestation → redeem (destination tx)**. The `TokenTransfer` object encapsulates this state machine; persist its `txid`s so a crashed process can resume instead of double-spending.

## A complete Solana → EVM transfer module

```ts
import {
  wormhole, TokenTransfer, Wormhole, amount, type Chain, type TokenId,
} from "@wormhole-foundation/sdk";
import solana from "@wormhole-foundation/sdk/solana";
import evm from "@wormhole-foundation/sdk/evm";
import {
  createKeyPairSignerFromBytes, getBase58Encoder, type KeyPairSigner,
} from "@solana/kit";

export interface TransferParams {
  amountHuman: string;            // e.g. "1.5"
  token: TokenId | "native";      // SPL mint as a TokenId, or native SOL
  destChain: Chain;               // "Ethereum", "Base", ...
  destAddress: string;            // 0x… recipient
}

/**
 * Bridge a token Solana -> EVM and drive it to redemption.
 * Idempotent across `TokenTransfer.from(...)` recovery: pass a persisted
 * `originTxid` to resume instead of re-initiating.
 */
export async function bridgeSolanaToEvm(
  p: TransferParams,
  solanaSecret: Uint8Array,        // 64-byte keypair
  evmSigner: unknown,              // a Wormhole `Signer` for the dest chain
  originTxid?: string,
) {
  const wh = await wormhole("Mainnet", [solana, evm]);
  const src = wh.getChain("Solana");
  const dst = wh.getChain(p.destChain);

  // --- Solana-side signer. The SDK wants a web3.js-style signer; we hold a
  // @solana/kit KeyPairSigner and adapt it via the platform's signer factory.
  const kit: KeyPairSigner = await createKeyPairSignerFromBytes(solanaSecret);
  const sender = Wormhole.chainAddress("Solana", kit.address);
  const recipient = Wormhole.chainAddress(p.destChain, p.destAddress);
  const signer = await getSolanaSigner(src, solanaSecret); // platform helper, see below

  const token =
    p.token === "native" ? Wormhole.tokenId("Solana", "native") : p.token;
  const decimals = Number(await src.getDecimals(token.address));
  const xfer = originTxid
    ? await TokenTransfer.from(wh, {
        chain: "Solana", txid: originTxid,
      }, 60_000)
    : await wh.tokenTransfer(
        token,
        amount.units(amount.parse(p.amountHuman, decimals)),
        sender, recipient,
        false,          // manual delivery (no automatic relayer)
      );

  // Quote first — surfaces dust limits & insufficient-amount errors before signing.
  const quote = await TokenTransfer.quoteTransfer(
    wh, src.chain, dst.chain, xfer.transfer,
  );
  if (quote.destinationToken.amount <= 0n)
    throw new Error("Amount below bridge minimum (would deliver 0)");

  // 1) Initiate on Solana (skip if resuming)
  if (!originTxid) {
    const srcTxids = await xfer.initiateTransfer(signer);
    console.log("solana txids", srcTxids);
  }

  // 2) Fetch the VAA. Guardian quorum takes ~15s on most chains but Solana
  //    finality + Guardian observation can run minutes — retry with backoff.
  await withRetry(() => xfer.fetchAttestation(60_000), {
    attempts: 8, baseMs: 5_000, label: "fetchAttestation",
  });

  // 3) Redeem on the destination EVM chain (idempotent: re-redeeming a
  //    consumed VAA reverts on-chain, so guard with isTransferCompleted).
  const completed = await TokenTransfer.isTransferCompleted(wh, xfer.transfer);
  if (!completed) {
    const dstTxids = await withRetry(
      () => xfer.completeTransfer(evmSigner as never),
      { attempts: 5, baseMs: 8_000, label: "completeTransfer" },
    );
    console.log("dest txids", dstTxids);
  }
  return xfer; // persist xfer.txids for audit/recovery
}

// Adapt @solana/kit secret bytes into the Solana platform's Signer.
async function getSolanaSigner(src: Awaited<ReturnType<typeof wormhole>>["getChain"] extends
  (...a: never[]) => infer R ? R : never, secret: Uint8Array) {
  const { getSolanaSignAndSendSigner } = await import(
    "@wormhole-foundation/sdk-solana"
  );
  const rpc = await (src as any).getRpc();
  // The factory accepts a base58 private key or a web3.js Keypair.
  return getSolanaSignAndSendSigner(rpc, base58(secret));
}
const base58 = (b: Uint8Array) => getBase58Encoder().encode; // see note below

async function withRetry<T>(
  fn: () => Promise<T>,
  o: { attempts: number; baseMs: number; label: string },
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < o.attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      // Not-yet-available is expected mid-bridge; only sleep & retry on those.
      const transient = /not.*(found|available|ready)|timeout|429|503/i.test(
        String((e as Error)?.message),
      );
      if (!transient) throw e;
      const wait = o.baseMs * 2 ** i + Math.random() * 1_000;
      console.warn(`${o.label} retry ${i + 1}/${o.attempts} in ${wait | 0}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error(`${o.label} exhausted retries: ${String(last)}`);
}
```

### kit ↔ web3.js boundary

The SDK's Solana signer ultimately calls `sendRawTransaction` on a web3.js `Connection`. If your app is otherwise pure `@solana/kit` (v6.10.0), keep kit for your own instructions and only hand the **64-byte secret / base58 key** to `getSolanaSignAndSendSigner` — do not try to pass a kit `TransactionSendingSigner` directly. When the SDK becomes kit-native, swap the factory and delete the adapter. (`getBase58Encoder().encode(bytes)` returns the base58 string for the signer factory; shown abbreviated above.)

### Failure modes worth handling explicitly

- **Dust / minimum-amount**: caught by the `quoteTransfer` guard. Wrapped-token transfers truncate to 8 decimals; sub-dust deliveries arrive as 0.
- **VAA never appears**: chain reorg before finality, or Guardian downtime. `fetchAttestation` throws; the backoff above retries. Cap total wait and surface a "pending — resume later" state rather than blocking forever.
- **Redeem replay**: `completeTransfer` on an already-consumed VAA reverts. Always gate on `isTransferCompleted`.
- **Process crash mid-flight**: persist `xfer.txids[0]` (the Solana origin txid) and rehydrate with `TokenTransfer.from(wh, { chain, txid })`. This is the idempotency key — never re-initiate blindly.

Testing all of this without burning mainnet funds is its own discipline — see [testing-bridges.md](testing-bridges.md).

_Last verified: June 2026_
