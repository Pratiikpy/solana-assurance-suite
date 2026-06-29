---
name: scan-deception
description: Run the deception-defense pass on a codebase — static scan for the seven deception patterns, then summarize the findings by reach with fixes.
---

Run the deception scan and report what the product claims but can't back up.

Steps:

1. Resolve the target path from the argument (default: the current project's app/`src`).
2. Run `node <skill>/tools/deception-scan/deception-scan.mjs <target> --json` and parse the findings.
3. Group by pattern and severity. For each high-severity finding, show `file:line`, the evidence, and the one-line fix.
4. Print a summary: counts by pattern, and a verdict — **SHIP** if no high-severity deception, else **NOT SHIP** with the blockers listed.
5. If the app is runnable and the user wants the full pass, hand off to the `deception-hunter` agent to drive the live flows (the static scan can't see runtime-only fakes — reverts that paint green, badges wired to lying checks). Say so rather than implying the static pass is complete.

Keep the output tight: lead with the verdict and the high-severity findings; numbers, not adjectives.
