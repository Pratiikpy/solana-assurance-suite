# The deception defect catalog

Seven patterns, each a way the product claims something it can't back up. For each: what it is, why it survives review, the tell the scanner keys on, the web3/Solana instance, and the fix. The unifying rule is at the bottom.

---

## 1. optimistic-success

**The lie.** Success state is set before — or independent of — the awaited confirmation, so the UI paints green on a write that actually reverted, dropped, or 4xx'd.

**Why it survives.** On the happy path it looks perfect; the bug only shows when the write fails, which rarely happens in a quick demo — so it ships constantly.

**Tell.** A success signal (`setSuccess(true)`, `setStatus('confirmed')`, `toast.success(...)`) that fires after a send/fetch but with no confirmation+error check between them (`confirmTransaction`, `.wait()`, `receipt`, `res.ok`, `value.err`).

**web3 / Solana instance.** `await connection.sendTransaction(tx); setStatus('success')` — never awaits `confirmTransaction` or checks `value.err`, so a failed tx still shows "Deposit confirmed". The batched-`setStatus`-before-confirm bug is the classic one.

**Fix.** Set success only inside the awaited-confirmation branch:
```ts
const sig = await connection.sendTransaction(tx);
const res = await connection.confirmTransaction(sig);
if (res.value.err) { setError(res.value.err); return; }
setSuccess(true);
```

---

## 2. hardcoded-status-badge

**The lie.** A `LIVE` / `Operational` / `Healthy` / `Verified` badge is a string literal, so it stays green even when the system is down.

**Why it survives.** A status badge looks like status. Nobody checks whether it's wired to a real health signal until it lies during an outage.

**Tell.** A status word rendered from a literal (`<span>LIVE</span>`, `status: 'OPERATIONAL'`) rather than from a variable or check.

**web3 / Solana instance.** A network/indexer "LIVE" pill that is hardcoded while the RPC or subgraph is actually stale — exactly the failure that erodes trust during an incident.

**Fix.** Derive it from a check that can fail: `status={isLive ? 'LIVE' : 'DOWN'}`, where `isLive` comes from a real health probe.

---

## 3. no-op-ceremony

**The lie.** An admin / transfer-ownership / upgrade / migrate control runs an empty handler, or calls a method that exists on no contract or interface in the codebase — so the "ceremony" does nothing.

**Why it survives.** Governance and migration paths are rarely exercised end-to-end; the button exists, the toast fires, and nobody confirms the on-chain state actually changed.

**Tell.** An empty or stub-body handler on an admin/transfer/upgrade name (`transferAdmin = async () => {}`, or `function transferAdmin() { return "ok"; }`). The scanner flags *same-file* empty/stub ceremony handlers only — it can't resolve node_modules / ABIs / IDLs, so whether an external `contract.setX(...)` call hits a real method is a manual-review check, not something a static scanner can prove.

**web3 / Solana instance.** A `transfer-admin` script calling a setter that was renamed or never deployed; the admin "hands over" control and nothing moves on-chain.

**Fix.** Wire the handler to the real call, and assert the resulting on-chain state (new owner/authority reads back) before showing success. Remove controls you can't back.

---

## 4. fabricated-metric

**The lie.** A headline stat (`$4.2M TVL`, `12,400 users`, `99.9%`) is typed into the UI as a literal, not bound to a data source, so it reads as live data and isn't.

**Why it survives.** Placeholder numbers from a design mockup get shipped as real. They look authoritative and nobody traces them to a source.

**Tell.** A `$`/`%`/`K`/`M`/`users`-style number sitting in a JSX/HTML text node as a literal rather than `{tvl}` / `{count}`.

**web3 / Solana instance.** A landing page with hardcoded TVL / volume / holder counts that don't come from an RPC read or indexer — a "trust us" number with nothing behind it.

**Fix.** Bind every displayed number to its source (an on-chain read, an indexer, an API), or label it explicitly illustrative. Flag unsourced headline numbers for triage. (Static prices on a pricing card are a known false-positive shape — triage by reach.)

---

## 5. dead-cta

**The lie.** A button or link the user can press goes nowhere — empty handler, `href="#"`, empty route.

**Why it survives.** It renders fine and is often only dead in one state (mobile, disconnected, post-error). A dead mobile CTA can be served to 100% of mobile users and never noticed on a desktop demo.

**Tell.** `onClick={() => {}}`, `onClick={undefined}`, `href="#"`/`href=""`, `to=""`.

**Fix.** Wire a real handler/route or remove the control. Test every CTA in every state and viewport, not just desktop happy-path.

---

## 6. fake-verification

**The lie.** A "Verified" / "Audited" / proof-of-reserves badge is shown with no verification actually performed — the Merkle root is never recomputed, the signature never checked.

**Why it survives.** A verified badge is the highest-trust element on a page, and the absence of a verify call is invisible unless you look for it — which is what makes it so damaging.

**Tell.** A verification claim (`VerifiedBadge`, `verified: true`, `Proof of Reserves`, `"audited"`) with no verify/recompute/check call (`verify…()`, `recompute()`, `checkProof()`, `keccak/sha256`, `.verify()`) near it **and** no boolean gate deriving it (`verified ? …`, `{proofOk && <Badge/>}`). A claim gated on a real check, or a pure presentational badge component, is not flagged.

**web3 / Solana instance.** A proof-of-reserves widget that displays a "verified" badge but never recomputes the Merkle root from leaves, or an attestation badge that never calls the verifier.

**Fix.** Recompute and check the proof at render (or gate the badge on the check's result): `const ok = await verifyMerkleRoot(root); … {ok && <VerifiedBadge/>}`. If you can't verify it, don't badge it.

---

## 7. mock-as-real

**The lie.** Mock / stub / fixture data is wired into a runtime (non-test) path, or a `USE_MOCK` flag is left enabled in shipped code — so users see fabricated data presented as real.

**Why it survives.** Mocks are added to unblock frontend work and never removed; the toggle defaults on and ships.

**Tell.** An `import … from '…/mocks/…'` (or `stub`/`fixture`/`dummy`/`fake`/`sample`) in a non-test file, or `USE_MOCK = true` / `MOCK_DATA` used in a render path.

**Fix.** Gate mocks behind a test-only flag that cannot be enabled in production, and replace runtime mocks with the real source before shipping. Render an honest empty/pending state rather than fake data.

---

## The unifying rule

Every one of these is the same defect seen from a different angle: **a claim of success, liveness, or verification that is not derived from a real check that can fail.** If the badge can't go red, the number isn't bound, the button has no handler, the proof is never recomputed, or the data is a fixture — the product is lying, and a judge or user will be the one to find out. Catch it first.
