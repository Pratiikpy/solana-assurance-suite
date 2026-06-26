# Adapters — Normalize Agent Output into the Scorer Shape

The scorers in [`../tools/agent-eval/eval.mjs`](../tools/agent-eval/eval.mjs) and the outcome scorer in [`svm-grounded-scoring.md`](svm-grounded-scoring.md) eat one shape, and one only:

```ts
// one record per golden task id
{ id: "transfer-spl", tool: "transfer_token", program: "Tokenkeg...",
  accounts: ["source", "dest", "owner", "mint"], args: { amount: 10000000 } }
```

`tool` is the action/tool name the agent chose; `program` is the on-chain program id it targeted; `accounts` are the **role names** the golden dataset uses (`source`, `dest`, `owner`, `mint` — not pubkeys); `args` are the decoded instruction args. Every framework expresses an agent's decision differently — SAK as an `Action`, eliza as an `Action` firing a `HandlerCallback`, rig as a `Tool` return — so each needs a thin adapter that emits this record. Adapters are pure functions over a captured run; they never call an LLM.

Two ways to feed them:
- **Decision capture (preferred).** Intercept the tool/action *call* — name + validated args + the accounts the handler resolved — before it touches the network. Deterministic, cheap, no RPC. This is what the structural scorers want.
- **Instruction capture.** Let the handler build the `TransactionInstruction` but not send it; read `ix.programId` and `ix.keys`. Required to feed the SVM outcome scorer, which needs a real ix to simulate.

> The `program` and per-account roles are the load-bearing fields. Capture the resolved `programId` and the account ordering the handler actually produced, not what the prompt implied — that is the whole point of scoring the agent, not the spec.

## solana-agent-kit (SendAI) — tool calls

SAK `2.0.10` exposes capabilities as `Action`s (`{ name, similes, description, examples, schema, handler(agent, input) }`) registered via plugins (`.use(TokenPlugin)`, etc.), then surfaced to an LLM through `createVercelAITools` / `createLangchainTools` / `createOpenAITools`. The agent's "decision" is *which action* the model invoked and *with what validated input*. Intercept at the `Action.handler` boundary: the `schema` has already validated `input`, and you map the input into roles + the action's known `programId`.

```ts
import { z } from "zod";
// wrap an agent.actions[] entry so each invocation appends a scorer record
export function captureSAKAction(action, programOf, accountsOf, sink) {
  const handler = action.handler;
  action.handler = async (agent, input) => {
    sink.push({
      id: input.__taskId,                          // tag the task in the eval prompt
      tool: action.name,                           // e.g. "TRANSFER_TOKEN" / "transfer_token"
      program: programOf(action.name),             // resolved program id for this action
      accounts: accountsOf(action.name, input, agent), // role names: ["source","dest","owner","mint"]
      args: { amount: input.amount },              // decoded ix args from the zod-validated input
    });
    return handler(agent, input);                  // run as normal (or stub to skip the network)
  };
  return action;
}
// usage: agent.actions.forEach(a => captureSAKAction(a, progMap, acctMap, runRecords));
```

`programOf`/`accountsOf` are small lookup tables you own — SAK actions know their target program; you encode "the SPL transfer touches source/dest/owner/mint" once. For SVM outcome scoring, have `accountsOf` build the real `TransactionInstruction` and read `ix.programId` + `ix.keys` instead of a table.

## elizaOS — actions firing a HandlerCallback

eliza `2.0.0-alpha` defines `Action` as `{ name, description, similes?, examples?, validate, handler }`. The handler signature is `handler(runtime, message, state, options, callback, responses) => Promise<ActionResult>`. The decision is the action that `validate`d true and ran; the **output** arrives two ways: the returned `ActionResult` (`{ success, data, ... }`) and the `HandlerCallback(content: Content, actionName?)` the handler invokes to emit a message. Capture both — put the structured ix data in `ActionResult.data`, read it there.

```ts
// wrap an eliza Action; capture from ActionResult.data (and the callback as a fallback)
export function captureElizaAction(action, mapToRecord, sink) {
  const handler = action.handler;
  action.handler = async (runtime, message, state, options, callback, responses) => {
    let captured;
    const wrapped = async (content, actionName) => {     // intercept emitted Content
      captured ??= mapToRecord(action.name, content, message);
      return callback ? callback(content, actionName) : [];
    };
    const result = await handler(runtime, message, state, options, wrapped, responses);
    // prefer the structured payload the action put on ActionResult.data
    const rec = mapToRecord(action.name, result?.data ?? captured, message);
    if (rec) sink.push(rec);
    return result;
  };
  return action;
}
// mapToRecord(name, payload, msg) -> { id, tool, program, accounts, args }
```

