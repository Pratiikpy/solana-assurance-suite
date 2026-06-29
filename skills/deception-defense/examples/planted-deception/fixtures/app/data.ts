// DEFECT FIXTURE — plants: mock-as-real (mock import into a runtime path + a shipped mock flag).
import { positions } from "./mocks/positions";

export const USE_MOCK = true;

export function getPositions() {
  return positions; // mock data rendered as real
}
