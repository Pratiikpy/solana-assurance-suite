# L2 — Integration + indexer correctness

> The layer between "the program passes its unit tests" and "a human can use the dApp" ([e2e-realwallet.md](e2e-realwallet.md)): does the deployed program actually integrate with the services around it on a real cluster, and does the indexer the frontend reads from tell the **truth** — fresh, complete, and pointed at the right program? Program-internal correctness (Mollusk/LiteSVM/fuzz/coverage) is delegated to [../solana-testing](../solana-testing/SKILL.md); this file owns everything *around* the program: contract↔service integration, Ed25519 message signing, and indexer drift. Reverse-engineered from the arb-builder subgraph job (`ci.yml`) and `subgraph-health.yml`, mapped EVM→Solana.

## Three things this layer pins

1. **Contract↔services integration on a real validator** — the program, the RPC, the keeper/cranks, and the indexer all wired together on localnet/surfpool/devnet, not mocked.
2. **Ed25519 message signing** — Solana's off-chain signature model (vs EVM's EIP-712), end to end through the verifying service.
3. **Indexer correctness** — mapping unit tests, the event-coverage + entity-writer guard scripts, and the live drift guard (slot-lag + program-ID/PDA reconciliation).

The arb-builder `subgraph` job runs five steps in order; each maps onto Solana:

```yaml
# arb builder/.github/workflows/ci.yml — subgraph job (EVM original)
- run: pnpm --filter @atrium/subgraph codegen     # → anchor IDL / account-decoder typegen
- run: pnpm --filter @atrium/subgraph build        # → build the indexer mappings
- run: pnpm --filter @atrium/subgraph test          # → matchstick → mapping unit tests
- run: node scripts/check-event-indexing.mjs        # → every program event has a handler
- run: node scripts/check-entity-writers.mjs        # → every entity has a producer
```

> The job runs on `ubuntu-22.04`, not latest — "graph test's matchstick binary does not support Ubuntu 24 yet." Pin the runner for any binary-dependent indexer toolchain (Geyser plugins, matchstick, etc.).

## 1. Contract↔services integration on localnet / surfpool / devnet

Stand up the program against a **real validator**, run the keeper/crank, then assert via RPC reads — never mocks (real-path rule, [e2e-realwallet.md](e2e-realwallet.md)).

```bash
# Option A — solana-test-validator (deterministic, hermetic, CI-friendly)
solana-test-validator --reset --quiet \
  --bpf-program <PROGRAM_ID> target/deploy/program.so &
VALIDATOR=$!; trap "kill $VALIDATOR" EXIT
solana config set --url localhost
anchor deploy                          # or `solana program deploy`

# Option B — surfpool (mainnet-fork: real accounts/programs at a slot)
surfnet start --rpc-url https://api.mainnet-beta.solana.com   # fork; test against real state
```

A localnet integration test drives the full path — submit → confirm → crank → read-back:

```ts
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
const conn = new Connection('http://127.0.0.1:8899', 'confirmed');

it('open → crank settles → on-chain state reflects it', async () => {
  const sig = await program.methods.openPosition(amount).accounts({ ... }).rpc();
  await conn.confirmTransaction(sig, 'confirmed');             // wait, never sleep

  await runKeeperOnce();                                       // the off-chain crank/keeper service

  // Assert the SOURCE OF TRUTH (the account), not a return value.
  const acct = await program.account.position.fetch(positionPda);
  expect(acct.status).to.equal('settled');
  expect(acct.owner.toBase58()).to.equal(owner.publicKey.toBase58());
});
```

Run this as a CI job mirroring the arb-builder shape (`permissions: {}` top-level, SHA-pinned actions, `contents: read`):

