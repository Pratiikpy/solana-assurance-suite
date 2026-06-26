# Wormhole Native Token Transfers (NTT)

NTT is the current standard for making **one SPL token canonical across many chains** without wrapped intermediaries. Your token stays *itself* on Solana and on every EVM chain — same symbol, same decimals (modulo trim), same supply accounting — and moves by burn/mint or lock/mint that *you* own and control. Use it when you are the token issuer and want a multichain-native asset.

## NTT vs a wrapped-asset bridge

- **Wrapped (Wormhole Token Bridge / WTT):** lock on source, mint a *bridge-owned wrapped* token on dest (`wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb` on Solana mainnet). Fine for assets you don't control, but you inherit a foreign wrapper and fragmented liquidity.
- **NTT:** *you* deploy and own the managers/mint authority. The token on each chain is canonical, not a wrapper. Choose NTT whenever you control the token. For native USDC specifically, do **not** use NTT — use [cctp.md](cctp.md).

## Two modes

- **Burn-and-mint (distributed supply):** source burns, dest mints. Total supply is spread across chains; the sum is invariant. Best for new tokens or upgrading an existing one to multichain. On Solana the NTT program holds the SPL **mint authority**.
- **Hub-and-spoke (lock-and-mint):** lock on a hub chain (supply preserved there), mint on spokes. Best for grafting an existing fixed-supply token onto new chains. Pick a hub and set it `locking`; spokes are `burning`.

Mode is set **per chain** at deploy and must be coherent across the deployment (one hub locking, the rest burning).

## Manager + Transceiver model

- **NTT Manager** — the core contract/program on each chain. Owns mint/burn, enforces **rate limits**, tracks inbound/outbound queues, holds **access-control roles** (owner, pauser), and quotes/peers other chains. One manager per chain per token.
- **Transceiver** — the pluggable transport that actually ships the message between managers. The default is the **Wormhole transceiver** (guardian-attested). The model is intentionally decoupled so you can require **multiple transceivers** and an *attestation threshold* (e.g. 2-of-N) for defense in depth.
- **Global Accountant** (Wormhole guardians) independently enforces that cumulative minted never exceeds cumulative burned across the whole deployment — a protocol-level backstop against a compromised manager.

Managers on different chains are **peered**: each registers the other's address + token decimals. Transfers between unpeered managers revert.

## Safety as a first-class feature

Treat these as launch-blocking config, not afterthoughts:

- **Rate limits** — per-chain, per-epoch **inbound and outbound** caps. Outflow over the limit is queued; inflow over the limit is queued for delayed release. Set with the appropriate decimals for each chain (the CLI/`ntt pull` handles decimal scaling).
- **Pausing** — the `pauser` role can halt the manager instantly. Hold it on a hot key separate from `owner`; `owner` should be a multisig / governance.
- **Access control** — `owner` (config, peers, transceivers, limits) vs `pauser` (emergency stop only). Transfer the SPL mint authority to the NTT program and the program `owner` to governance after deploy.

## Deploying with the `ntt` CLI

Requires **Bun** (≥1.2.x) on PATH. Install:

```bash
curl -fsSL https://raw.githubusercontent.com/wormhole-foundation/native-token-transfers/main/cli/install.sh | bash
ntt --version
```

Scaffold, init, add Solana (burning) + an EVM chain, push:

```bash
ntt new my-token-ntt && cd my-token-ntt
ntt init Mainnet                      # writes deployment.json { network, chains: {} }

# Solana: --token is the SPL mint. NTT program takes mint authority.
ntt add-chain Solana   --latest --mode burning --token <SPL_MINT_ADDRESS>
ntt add-chain Ethereum --latest --mode burning --token 0xYourErc20
# noRateLimiting variant exists for EVM if you deliberately opt out (don't, usually):
#   ntt add-chain Arbitrum --latest --mode burning --token 0x.. --manager-variant noRateLimiting

ntt push                              # deploy + register peers on-chain
ntt status                            # diff local deployment.json vs on-chain (must be clean)
ntt pull                              # sync on-chain config back into deployment.json
```

Rate limits, peers, and roles live in `deployment.json` under each chain (`mode`, `token`, `manager`, `transceivers`, `limits.inbound`/`outbound`); edit and re-`push`, or use `ntt config set-chain <chain> <key> <value>`. Always finish with `ntt status` returning consistent. Append `--help` to any subcommand for the authoritative flag list (the limit/pause subcommand names move between CLI versions — verify against your installed `ntt --version`).

