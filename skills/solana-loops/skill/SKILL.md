---
name: solana-loops
description: A folder of battle-tested autonomous loop directives for Solana builders — hand off a goal and walk away, come back to verified progress, not a half-done mess. Each loop's "done" is machine-verified by a Stop-gate that won't let the agent fake completion or run forever. Use when a task has a checkable end state: turn a PRD into a shipped product (prd-to-product), drive a security audit to bulletproof findings (audit), or drive a build to mainnet-ready (ship-it). Triggers — "loop until done", "overnight build", "autonomous loop", "run this until it's ready", "ralph loop", "drive the PRD to green".
---

# solana-loops

Generic Ralph loops (`while :; do cat PROMPT.md | claude; done`) already exist — and they all fail the same way: the agent declares "done" when it isn't, or runs forever and burns money. **This skill is the hardened version: a small folder of proven loop directives whose "done" is decided by an objective Stop-gate, not the model's opinion.** The loop can't fake completion, and it can't run away.

## The loops

| Loop | Use it to… | "Done" = |
|---|---|---|
| **[prd-to-product](loops/prd-to-product.md)** | hand off a PRD and come back to a shipped, verified product | every PRD item verified-with-proof or blocked-with-reason |
| **[audit](loops/audit.md)** | drive an adversarial security audit to a few bulletproof, de-inflated findings | coverage-contract met + CONFIRMED findings written |
| **[ship-it](loops/ship-it.md)** | drive a build to mainnet-ready by looping the assurance suite's gates | every applicable suite gate green from ground truth |

All three run on one engine — read **[engine.md](engine.md)** first. It owns the rule that makes loops work and the guardrails that keep them safe.

## The one rule (why these win)

**"Done" must be machine-verifiable, and the agent doesn't get to declare it.** The Stop-gate (`tools/loop-runner/stop-gate.mjs`) re-verifies every item from ground truth and overrides any self-reported `done`. An item counts only when it's **verified-with-proof**, **fixed-and-re-tested**, or **blocked-with-a-real-reason**. That single property is what the whole field says separates a loop that ships from one that lies — and for `ship-it`, the gates *are* the assurance suite, so the loop can't call a build "ready" while it's faking success.

## Run it

```bash
bash tools/loop-runner/run.sh <loop-dir> [start] [max-sessions]
```

`<loop-dir>` holds the loop directive (`PROMPT.md`), the checklist (`loop.json`), and the state files (`MEMORY.md` / `PROGRESS.md` / `COVERAGE.md`). Each session is fresh; progress lives on disk + git. Guardrails (max-sessions, stuck-detection, per-session turn cap, fresh context) are built in.

## Proof

`examples/loop-proof` proves the Stop-gate's safety properties — the things that actually matter:

```bash
( cd examples/loop-proof && node verify.mjs )
# re-verifies (no fake-done) · blocked-with-reason honored · DONE only on real evidence · max-session + stuck guardrails fire
```

## Honest scope

A loop only helps when "done" is checkable. Flaky/environment-specific failures and anything needing a human are `blocked-with-reason`, surfaced — not faked green. Expect ~80–95% autonomous completion on a good run; the last mile is honest blocks for the operator.