```yaml
integration:
  name: Localnet integration
  runs-on: ubuntu-latest
  timeout-minutes: 20
  permissions: { contents: read }
  steps:
    - uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7
    - uses: actions/setup-node@1e60f620b9541d16bece96c5465dc8ee9832be0b # v4.0.3
      with: { node-version: 20 }
    - run: sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"  # solana CLI + test-validator
    - run: anchor test --skip-lint                            # boots test-validator, runs the suite
```

## 2. Ed25519 message signing vs EVM EIP-712

The signing model differs fundamentally from EVM and must be tested end to end through the verifying service — a passing on-chain program with a broken off-chain verifier still ships a broken dApp.

| | EVM (arb-builder) | Solana |
|---|---|---|
| Off-chain sign | EIP-712 typed-data (`eth_signTypedData_v4`) | Ed25519 over raw bytes; **SIWS** (Sign-In-With-Solana) is the structured-message standard |
| Recovery | `ecrecover` → signer address | no recovery — verify `(pubkey, message, signature)` directly |
| On-chain verify | precompile / `ECDSA.recover` | **Ed25519 program** (`Ed25519SigVerify111…`) instruction, or `nacl`/`ed25519-dalek` off-chain |
| Domain separation | EIP-712 domain struct | SIWS domain/statement/nonce fields in the message |

```ts
import nacl from 'tweetnacl';
import { PublicKey } from '@solana/web3.js';

// Verify the exact SIWS/off-chain signature the dApp produced (the one Phantom
// approved in e2e-realwallet.md §SIWS). Integration test asserts the SERVICE
// accepts a real sig and REJECTS a tampered one.
it('verifier accepts a valid Ed25519 sig and rejects a tampered message', () => {
  const msg = Buffer.from(siwsMessage, 'utf8');
  expect(nacl.sign.detached.verify(msg, signature, pubkey.toBytes())).to.be.true;

  const tampered = Buffer.from(siwsMessage.replace(/nonce: \w+/, 'nonce: forged'), 'utf8');
  expect(nacl.sign.detached.verify(tampered, signature, pubkey.toBytes())).to.be.false; // must reject
});
```

