# solana-loops

**Hand off a goal and walk away — come back to verified progress, not a half-done mess.** A folder of battle-tested autonomous loop directives for Solana builders, hardened so the loop **can't fake "done" and can't run forever.**

Generic Ralph loops already exist (`while :; do cat PROMPT.md | claude; done`) — and they fail the same two ways: the agent declares done when it isn't (overconfident termination, the #1 loop failure), or it loops forever and burns money. solana-loops fixes both: an objective **Stop-gate** decides done by re-verifying every item from ground truth, and built-in guardrails (max-sessions, stuck-detection, turn caps, fresh context per session) stop runaways.

## The loops

| Loop | Use it to… | "Done" = |
|---|---|---|
| **prd-to-product** | hand off a PRD → come back to a shipped, verified product | every item verified-with-proof or blocked-with-reason |
| **audit** | drive a security audit → a few bulletproof, de-inflated findings | coverage-contract met + CONFIRMED findings |
| **ship-it** | drive a build → mainnet-ready by looping the assurance suite's gates | every applicable suite gate green |

Full directives in [`skill/loops/`](skill/loops/); the shared engine + the one rule + guardrails in [`skill/engine.md`](skill/engine.md).

## The one rule (why this beats a generic loop)

**"Done" is machine-verified, and the agent doesn't get to declare it.** An item counts only when it's *verified-with-proof*, *fixed-and-re-tested*, or *blocked-with-a-real-reason*. A self-reported `done` with a failing check is overridden by the gate. For `ship-it`, the gates *are* the assurance suite — so the loop literally can't call a build "ready" while it's faking success.

## Run it

```bash
bash tools/loop-runner/run.sh <loop-dir> [start] [max-sessions]
```

## Proof

```bash
( cd examples/loop-proof && node verify.mjs )
# 6/6: re-verifies (no fake-done) · blocked-with-reason honored · DONE only on real evidence · max-session + stuck guardrails fire
```

Evidence over claims — see [EVAL_REPORT.md](EVAL_REPORT.md).

## Install

```bash
./install.sh        # copies skill/ + tools/ into ~/.claude/skills/solana-loops
```

Part of the [Solana Assurance Suite](../../README.md) — the orchestration capstone: the other skills are the gates, these loops are the driver. MIT.
