# Rule: Release Gate

The release gate is the single automated verdict that says a build is safe to ship. These rules are non-negotiable; a gate that doesn't block on a real regression is decoration.

1. **A required layer that is `fail` OR `skip` blocks the release.** You cannot ship what you didn't test — a skipped required layer is a gap, not a pass. The gate treats `skip` exactly like `fail` for required layers (`allowSkip:false`).

2. **Non-required layers warn only.** Observability layers (uptime, keeper freshness) report and alert but never block a PR. Mark them `required:false`.

3. **Every claimed pass carries evidence — a finalized signature + an audited screenshot + an on-chain read.** A `status:"pass"` string is a claim, not proof. For state-changing layers the evidence is a real signature reaching `finalized` with `err == null`, a screenshot you actually looked at, and a decoded source-of-truth read (`getAccountInfo`/`getBalance`/`getTokenAccountBalance`). Re-verify the read on an alternate RPC endpoint — one endpoint can lag or lie.

4. **A green badge with no CI run behind it is RED.** A pass whose detail can't be tied to a real artifact — signature, screenshot path, scan output, report — is treated as a failure. Stale evidence from a prior release does not count for this one.

5. **Never blind-sign a wallet popup.** Before approving in Phantom, the payload must be read and asserted to match the UI's promise — correct cluster, program/instruction, accounts, amounts (and for SIWS: statement, domain, nonce). A mismatch between UI intent and the wallet payload is a severe defect. This applies to both the human-level QA pass and to what the e2e suite asserts.

6. **A `live`/`devnet` e2e layer must produce a finalized signature or `fail` — it does not `skip`.** Naming a job "live" while it silently runs `local` and skips every on-chain assertion is lying in the Actions UI. Name the job for what it actually runs.

7. **Soft-gates must carry a dated TODO to harden.** A metric layer permitted to warn instead of block (e.g. Lighthouse before the prod URL lands) is allowed only with a dated TODO recording when and how it becomes a hard gate. A soft-gate with no expiry is a permanent hole.

8. **Never silently downgrade, and never add blind sleeps.** Blocked from the required depth → STOP and report the blocker; do not quietly weaken a check, mark a layer `pass` to dodge a `skip` block, or call a weaker result "done." Wait on a real condition (poll signature status / the visible success value) — never a fixed `sleep`/`waitForTimeout` to make a flow pass.

See: [../skill/release-gate.md](../skill/release-gate.md) · [../skill/model.md](../skill/model.md) · [../skill/human-level-qa.md](../skill/human-level-qa.md) · [../skill/e2e-realwallet.md](../skill/e2e-realwallet.md).
