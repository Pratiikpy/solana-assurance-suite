# Testing Cross-Chain Bridge Integrations

Bridges are the hardest thing to test on Solana: the happy path spans two chains and an off-chain Guardian/attestation network, the failure paths (replayed VAAs, malformed payloads, reorgs) are exactly where funds get stolen, and you cannot exercise any of it by signing one transaction. This file is the bridge×testing glue. It assumes the harness conventions from the companion testing skill — read those first: [LiteSVM integration](../solana-testing/litesvm-integration.md) for the in-process VM, [bug-class playbook](../solana-testing/bug-class-playbook.md) for the attack catalogue, [CI harness](../solana-testing/ci-harness.md) for wiring it into CI.

Test in four tiers, cheapest first. Don't skip a tier because the one above passed — they catch different bugs.

## Tier 1 — Unit: mock the attestation, never touch a network

The consume side of your integration takes a VAA (Wormhole) or attestation+message (CCTP) and acts on it. That is a **pure function of bytes** — test it in LiteSVM with a synthetic, fully-controlled attestation. This is where you catch the high-severity bugs.

Wormhole's Core Bridge verifies a VAA against an on-chain Guardian set. In LiteSVM you **install your own single-key Guardian set** and sign VAAs with a key you hold, so any payload you can imagine becomes a valid, redeemable VAA:

```ts
import { LiteSVM } from "litesvm";
import { keccak_256 } from "@noble/hashes/sha3";
import { secp256k1 } from "@noble/curves/secp256k1";

// A VAA body the Core Bridge will accept once it's signed by the guardian set
// we seeded into the bridge's GuardianSet account (see litesvm-integration.md
// for the setAccount cheat used to plant that state).
function signVaa(body: Uint8Array, guardianPriv: Uint8Array): Uint8Array {
  const hash = keccak_256(keccak_256(body));          // double-keccak per spec
  const sig = secp256k1.sign(hash, guardianPriv);
  const rs = sig.toCompactRawBytes();                 // 64 bytes r||s
  const recId = sig.recovery!;                        // 0/1
  // header: version(1) | guardianSetIndex(4) | sigCount(1) | [index(1)|sig(65)]...
  const sigSection = new Uint8Array([0, ...rs, recId]);
  return concat([new Uint8Array([1]), u32(0), new Uint8Array([1]), sigSection, body]);
}
```

Now the malicious-input assertions — the whole reason this tier exists:

```ts
test("replayed VAA is rejected", async () => {
  const svm = new LiteSVM();
  // ...load Core Bridge + your consumer program, seed guardian set...
  const vaa = signVaa(transferBody, guardianPriv);

  expect(redeem(svm, vaa).ok).toBe(true);          // first redemption succeeds
  const second = redeem(svm, vaa);                 // same VAA again
  expect(second.ok).toBe(false);                   // Core Bridge "already executed"
  // CRITICAL: assert your program also independently tracks consumed VAAs.
  // Never rely solely on the bridge's claim PDA — see bug-class-playbook.md.
  expect(second.err).toMatch(/already (executed|claimed|processed)/i);
});

test("forged VAA (wrong guardian key) is rejected", () => {
  const forged = signVaa(transferBody, randomBytes(32));
  expect(redeem(svm, forged).ok).toBe(false);      // signature recovery != guardian
});

test("payload-shape confusions are rejected", () => {
  for (const evil of [truncate(transferBody), wrongEmitter(transferBody),
                      wrongTargetChain(transferBody), zeroAmount(transferBody)])
    expect(redeem(svm, signVaa(evil, guardianPriv)).ok).toBe(false);
});
```

For **CCTP** the analogue is the Iris attestation: the on-chain `MessageTransmitterV2.receive_message` checks an ECDSA attestation against Circle's attester set. Same technique — plant a single-attester config you control, sign your own `(message, attestation)` pair, then assert your minter handles a replayed nonce and a foreign-domain source. Wrong-source-domain and replayed-nonce are the two must-have negative tests. (Domain IDs and program IDs are pinned in [resources.md](resources.md).)