If verification happens **on-chain**, integration-test the Ed25519 program instruction is correctly composed (it's a separate instruction in the same tx, with a precise offsets layout) — a malformed offsets header silently verifies nothing. Adversarial cases: wrong pubkey, replayed nonce, expired SIWS `issued-at`, and an off-by-one message-byte mismatch.

## 3. Indexer correctness

A Solana indexer (Geyser plugin, Helius/Yellowstone gRPC consumer, or a custom RPC poller) decodes account/instruction data into an indexed store the frontend queries. Three failure classes — each gets a gate.

### 3a. Mapping unit tests (matchstick → decode/handler tests)

The arb-builder runs `matchstick` (`graph test`) over its subgraph mappings. The Solana equivalent: **unit-test the decode handlers** — feed a known raw account/log/instruction fixture in, assert the produced entity out. This is the indexer's L1, isolated from any cluster.

```ts
// indexer/handlers/__tests__/position.test.ts
import { decodePositionAccount } from '../position';
it('decodes a PositionOpened account into the canonical entity', () => {
  const raw = Buffer.from(FIXTURE_BASE64, 'base64');          // captured from a real devnet account
  const e = decodePositionAccount(POSITION_PDA, raw, { slot: 250_123_456 });
  expect(e.id).to.equal(POSITION_PDA.toBase58());
  expect(e.owner).to.equal(EXPECTED_OWNER);
  expect(e.amount).to.equal('1000000');                       // u64 → string, no precision loss
  expect(e.slot).to.equal(250_123_456);                       // slot stamped for ordering + drift checks
});
```

Cover: each instruction/account variant, u64/u128 → string (no JS-number precision loss), `Option`/enum discriminators, and the **failure** path (truncated buffer, wrong discriminator → handler rejects, doesn't silently write garbage).

### 3b. Event-indexing coverage guard (`check-event-indexing` pattern)

The arb-builder `check-event-indexing.mjs` walks every contract `event` and asserts each has a subgraph handler — catching the audit bug where two contracts "shipped events that lived 8+ fires on-chain without ever being indexed, silently breaking the dashboards." The Solana port walks the **Anchor IDL** `events` (+ CPI-logged events / account types) and asserts each has a decode handler, with an explicit allow-list carrying a one-line reason per ignored event (the arb-builder's `INDEXING_IGNORE` discipline — *force a decision per event*):

```js
#!/usr/bin/env node
// scripts/check-event-indexing.mjs (Solana port)
import { readFileSync, readdirSync } from 'node:fs';
const idl = JSON.parse(readFileSync('target/idl/program.json', 'utf8'));
const handlersSrc = readdirSync('indexer/handlers')
  .map(f => readFileSync(`indexer/handlers/${f}`, 'utf8')).join('\n');

// Events deliberately NOT indexed — each maps to a reason so the choice is auditable.
const INDEXING_IGNORE = new Map([
  ['HeartbeatEmitted', 'keeper liveness ping; freshness covered by slot-lag guard'],
]);

const missing = (idl.events ?? [])
  .map(e => e.name)
  .filter(name => !INDEXING_IGNORE.has(name) && !handlersSrc.includes(name));

if (missing.length) {
  console.error(`Unindexed program events (add a handler or INDEXING_IGNORE entry): ${missing.join(', ')}`);
  process.exit(1);
}
console.log('OK: every program event has an indexer handler.');
```

### 3c. Entity-writer guard (`check-entity-writers` pattern)

The arb-builder `check-entity-writers.mjs` walks every `@entity` and asserts it has a writer (`new X(` / `X.load(`) — catching "ghost entities" defined in the schema but never produced, "exactly the leaderboards-always-empty bug." Together with 3b these "pin both halves of the indexer → schema → consumer chain." Port: walk every entity type in your indexer schema, assert ≥1 producer, allow-list with a reason:

```js
// scripts/check-entity-writers.mjs — every declared entity has a producer, else it's a ghost
const entities = [...schema.matchAll(/(?:type|@entity)\s+(\w+)/g)].map(m => m[1]);
const WRITER_IGNORE = new Map([['CohortPartner', 'deferred: human-curated, no on-chain source yet']]);
const ghosts = entities.filter(e => !WRITER_IGNORE.has(e) && !handlers.includes(`upsert${e}`) && !handlers.includes(`new ${e}`));
if (ghosts.length) { console.error(`Ghost entities (defined, never written): ${ghosts.join(', ')}`); process.exit(1); }
```

### 3d. Live drift guard — slot-lag + program-ID/PDA reconciliation

The arb-builder splits drift into two cron-scheduled scripts; both port directly. Solana measures freshness in **slots**, not blocks, and the address-drift class is **program-ID + PDA**, not contract address.

**Freshness (slot-lag) — `check-scribe-health.mjs` port.** The original fails only if `lagBlocks > 200` on **two consecutive checks 5s apart** (tolerates a single transient blip — don't page on one bad sample). Solana: compare the indexer's last-indexed slot to the RPC tip (`getSlot`), with a slot threshold tuned to your indexer's cadence:

```js
// scripts/check-indexer-health.mjs — slot-lag, two consecutive checks
const LAG_SLOTS = Number(process.env.LAG_SLOTS ?? 150);
async function once() {
  const [indexed, tip] = await Promise.all([
    fetch(INDEXER_URL).then(r => r.json()).then(j => j.lastIndexedSlot ?? 0),
    fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSlot', params: [{ commitment: 'confirmed' }] }) })
      .then(r => r.json()).then(j => j.result ?? 0),
  ]);
  return { indexed, tip, lag: Math.max(0, tip - indexed) };
}
let s = await once();
if (s.lag > LAG_SLOTS) { await new Promise(r => setTimeout(r, 5000)); s = await once(); } // re-check once
if (s.lag > LAG_SLOTS) { console.error(`ALERT: indexer slot-lag ${s.lag} > ${LAG_SLOTS} on 2 checks`); process.exit(1); }
```

**Value + manifest integrity — `reconcile-chain-scribe.mjs` port.** Freshness alone is insufficient: "a subgraph indexing address B while the app points at A *looks live* and is silently wrong." The reconciler pins three things; all three map to Solana:

1. **Freshness** — indexer slot within `LAG` of tip, `hasIndexingErrors === false`.
2. **Value agreement** — the indexer's latest decoded value equals the on-chain account value (proves the data *matches the program*, not just keeps up). Read the account directly and compare:
   ```js
   const onchain = await conn.getAccountInfo(STATE_PDA).then(a => decodeRoot(a.data));
   const indexed = await indexer('{ latestAttestation { root } }');
   if (onchain.root !== indexed.root) bad(`value drift: chain ${onchain.root} != indexer ${indexed.root}`);
   ```
3. **Program-ID + PDA manifest integrity** — **every** program ID and PDA the indexer subscribes to must (a) match `deployments/<cluster>.json` AND its web-bundle mirror, and (b) have **non-empty on-chain code** (`getAccountInfo(programId).executable === true`). This is the Solana form of the arb-builder's "subgraph pointed at a dead/old address" check — the exact cutover-drift class that "bit twice." A program upgrade that changes the ID, or a PDA derived from a stale seed/program-ID, fails here:
   ```js
   for (const pid of indexerProgramIds) {
     if (!manifest.programs.includes(pid)) bad(`indexer indexes ${pid} not in deployment manifest`);
     const info = await conn.getAccountInfo(new PublicKey(pid));
     if (!info?.executable) bad(`indexed program ${pid} has no executable code on ${cluster}`);
   }
   // PDA drift: re-derive each watched PDA from (seeds, current programId) and
   // assert it equals the address the indexer subscribes to.
   for (const { seeds, expected } of indexerPdas) {
     const [pda] = PublicKey.findProgramAddressSync(seeds, new PublicKey(currentProgramId));
     if (pda.toBase58() !== expected) bad(`PDA drift: derived ${pda} != indexed ${expected} (program upgraded?)`);
   }
   ```

Wire these on a `*/15 * * * *` cron like `subgraph-health.yml` (`permissions: { contents: read }`, Discord alert on failure). This is **observability that can also gate**: in `ci.yml` the reconcile/coverage scripts exit non-zero and **fail the build** (a PR gate); the cron variant pages ops without blocking a PR — same scripts, two triggers. Drift feeds the integration layer's manifest entry for [release-gate.md](release-gate.md).

## What this layer reports to the gate

```json
{ "name": "integration", "status": "pass", "required": true,
  "detail": "localnet suite green; Ed25519 verifier accepts/rejects correctly; indexer: matchstick green, 0 unindexed events, 0 ghost entities, slot-lag 12<150, 0 program-ID/PDA drift" }
```

A **`skip` is a gap, not a pass** — if the indexer guards didn't run this release, the gate blocks (the skipped-layer rule, [release-gate.md](release-gate.md)).

## Cross-links
- [e2e-realwallet.md](e2e-realwallet.md) — the SIWS/Ed25519 signature this layer verifies is the one Phantom approves; the explorer link the e2e asserts reads from this indexer.
- [../solana-testing](../solana-testing/SKILL.md) — program-internal correctness (Mollusk/LiteSVM/fuzz/coverage); this layer tests the integration *around* it.
- [release-gate.md](release-gate.md) — the integration + drift result rolls into the release manifest; a failed reconcile or a skipped guard blocks the release.

Sources: `arb builder/.github/workflows/ci.yml` (subgraph job) · `arb builder/.github/workflows/subgraph-health.yml` · `arb builder/scripts/{check-event-indexing,check-entity-writers,check-scribe-health,reconcile-chain-scribe}.mjs`

_Last verified: June 2026_