## TS SDK transfer (Solana ↔ EVM)

Verified June 2026 — core SDK **`@wormhole-foundation/sdk@6.1.0`**, NTT packages **`@wormhole-foundation/sdk-{solana,evm}-ntt@7.2.0`**, route **`@wormhole-foundation/sdk-route-ntt@7.2.0`**. Importing the platform-NTT packages is what *registers* the `Ntt` protocol on the `Wormhole` instance — the bare import has side effects, keep it.

```ts
import { Wormhole, amount, signSendWait, type ChainAddress } from "@wormhole-foundation/sdk";
import evm from "@wormhole-foundation/sdk/platforms/evm";
import solana from "@wormhole-foundation/sdk/platforms/solana";
import "@wormhole-foundation/sdk-evm-ntt";      // side-effect: register Ntt on EVM
import "@wormhole-foundation/sdk-solana-ntt";   // side-effect: register Ntt on Solana

// Your deployment’s manager + token + transceiver addresses, per chain.
const NTT = {
  Solana:   { token: "<SPL_MINT>",  manager: "<NTT_MANAGER_PDA>", transceiver: { wormhole: "<XCVR>" } },
  Ethereum: { token: "0xToken",     manager: "0xManager",         transceiver: { wormhole: "0xXcvr" } },
} as const;

const wh = new Wormhole("Mainnet", [solana.Platform, evm.Platform]);
const src = wh.getChain("Solana");
const dst = wh.getChain("Ethereum");

const ntt = await src.getProtocol("Ntt", { ntt: NTT.Solana });
const decimals = await ntt.getTokenDecimals?.() ?? 9;
const amt = amount.units(amount.parse("1.5", decimals));

const recipient: ChainAddress = Wormhole.chainAddress("Ethereum", "0xRecipient");
const sender = await getSolanaSigner(src);                 // your wallet → SignAndSendSigner

// transfer() yields unsigned txs; signSendWait signs+sends them on Solana.
const txs = ntt.transfer(sender.address.address, amt, recipient, /* queue */ false);
const srcTxids = await signSendWait(src, txs, sender.signer);

// Redeem on EVM: get the attested transfer, then redeem with an EVM signer.
const [whm] = await src.parseTransaction(srcTxids[srcTxids.length - 1].txid);
const vaa = await wh.getVaa(whm!, "Ntt:WormholeTransfer", 60_000);
const dstNtt = await dst.getProtocol("Ntt", { ntt: NTT.Ethereum });
const evmSigner = await getEvmSigner(dst);
await signSendWait(dst, dstNtt.redeem([vaa!], evmSigner.address.address), evmSigner.signer);
```

For hands-off relaying, use the **Executor route** (`@wormhole-foundation/sdk-route-ntt`, `nttExecutorRoute(cfg)` → `getProtocol("NttWithExecutor")`): you pay a relay quote at send time and redemption happens automatically — no manual `redeem`. Manual redeem (above) is the fallback for stuck transfers.

## Finality & relaying

The Wormhole transceiver waits for **source finality** before guardians attest: Solana ~ a few slots (set `consistency_level` Confirmed=1 vs Finalized=32 in the manager), but **Ethereum finality is ~15 min** — a Solana→Ethereum send is near-instant to attest while Ethereum→Solana is slow. If outbound exceeds a rate limit it is **queued**, adding the epoch delay. Always surface "queued / pending finality / redeemable" states in UX. For end-to-end correctness checks see [testing the integration](../solana-testing/SKILL.md).

## Unverified / verify-before-shipping

- Exact subcommand names for setting limits and pause/unpause (`ntt config ...` vs dedicated verbs) **drift between CLI versions** — confirm with `--help` on your installed binary.
- The Executor (`exec…`) relayer supersedes the older "standard relayer"; route package API (`nttExecutorRoute`) is the demo's current shape but check the package README for your `7.2.0` minor.
- Manager/transceiver addresses above are placeholders — pull yours from `deployment.json`.

Related: [cctp.md](cctp.md) (native USDC) · [messaging.md](messaging.md) (arbitrary cross-chain messages).

_Last verified: June 2026_