```ts
// CCTP message body fields that MUST be asserted, not assumed:
//   sourceDomain  — reject anything that isn't your expected origin domain
//   nonce         — reject on replay (per-(domain,nonce) used flag)
//   mintRecipient — reject if it isn't the ATA you control
//   amount        — reject 0 / overflow
test("CCTP foreign-domain message is rejected", () => {
  const evil = setSourceDomain(message, 999);          // not an enrolled domain
  expect(receive(svm, evil, attest(evil)).ok).toBe(false);
});
test("CCTP nonce replay is rejected", () => {
  expect(receive(svm, message, attest(message)).ok).toBe(true);
  expect(receive(svm, message, attest(message)).ok).toBe(false); // used nonce
});
```

These mirror the Wormhole assertions: the bug class is identical (trusting attested bytes without independently binding domain, nonce, recipient, and amount), only the wire format differs.

## Tier 2 — Solana-side against real programs: Surfpool mainnet-fork

Unit tests use *your* guardian set, so they prove your logic but not that you call the **real** Core Bridge / Token Bridge / CCTP programs with the right accounts. Surfpool (drop-in `solana-test-validator` replacement) forks mainnet and fetches accounts just-in-time, so the genuine bridge programs and their live config accounts are present without you deploying anything:

```bash
surfpool start                 # forks mainnet; real program state pulled lazily
# In tests, point @solana/kit at the surfnet RPC (default http://127.0.0.1:8899).
```

Use surfnet cheat RPCs to set up state the fork doesn't give you for free:

- `surfnet_setAccount` — fund a test wallet's USDC ATA, or overwrite the Guardian-set account with a key you control so you can *also* mint valid VAAs against the **real** bridge program. This is the bridge between Tier 1's fakery and a real on-chain verifier.
- time-travel / slot control — push past finality requirements without waiting.

This tier catches account-ordering bugs, wrong PDAs, CU blowups, and config drift that unit tests with a stub program cannot. It does **not** prove the EVM side or the off-chain Guardian network.

## Tier 3 — Testnet/devnet end-to-end (real attestations, fake money)

The only tier that exercises the actual Guardian network and a real destination chain. Wormhole supports `Testnet`; initialize the SDK with `wormhole("Testnet", [...])` (see [integration-patterns.md](integration-patterns.md)). Real Guardians observe and sign, so `fetchAttestation` returns a genuine VAA — your code path is identical to mainnet.

- **Solana devnet SOL/USDC**: official faucet at `faucet.solana.com`. Note (2026): the faucet web UI now blocks AI agents and directs automated tooling to `solana airdrop`, the proof-of-work faucet, or a local validator. In CI, prefer `solana airdrop` against devnet or pre-fund a known keypair from secrets.
- **EVM testnet gas**: Sepolia/Base-Sepolia faucets; CCTP testnet uses the Iris **sandbox** API (`iris-api-sandbox.circle.com`).
- **Attestations come from**: the testnet Guardian set for Wormhole; Circle's sandbox attester for CCTP. Latency is realistic (seconds to minutes) — your retry/backoff logic gets a real workout here.

Keep these as a small, quarantinable suite — they are slow and externally flaky. Quarantine conventions: [ci-harness](../solana-testing/ci-harness.md).

## Tier 4 — Smoke: is it alive in prod?

A single read-only assertion per environment: the bridge program IDs exist and are executable, the Guardian/attester set account is non-empty, and a `quoteTransfer` for a tiny amount returns > 0. Run on deploy. This catches config regressions (a swapped testnet vs mainnet program ID — the single most common bridge integration bug) without moving funds.

## What each tier proves

| Tier | Real bridge program | Real attestation | Real dest chain | Speed | Catches |
|------|--------------------|--------------------|-----------------|-------|---------|
| 1 Unit (LiteSVM) | no (stub/seeded) | no (self-signed) | no | ms | replay, forgery, payload confusion |
| 2 Surfpool fork | **yes** | seeded/self-signed | no | s | account/PDA/CU bugs, config drift |
| 3 Testnet E2E | yes | **yes** | **yes** | min | integration, timing, retries |
| 4 Smoke | yes (read-only) | n/a | n/a | ms | env/config regressions |

The replay and forgery assertions in Tier 1 are the ones that prevent a drained bridge. Write those before the happy path. Full attack catalogue with Solana-specific variants: [bug-class playbook](../solana-testing/bug-class-playbook.md).

_Last verified: June 2026_
