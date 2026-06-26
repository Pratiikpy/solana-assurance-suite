import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyAttestation, SAS_PROGRAM_ID } from "../../tools/sas-verify/verify.mjs";

const NOW = 1_750_000_000; // fixed clock for deterministic tests

// A valid proof-of-human attestation and what a verifier requires of it.
const valid = {
  owner: SAS_PROGRAM_ID,
  credential: "CRED_humanity_authority",
  schema: "SCHEMA_proof_of_human_v1",
  subject: "Wa11et1111111111111111111111111111111111111",
  issuer: "ISSUER_authorized_signer",
  data: { human: true },
  expiry: NOW + 86_400, // valid for another day
  revoked: false,
};
const expected = {
  credential: "CRED_humanity_authority",
  schema: "SCHEMA_proof_of_human_v1",
  subject: "Wa11et1111111111111111111111111111111111111",
  issuer: "ISSUER_authorized_signer",
};

test("valid attestation passes every check", () => {
  const r = verifyAttestation(valid, expected, NOW);
  assert.equal(r.valid, true, r.reasons.join("; "));
});

test("spoofed account (owner != SAS program) is rejected", () => {
  const r = verifyAttestation({ ...valid, owner: "AttackerOwnedProgram111111111111111111111" }, expected, NOW);
  assert.equal(r.valid, false);
  assert.match(r.reasons.join(), /owner is not the SAS program/);
});

test("wrong credential authority is rejected", () => {
  const r = verifyAttestation({ ...valid, credential: "CRED_attacker" }, expected, NOW);
  assert.equal(r.valid, false);
  assert.match(r.reasons.join(), /credential authority mismatch/);
});

test("schema mismatch is rejected", () => {
  const r = verifyAttestation({ ...valid, schema: "SCHEMA_kyc_v1" }, expected, NOW);
  assert.equal(r.valid, false);
  assert.match(r.reasons.join(), /schema mismatch/);
});

test("attestation about a different subject (reuse) is rejected", () => {
  const r = verifyAttestation({ ...valid, subject: "SomeOtherWallet22222222222222222222222222" }, expected, NOW);
  assert.equal(r.valid, false);
  assert.match(r.reasons.join(), /subject mismatch/);
});

test("revoked attestation is rejected", () => {
  const r = verifyAttestation({ ...valid, revoked: true }, expected, NOW);
  assert.equal(r.valid, false);
  assert.match(r.reasons.join(), /revoked/);
});

test("expired attestation is rejected", () => {
  const r = verifyAttestation({ ...valid, expiry: NOW - 1 }, expected, NOW);
  assert.equal(r.valid, false);
  assert.match(r.reasons.join(), /expired/);
});

test("unauthorized issuer is rejected", () => {
  const r = verifyAttestation({ ...valid, issuer: "ISSUER_not_authorized" }, expected, NOW);
  assert.equal(r.valid, false);
  assert.match(r.reasons.join(), /issuer is not an authorized signer/);
});

test("non-expiring attestation (expiry 0) is accepted when otherwise valid", () => {
  const r = verifyAttestation({ ...valid, expiry: 0 }, expected, NOW);
  assert.equal(r.valid, true, r.reasons.join("; "));
});
