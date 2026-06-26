# Resources — pinned index

Every tool, version, repo, and doc this skill references. Versions are current as of **June 2026**. Treat this table as the source of truth; the prose pages link back here.

## Tools & versions

| Tool | Purpose | Version (June 2026) | Repo / docs |
|---|---|---|---|
| litesvm (crate) | In-process SVM for Rust program tests | **0.13.0** | [crates.io/crates/litesvm](https://crates.io/crates/litesvm) · [github/kevinheavey/litesvm](https://github.com/kevinheavey/litesvm) |
| litesvm (npm) | In-process SVM for TS program/client tests | **1.2.0** | [npm: litesvm](https://www.npmjs.com/package/litesvm) · same repo |
| mollusk-svm | Lightweight SVM harness for unit/CU testing | **0.13.4** | [github/anza-xyz/mollusk](https://github.com/anza-xyz/mollusk) |
| mollusk-svm-bencher | Compute-unit benchmarking for mollusk | **0.13.4** | same repo |
| trident | Rust fuzzing framework for Anchor/native programs | **0.12.0** stable · **0.13.0-rc.4** | [github/Ackee-Blockchain/trident](https://github.com/Ackee-Blockchain/trident) |
| solana-bankrun | (DEPRECATED) old in-process test runner | **0.4.0** — use litesvm | [github/kevinheavey/solana-bankrun](https://github.com/kevinheavey/solana-bankrun) |
| surfpool | Validator-backed / mainnet-fork simnet; Anchor 1.x validator path | **1.4.0** | [github/txtx/surfpool](https://github.com/txtx/surfpool) · [docs.surfpool.run](https://docs.surfpool.run) |
| anchor (avm/anchor-cli) | Program framework + `anchor test` harness | **1.1.1** | [anchor-lang.com](https://www.anchor-lang.com) |
| anchor-litesvm | Anchor `Program`/provider backed by `LiteSVM` | **0.4.0** | [github/kevinheavey/litesvm](https://github.com/kevinheavey/litesvm) |
| litesvm-testing | Assertion/ergonomics helpers over litesvm | **0.2.0** | crates.io / litesvm ecosystem |
| sbpf-coverage | sBPF code-coverage for Solana programs | _unpinned — verify_ | [LimeChain](https://github.com/LimeChain) |
| anchor-coverage | Coverage tooling for Anchor programs | _unpinned — verify_ | [trailofbits](https://github.com/trailofbits) |
| @solana/kit | Modular JS/TS SDK (was web3.js v2) | **6.10.0** | [github/anza-xyz/kit](https://github.com/anza-xyz/kit) |
| @solana/web3.js | Legacy JS SDK — **maintenance only** | **1.98.4** | [github/solana-labs/solana-web3.js](https://github.com/solana-labs/solana-web3.js) |
| proptest | Property-based testing (Rust) | **1.x** | [github/proptest-rs/proptest](https://github.com/proptest-rs/proptest) |

## Version hygiene

- **`litesvm` crate (0.13) and `litesvm` npm (1.2) version numbers diverge** — they're the same project but versioned independently. Never assume the crate and npm package share a number; pin each separately.
- **Use the modular `solana-*` crates, not the monolithic `solana-sdk`.** The SDK has been split (`solana-program`, `solana-pubkey`, `solana-instruction`, `solana-account`, …); depending on `solana-sdk` pulls a heavy, increasingly-deprecated umbrella. litesvm/mollusk are built on the split crates.
- **Trust crates.io / npm over README badges.** Badges go stale and pre-release tags (e.g. trident `0.13.0-rc.4`) often aren't the version you actually want — confirm the published release before pinning. Run `cargo search` / `npm view <pkg> version`.
- **bankrun is dead.** `solana-bankrun` 0.4.0 is deprecated by its maintainer in favour of litesvm; migrate any remaining suites.

## Docs

**Anchor testing**
- Anchor book — testing: <https://www.anchor-lang.com/docs/testing>
- `anchor test` / `anchor.toml` reference: <https://www.anchor-lang.com/docs/manifest>

**litesvm**
- litesvm docs (Rust + TS): <https://www.litesvm.dev>
- TS quickstart: <https://www.litesvm.dev/docs/typescript>

**Solana program testing guides**
- Solana docs — testing programs: <https://solana.com/docs/programs/testing>
- mollusk usage: <https://github.com/anza-xyz/mollusk#readme>
- trident fuzzing book: <https://ackee.xyz/trident/docs/latest/>

**Surfpool**
- <https://docs.surfpool.run>

> Items marked _unpinned — verify_ (sbpf-coverage, anchor-coverage) had no stable pinned release confirmed at time of writing; check the repo's latest tag before use.

## See also

- [anchor-harness.md](./anchor-harness.md)
- [ts-testing-kit.md](./ts-testing-kit.md)
- [litesvm-integration.md](./litesvm-integration.md)

_Last verified: June 2026_
