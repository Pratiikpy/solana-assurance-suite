import { contract } from "./chain";

// CLEAN CONTROL — a non-empty handler calling a method that actually exists. ZERO findings.
async function setGuardian(addr: string) {
  await contract.updateGuardian(addr);
}

export const transferAdmin = async (addr: string) => {
  await setGuardian(addr);
};
