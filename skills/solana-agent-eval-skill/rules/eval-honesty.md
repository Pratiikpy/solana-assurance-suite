# Rule: Eval honesty

An eval exists to tell you the truth about the agent. Tune it to flatter the agent and it tells you a comfortable lie that ships bugs. These hold for every eval in this skill.

- **No leakage. Never tune the dataset to the agent.** The agent does not see `golden.json` — only prompts in, outputs out. Do not edit `expected` to match the agent's (possibly buggy) output, delete hard or failing tasks, or make the dataset reachable from the agent's context. `expected` is hand-verified against the protocol, not copied from the agent.

- **Report the real score, including regressions.** State the actual `scores:` and `GATE:` output, drops included. A regression is information, not a failure to hide. Never round up, estimate, or omit failing tasks.

- **A green eval requires the suite to have actually run.** No score is valid without pasted output — the `scores:` line, the `✗` failing-task lines, and the `GATE:` verdict from `tools/agent-eval/eval.mjs`. "The code looks right" is not a pass. If you couldn't run it, say so.

- **Structural pass != correct on-chain outcome.** `buildable == 1` means tool, program, accounts, and required arg keys are all present — not that the instruction moves the right lamports to the right place. For every value-moving tool (transfer, swap, stake, custom CPI), confirm the effect with the `svm-grounded` scorer (`svm-outcome`, LiteSVM via `../solana-testing`). A buildable tx that drains the wrong account still fails.

- **Keep the negative / should-refuse cases.** Malformed address, insufficient funds, unsupported program, prompt-injection. They expect *no* instruction; an agent that emits one fails them. Do not delete or weaken them to lift a score — they are the cases that catch an agent confidently doing the wrong thing.

- **Don't move the goalposts to pass the gate.** On a FAIL, fix the agent — not the baseline or the dataset. Raise `baseline.json` only after a verified, intentional improvement, committed in the same change.
