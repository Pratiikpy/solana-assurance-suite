// CLEAN CONTROL — real data source, no mock flag. ZERO findings.
import { fetchPositions } from "./api";

export async function getPositions() {
  return await fetchPositions();
}
