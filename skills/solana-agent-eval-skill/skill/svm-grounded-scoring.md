# SVM-Grounded Outcome Scoring — The Differentiator

Generic LLM-eval frameworks (Braintrust, DeepEval, OpenAI Evals, Inspect) score the **text** an agent emits: string match, embedding similarity, or an LLM-as-judge rubric. None of them can answer the only question that matters for a Solana agent: **if you actually ran the instruction this agent produced, would the chain end up in the right state?** That question is uncheckable without an SVM. This is the one scorer no chain-agnostic harness can replicate, and it is the core of this skill.

The structural scorers in [`../tools/agent-eval/eval.mjs`](../tools/agent-eval/eval.mjs) (`tool`, `program`, `accounts`, `argValidity`, `buildable`) are necessary but not sufficient. They prove the agent named the right tool and program and supplied a buildable account set — they do **not** prove the transaction *does what the prompt asked*. An agent can produce a perfectly buildable `transfer_token` ix that moves the wrong amount, debits the wrong ATA, or leaves the destination uncreated. `buildable=1`, outcome wrong. The `svm-outcome` scorer closes that gap.

> **The pipeline in one line:** agent decision → real simulation → state assertion. The agent emits an instruction; LiteSVM executes it against a seeded ledger; we assert the resulting on-chain state equals the golden expected state. No oracle, no judge — the runtime is the oracle.

## Text scoring vs outcome scoring

| | Text-similarity / judge | SVM-grounded outcome |
|---|---|---|
| Checks | the words/JSON the agent wrote | the **state** the agent's ix produces |
| Catches wrong `amount` | only if it changes the string | yes — balance assertion fails |
| Catches wrong destination ATA | rarely | yes — owner/balance on wrong account |
| Catches missing `create_ata` before transfer | no | yes — transfer reverts (AccountNotFound) |
| Catches stale/forked mainnet decimals | no | yes — if seeded from a real mint |
| Determinism | model-dependent (judge drifts) | exact (`assert_eq!`) |
| Dependency | none | an in-process SVM |

Run the structural scorers first — they are zero-dependency and fail fast on "agent named the wrong program." Promote a task to `svm-outcome` only once it is `buildable=1`; there is nothing to simulate otherwise.

## Reuse the solana-testing harness — do not reinvent it

The simulation substrate already exists in the sibling skill. Do **not** stand up a validator or a second SVM wrapper. Reuse it directly:

- [`../../solana-testing-skill/skill/litesvm-integration.md`](../../solana-testing-skill/skill/litesvm-integration.md) — the Rust LiteSVM harness: `LiteSVM::new()`, `airdrop`, `add_program_from_file`, `send_transaction`, `get_account`, `set_account` (plant golden pre-state), clock/slot warp. Pins: Rust crate `litesvm 0.13.0`.
- [`../../solana-testing-skill/skill/ts-testing-kit.md`](../../solana-testing-skill/skill/ts-testing-kit.md) — the TypeScript path: npm `litesvm 1.2.x` + `@solana/kit 6.10.0`. Use this when the agent and golden dataset are already JS (as in [`../examples/eval-run`](../examples/eval-run)).
- [`../../solana-testing-skill/skill/bug-class-playbook.md`](../../solana-testing-skill/skill/bug-class-playbook.md) — outcome assertions are the same shape as the playbook's negative tests. "Did the agent's transfer conserve balances?" is bug-class #5; "did it touch only the owner's account?" is #2/#3. An agent that emits an unsound ix fails the exact assertion the playbook would write for a vulnerable program.

The eval harness is a *consumer* of that harness, pointed at agent-produced instructions instead of hand-written test inputs.

## The golden expected state

Extend the golden dataset ([`../examples/eval-run/golden.json`](../examples/eval-run/golden.json)) with an `outcome` block per task: the pre-state to seed and the post-state to assert. Structural fields stay; `outcome` is what the SVM scorer reads.

```json
{
  "id": "transfer-spl",
  "prompt": "Send 10 USDC to <addr>",
  "expected": { "tool": "transfer_token", "program": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "accounts": ["source", "dest", "owner", "mint"], "args": { "amount": 10000000 } },
  "outcome": {
    "seed":   [{ "kind": "ata", "name": "source", "mint": "USDC", "owner": "agentWallet", "amount": 50000000 },
               { "kind": "ata", "name": "dest",   "mint": "USDC", "owner": "recipient",   "amount": 0 }],
    "assert": [{ "account": "source", "field": "tokenAmount", "eq": 40000000 },
               { "account": "dest",   "field": "tokenAmount", "eq": 10000000 },
               { "account": "dest",   "field": "owner",       "eq": "recipient" }]
  }
}
```

The assertions are deliberately on **state**, not on the ix: `dest` ends with exactly 10 USDC, `source` is debited exactly 10, `dest.owner` is the recipient. A wrong-amount, wrong-ATA, or no-op ix all fail here while still scoring `buildable=1` structurally.

## Runnable sketch — wire LiteSVM behind the structural scorer (TS)

This drives the **agent's produced instruction** into the reused npm `litesvm` harness and asserts golden post-state. It composes with `scoreTask` from the structural engine: structural gate first, simulation second.

