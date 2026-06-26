#!/usr/bin/env node
// sas-verify — the hardened verification logic for a Solana Attestation Service (SAS)
// attestation, as pure testable code. These are the checks whose ABSENCE lets a naive
// integrator be fooled by a spoofed, expired, revoked, or wrong-subject attestation.
// Zero dependencies. Model of the on-chain/off-chain verify path; wire it to the real
// fetched account per ../../skill/verification.md.

export const SAS_PROGRAM_ID = "22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG";

// An attestation record, as reconstructed from a fetched SAS-owned account:
//   { owner, credential, schema, subject, issuer, data, expiry (unix s, 0 = none), revoked }
// `expected` is what the verifier REQUIRES: { credential, schema, subject?, issuer? }
export function verifyAttestation(att, expected, nowUnix) {
  if (typeof nowUnix !== "number") throw new TypeError("nowUnix (unix seconds) is required — never trust wall clock implicitly");
  const reasons = [];

  // 1. The account must be OWNED by the SAS program. Skipping this is the #1 footgun:
  //    an attacker hands you a look-alike account they own with forged fields.
  if (att.owner !== SAS_PROGRAM_ID) reasons.push("account owner is not the SAS program (spoofed account)");

  // 2. The credential authority must be the one you trust (not attacker-controlled).
  if (att.credential !== expected.credential) reasons.push("credential authority mismatch");

  // 3. The schema must match exactly (wrong schema = different meaning).
  if (att.schema !== expected.schema) reasons.push("schema mismatch");

  // 4. If you care who it's about, bind the subject (stops attestation reuse).
  if (expected.subject !== undefined && att.subject !== expected.subject) reasons.push("subject mismatch (attestation reuse)");

  // 5. Revocation must be honored.
  if (att.revoked) reasons.push("attestation revoked");

  // 6. Expiry must be enforced (expiry 0 = non-expiring).
  if (att.expiry && att.expiry !== 0 && nowUnix > att.expiry) reasons.push("attestation expired");

  // 7. The issuer must be an authorized signer of the credential (if you pin one).
  if (expected.issuer !== undefined && att.issuer !== expected.issuer) reasons.push("issuer is not an authorized signer");

  return { valid: reasons.length === 0, reasons };
}

// CLI: node verify.mjs <attestation.json> <expected.json> [--now <unix>]
if (process.argv[1]?.endsWith("verify.mjs")) {
  const [attFile, expFile] = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  if (!attFile || !expFile) { console.error("usage: node verify.mjs <attestation.json> <expected.json> [--now <unix>]"); process.exit(1); }
  const fs = await import("node:fs");
  const nowIdx = process.argv.indexOf("--now");
  const now = nowIdx >= 0 ? Number(process.argv[nowIdx + 1]) : Math.floor(Date.now() / 1000);
  const att = JSON.parse(fs.readFileSync(attFile, "utf8"));
  const exp = JSON.parse(fs.readFileSync(expFile, "utf8"));
  const r = verifyAttestation(att, exp, now);
  console.log(r.valid ? "VALID ✅" : `INVALID ❌ — ${r.reasons.join("; ")}`);
  process.exit(r.valid ? 0 : 1);
}
