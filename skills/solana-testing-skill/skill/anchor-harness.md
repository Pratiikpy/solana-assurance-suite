# Anchor test harness

The Anchor test workflow and where it changed. Anchor latest is **1.1.1**; a large fraction of live repos are still on **0.31.x**. Write tests version-agnostic where you can, and know the two key differences below.

## The 0.31 vs 1.x split

| | 0.31.x | 1.x (1.1.1) |
|---|---|---|
| `anchor init` default test template | ts-mocha + `@coral-xyz/anchor` provider against `solana-test-validator` | **litesvm** in-process test template |
| Validator-backed path | `solana-test-validator` | **Surfpool** (`surfpool` simnet, mainnet-fork capable) |
| Test speed | slow — validator boot (~seconds) + real slot timing | fast — no boot, no real slots |

Historically `anchor test` did three things: boot `solana-test-validator`, deploy your program(s), then run `ts-mocha` with `chai`. The validator boot and real wall-clock slot progression dominated runtime; a trivial test suite took seconds before the first assertion. Anchor 1.x makes `litesvm` the default scaffold so the common case (pure program logic) needs no validator at all, and routes the validator-backed case through Surfpool instead of the legacy test validator.

## anchor.toml

The harness is driven entirely by `anchor.toml`. The two sections that matter for testing:

```toml
[provider]
cluster = "localnet"      # or "devnet" / a custom RPC URL
wallet  = "~/.config/solana/id.json"

[scripts]
# `anchor test` runs this after (optionally) starting a validator.
test = "yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts"
# 1.x litesvm template typically points at vitest / node:test instead:
# test = "vitest run"

[test]
startup_wait = 5000       # ms to wait for validator readiness
[test.validator]
url = "https://api.mainnet-beta.solana.com"   # clone source
[[test.validator.clone]]                       # pull a program/account from mainnet
address = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
[[test.genesis]]                               # deploy an extra program at genesis
address = "..."
program = "./deps/some_program.so"
```

`[scripts].test` is just a shell command — swap mocha for vitest/`node --test`/jest freely. `[test.*]` only applies to the validator-backed path; a litesvm suite ignores it and loads programs in-process.

## Running

```bash
anchor test                          # build + deploy + run [scripts].test, managing a validator/Surfpool
anchor test --skip-local-validator   # do NOT start a validator; tests hit whatever [provider].cluster points at
anchor test --skip-build             # reuse the existing target/deploy artifacts
anchor test --skip-deploy            # validator starts but Anchor won't (re)deploy
```

Use `--skip-local-validator` when your test process spins up its own SVM (litesvm/Surfpool) or when pointing at devnet. A litesvm suite never wants Anchor to boot a validator, so the 1.x template effectively runs in this mode.

## Fast tests: litesvm / bankrun provider

For pure program logic, run the program inside an in-process SVM — no validator, no boot, deterministic clock. **`bankrun` (`solana-bankrun`) is deprecated; its README points you to litesvm.** Do not start new suites on bankrun.

TypeScript side: drive your built `.so` with the `litesvm` npm package (see [ts-testing-kit.md](./ts-testing-kit.md)), or use `anchor-litesvm` to get an Anchor-style `Program`/provider backed by a `LiteSVM` instance so existing `program.methods.*().rpc()` test code keeps working:

```ts
import { LiteSVM } from "litesvm";
import { LiteSVMProvider } from "anchor-litesvm";
import { Program } from "@coral-xyz/anchor";

const svm = new LiteSVM();
svm.addProgramFromFile(programId, "target/deploy/my_program.so");
const provider = new LiteSVMProvider(svm);
const program = new Program(idl, provider);   // methods/account-fetch work, no validator
```

This is the right default for instruction-logic, account-state, and error-code assertions. It runs in milliseconds and lets you fast-forward the clock instead of sleeping (see clock control in [ts-testing-kit.md](./ts-testing-kit.md)).

## When you still need a validator (Surfpool / test-validator)

litesvm is an in-process bank — it does **not** serve a JSON-RPC endpoint and does not reproduce every RPC method or runtime nuance. Reach for `anchor test` with Surfpool (or the legacy test validator) when:

- **RPC-method-dependent client code** — you're testing a frontend/SDK that calls `getProgramAccounts`, `getSignaturesForAddress`, websocket `accountSubscribe`/`logsSubscribe`, `simulateTransaction` with specific return shapes, etc. litesvm has no RPC server.
- **Multi-program mainnet state** — your program CPIs into deployed programs (Token, Token-2022, Metaplex, a DEX) and you want their *real* on-chain code and accounts. Surfpool can fork mainnet state on demand; the test validator does it via `[test.validator.clone]`.
- **Realistic slot/epoch/fee behaviour** or banking-stage semantics that the in-process bank doesn't model.

Rule of thumb: program logic → litesvm; "does my client talk to a real node correctly" or "does my CPI work against real mainnet programs" → Surfpool/validator.

## See also

- [ts-testing-kit.md](./ts-testing-kit.md) — TypeScript testing with the `litesvm` npm package + `@solana/kit`
- [litesvm-integration.md](./litesvm-integration.md) — Rust-side litesvm
- [../core/programs/anchor.md](../core/programs/anchor.md) — Anchor program model

_Last verified: June 2026_
