import { VerifiedBadge } from "./badges";
import { verifyMerkleRoot } from "./proofs";

// CLEAN CONTROL — status derived from a real check; the verified badge is backed by a
// recomputed proof. Must produce ZERO findings.
export async function StatusBar({ isLive, root }: { isLive: boolean; root: string }) {
  const proofOk = await verifyMerkleRoot(root);
  return (
    <header>
      <span className="badge">{isLive ? "LIVE" : "DOWN"}</span>
      {proofOk && <VerifiedBadge />}
    </header>
  );
}
