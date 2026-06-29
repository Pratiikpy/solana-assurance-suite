import { VerifiedBadge } from "./badges";

// DEFECT FIXTURE — plants: hardcoded-status-badge, fake-verification.
const meta = { status: "OPERATIONAL" };
const proof = { verified: true };

export function StatusBar() {
  return (
    <header>
      <span className="badge">LIVE</span>
      <span>{meta.status}</span>
      <VerifiedBadge open={proof.verified} />
      <span>Proof of Reserves</span>
    </header>
  );
}
