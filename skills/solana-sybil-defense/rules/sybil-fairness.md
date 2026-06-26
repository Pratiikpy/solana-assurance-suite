# Rule: sybil-fairness

Constraints for all sybil detection, eligibility, and audit work in this skill. These are not
suggestions. The core ethic: catch farms without punishing legitimate users.

- **Never flag on a single signal.** A wallet or cluster requires sufficient size **and** ≥ 2
  corroborating signals (`burst`, `amountUniform`, `fpShared`, `cexShared`). One signal alone —
  especially a shared CEX tag — is the classic false-positive trap and is never sufficient.
- **Bias to precision.** A denied legitimate user is a worse outcome than a missed sybil. When a
  cluster is borderline, prefer including the claimant and flagging for manual review over
  excluding. Spend recall to protect precision, not the reverse.
- **Always provide an appeals path.** Any exclusion must come with a real, defined way to
  contest it — a human reviewer and a timeline. No appeals route means the decision is not
  defensible, regardless of the score.
- **Publish the methodology.** Signals, thresholds, counts, and known limits must be published
  and reproducible so an excluded user can understand *why*. No opaque exclusion.
- **Scores are decision-support, not verdicts.** A flag means "look here," never "deny this."
  Consequential eligibility/forfeiture decisions are made by humans, not by a heuristic.
- **Never request or store PII.** Work from on-chain funding and behavior only. Do not request,
  infer, or persist off-chain identity to strengthen a case.
- **Not legal or financial advice.** Eligibility, forfeiture, and clawback carry legal and
  financial consequences that are the operator's responsibility, made with counsel — never
  delegated to this tooling.
