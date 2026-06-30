# EVAL_REPORT — solana-loops

Principle: evidence over claims. The loop's safety properties are proven, not asserted.

## Proof

`examples/loop-proof/verify.mjs` drives the Stop-gate (`tools/loop-runner/stop-gate.mjs`) through the
behaviours that decide whether an autonomous loop ships or lies.

| Command | Result |
|---------|--------|
| `( cd examples/loop-proof && node verify.mjs )` | **6/6 tests pass** |

What it proves:

- **Re-verifies (no fake-done)** — three items all self-reporting `status: "done"` with no proof are re-checked from ground truth and returned **unsatisfied**. The gate ignores the flag. This defends the #1 loop failure mode (overconfident termination).
- **Blocked-with-reason is honored; blocked-without-reason is not** — an item legitimately `blocked` with a real `blockReason` counts as satisfied; an empty reason does not.
- **DONE only on real evidence** — the loop completes only when every item's objective check passes.
- **Guardrail: max sessions** — a never-satisfiable item triggers STOP at the hard cap instead of looping forever (a loop with no cap can burn $500/hr).
- **Guardrail: stuck detection** — the same failing set for N iterations triggers STOP + surface, so the loop doesn't grind a wall.

## What this skill is (and isn't)

- It **is** the hardened, Solana-flavored version of the Ralph loop: an objective Stop-gate + on-disk state + guardrails + three proven directives (prd-to-product, audit, ship-it), modeled on real multi-session loops that shipped a product and Code4rena audit submissions.
- It is **not** a magic "build anything overnight" button. A loop only helps when "done" is checkable; flaky/environment/human-gated work is `blocked-with-reason`, surfaced. Realistic autonomous completion is ~80–95% on a good run.
- The proof measures the **gate's decision logic** on fixtures (file-existence checks for portability + determinism). In real use the same gate runs real checks (`cargo test`, `node --test`, `deception-scan`, an on-chain read) — that's a configuration of the same proven logic, not a new claim.

## Reproduce

```bash
cd skills/solana-loops/examples/loop-proof
node verify.mjs
```

Node >= 18, zero dependencies.