`mapToRecord` pulls the program id and account roles out of `result.data` (where a Solana action should stash the ix it built) and tags `id` from the eval message. If a plugin's action does not surface its ix on `data`, intercept its instruction-builder directly — same instruction-capture path as SAK.

## rig (Rust) — tool outputs

rig (`rig-core 0.35.0`, facade `rig 0.36.0`) models a capability as the `Tool` trait: `const NAME`, `type Args`, `type Output`, `definition(prompt)`, and `call(args) -> Result<Output, Error>`. The agent's decision is the tool the model dispatched and the deserialized `Args`; the result is `Output`. Make the tool's `Output` carry the scorable fields (or emit a record as a side effect). Since rig serializes `Output` to a string for the model anyway, a serde-friendly struct is free.

```rust
use serde::{Deserialize, Serialize};

#[derive(Deserialize)] struct TransferArgs { task_id: String, amount: u64, /* ... */ }

#[derive(Serialize, Clone)]                  // also the scorer record (camelCase to match the JS shape)
#[serde(rename_all = "camelCase")]
struct ScorerRecord { id: String, tool: String, program: String, accounts: Vec<String>, args: serde_json::Value }

impl Tool for TransferToken {
    const NAME: &'static str = "transfer_token";
    type Error = TransferError;
    type Args = TransferArgs;
    type Output = ScorerRecord;              // the record IS the tool output
    async fn definition(&self, _p: String) -> ToolDefinition { /* json schema */ }
    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let ix = build_transfer_ix(&args)?;  // build the real ix (capture, do not send)
        Ok(ScorerRecord {
            id: args.task_id, tool: Self::NAME.into(),
            program: ix.program_id.to_string(),
            accounts: role_names(&ix),       // map ix.accounts -> ["source","dest","owner","mint"]
            args: serde_json::json!({ "amount": args.amount }),
        })
    }
}
```

Collect each `call`'s `Output` into a `Vec<ScorerRecord>` over the eval run and serialize to the same JSON array as the JS adapters. For SVM outcome scoring, keep the built `ix` and hand it to the Rust LiteSVM scorer in [`svm-grounded-scoring.md`](svm-grounded-scoring.md) directly.

## Capturing a run into an output file

The scorer reads a JSON array — one record per golden `id`, exactly the shape of [`../examples/eval-run/agent-v1.json`](../examples/eval-run/agent-v1.json). Drive the agent over every golden prompt, collect records via the adapter `sink`, write the array:

```ts
import { writeFileSync, readFileSync } from "node:fs";
const golden = JSON.parse(readFileSync("examples/eval-run/golden.json", "utf8"));
const records = [];
for (const task of golden) {
  // run the agent on task.prompt; inject task.id (e.g. as input.__taskId / eliza message id /
  // rig args.task_id) so the adapter can tag the record. Adapter pushes into `records`.
  await runAgent(task.prompt, task.id);
}
writeFileSync("agent-output.json", JSON.stringify(records, null, 2));
```

Then score and gate:

```bash
node tools/agent-eval/eval.mjs examples/eval-run/golden.json agent-output.json --baseline baseline.json
```

Pin the run: same model, same temperature (0 for repeatability), same seed prompts. A nondeterministic agent makes the regression `gate` noisy — see [`ci-gating.md`](ci-gating.md) for handling sampling variance (median-of-N, or temperature 0 in CI).

## Pitfalls

- **Role names, not pubkeys.** The golden `accounts` are stable role labels; map the agent's resolved pubkeys back to roles. A diff of raw pubkeys is meaningless across runs (fresh keypairs each time).
- **Capture resolved, not requested.** Record the `programId`/accounts the handler actually built, not what the prompt asked for — otherwise you score the spec, not the agent.
- **One record per id.** `evaluate()` keys outputs by `id` (`new Map(outputs.map(o => [o.id, o]))`); a missing id scores as all-zero for that task, a duplicate id silently overwrites.
- **Don't send on chain to score structurally.** Stub the network in the handler; only the SVM outcome scorer needs a real (simulated) execution, and that runs in-process.

## See also

- [`svm-grounded-scoring.md`](svm-grounded-scoring.md) — feed captured ixs into LiteSVM for state assertions.
- [`ci-gating.md`](ci-gating.md) — run the captured-output suite per PR and gate on regressions.
- [`resources.md`](resources.md) — pinned framework versions and source links.

_Last verified: June 2026_