```ts
// svm-outcome.mjs — outcome scorer; pairs with ../tools/agent-eval/eval.mjs
import { LiteSVM, FailedTransactionMetadata } from "litesvm";          // npm litesvm 1.2.x
import { PublicKey, Transaction } from "@solana/web3.js";              // litesvm 1.x ix/types
import { scoreTask } from "../tools/agent-eval/eval.mjs";

// seed: plant golden pre-state (ATAs, balances, owners) using the solana-testing patterns.
// buildIx: turn the agent's {tool, program, accounts, args} into a real Instruction (adapters.md
// maps each framework's output into this shape).
export function scoreOutcome(task, produced, { seed, buildIx, decode }) {
  const structural = scoreTask(task.expected, produced);
  if (structural.buildable < 1) return { ...structural, outcome: 0, reason: "not buildable" };

  const svm = new LiteSVM();
  const ctx = seed(svm, task.outcome.seed);          // pubkeys keyed by golden name
  const ix  = buildIx(produced, ctx);                // agent decision -> real instruction

  const tx = new Transaction({ feePayer: ctx.feePayer, recentBlockhash: svm.latestBlockhash() }).add(ix);
  tx.sign(ctx.signer);
  const res = svm.sendTransaction(tx);               // real simulation
  if (res instanceof FailedTransactionMetadata)
    return { ...structural, outcome: 0, reason: `reverted: ${res.toString()}` };

  for (const a of task.outcome.assert) {             // state assertion
    const acct = svm.getAccount(new PublicKey(ctx[a.account]));
    if (!acct) return { ...structural, outcome: 0, reason: `missing ${a.account}` };
    const got = decode(acct, a.field);               // tokenAmount | owner | lamports | data[..]
    if (String(got) !== String(a.eq))
      return { ...structural, outcome: 0, reason: `${a.account}.${a.field}=${got} != ${a.eq}` };
  }
  return { ...structural, outcome: 1, reason: "ok" };
}
```

Add `outcome` to the `dims` array in `evaluate()` so it rolls into the per-dimension scores and the regression `gate(baseline, current)` — a drop in outcome (agent started producing semantically-wrong-but-buildable ixs) then fails CI exactly like a structural drop. See [`ci-gating.md`](ci-gating.md).

## Rust path

When the golden programs are real SBF binaries (Anchor, native), score in Rust against the `litesvm 0.13.0` crate instead — identical pipeline, stronger fidelity:

```rust
let mut svm = LiteSVM::new();
svm.add_program_from_file(token_program, "target/deploy/spl_token.so").unwrap();
seed_golden_state(&mut svm, &task.outcome.seed);          // set_account / airdrop pre-state
let ix = build_ix(&produced, &ctx);                       // agent decision -> Instruction
let tx = Transaction::new(&[&ctx.signer], Message::new(&[ix], Some(&ctx.fee_payer)), svm.latest_blockhash());
match svm.send_transaction(tx) {
    Err(meta) => fail("reverted", meta.meta.logs),        // FailedTransactionMetadata carries logs+CU
    Ok(_) => for a in &task.outcome.assert {              // assert post-state
        let acct = svm.get_account(&ctx[&a.account]).expect("account missing");
        assert_state(&acct, a);                           // tokenAmount / owner / lamports
    },
}
```

Plant golden pre-state with `set_account` / `airdrop`, deploy the real program with `add_program_from_file`, send the agent's tx, read post-state with `get_account`. The runtime decides pass/fail — see [`../../solana-testing-skill/skill/litesvm-integration.md`](../../solana-testing-skill/skill/litesvm-integration.md) for the full API and the CPI/PDA patterns this inherits.

## Failure taxonomy this scorer uniquely catches

- **Right tool, wrong arg.** `transfer_token` with `amount: 100000000` (100 USDC, not 10). `buildable=1`; `source.tokenAmount` assertion fires.
- **Right shape, wrong account wiring.** `dest` set to the source's ATA, or `owner` swapped with `payer`. Structural `accounts` Jaccard can still be 1.0 if names match; the **owner** assertion catches the misroute.
- **Missing prerequisite ix.** Agent emits `transfer_token` to an ATA that does not exist yet (skipped `create_ata`). Reverts in LiteSVM with `AccountNotFound` — a pure-text scorer sees a clean-looking transfer.
- **Decimals / mint confusion.** Agent treats a 6-decimal mint as 9-decimal. Seed from the real mint and the balance assertion is off by 1000×.
- **Silent no-op.** Agent emits a structurally valid but logically empty ix; post-state equals pre-state; assertion fails.

## Limits — what stays out of scope

LiteSVM models the **bank/SVM execution layer only**, not the RPC surface, gossip, or live mainnet programs. If a golden task depends on a real AMM/oracle or `getProgramAccounts` filters, seed a forked snapshot or route that task to **Surfpool** (mainnet-fork) instead of LiteSVM — the same boundary the testing skill draws. Outcome scoring is for *the agent's instruction logic*; it does not validate slippage against live liquidity. Keep those tasks structural, or fork.

## See also

- [`adapters.md`](adapters.md) — map each framework's agent output into the `{id, tool, program, accounts, args}` shape `buildIx` consumes.
- [`ci-gating.md`](ci-gating.md) — fold `outcome` into the per-scorer regression gate and fail PRs on a drop.
- [`resources.md`](resources.md) — pinned versions for litesvm, `@solana/kit`, and the agent frameworks.
- [`../tools/agent-eval/eval.mjs`](../tools/agent-eval/eval.mjs) — the structural scorers and `gate(baseline, current)` this extends.

_Last verified: June 2026_
