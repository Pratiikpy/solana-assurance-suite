import { contract } from "./chain";

// DEFECT FIXTURE — plants: no-op-ceremony (empty handler + a call to a method defined nowhere).

// Wired to the "Hand over to guardian" button — but does nothing.
export const transferAdmin = async () => {};

export async function handover(addr: string) {
  // setPraetor exists on no contract/interface in the tree — the ceremony is a no-op.
  await contract.setPraetor(addr);
}
