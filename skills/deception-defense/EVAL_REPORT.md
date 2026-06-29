# EVAL_REPORT — deception-defense

Principle: evidence over claims. The scanner's accuracy is measured, not asserted.

## Proof

`examples/planted-deception` is a fixture app with all seven deception patterns planted in four
defect files, alongside four clean control files that are the *correct* version of the same code.
`verify.mjs` runs the scanner over the fixtures and scores it against `expected.json`.

| Command | Result |
|---------|--------|
| `( cd examples/planted-deception && node verify.mjs )` | **4/4 tests pass** |

```
planted defect classes : 7
precision=1.000  recall=1.000  FP=0
raw findings: 14 across 4 files
  - dead-cta: 2        - fabricated-metric: 2   - fake-verification: 3
  - hardcoded-status-badge: 2   - mock-as-real: 2   - no-op-ceremony: 2
  - optimistic-success: 1
```

What this proves:

- **Recall 1.000** — every one of the seven planted deception classes is caught.
- **Precision 1.000 / FP 0** — the four clean control files (the correct versions: success set after the confirmation check, status derived from a real check, verified badge gated on a recomputed proof, a non-empty handler calling a defined method, a real data source) produce **zero** findings. A deception report nobody trusts is worthless, so precision is the headline metric.

## Honest limits

- The scanner is **static**. It cannot see a fake-success that only manifests at runtime (a tx that reverts and paints green), a badge wired to a check that itself lies, or a metric bound to a source returning garbage. Those need the live ACT/OBSERVE/AUDIT loop in `skill/review-loop.md`. A clean scan means "no known-shape deception in source," not "the product tells the truth."
- Precision/recall are measured **on the planted fixture set** (the seven pattern shapes). They are the scanner's score on those shapes, not a universal guarantee; an unrecognized idiom can evade it. New project-specific deceptions should be added as a detector plus a planted fixture + clean control, then re-scored to keep precision at 1.000.
- The scanner caught a real bug in its own first version (a verify-call regex that rejected camelCase `verifyMerkleRoot` and matched import lines), which the clean-control gate surfaced before this report — the proof did its job.

## Adversarial verification (second-opinion pass)

After the first version passed its own fixture proof, a red-team pass attacked it on a *separate* corpus of idiomatic code — the same discipline applied to the suite's audits: don't trust a green self-test, try to break it.

It surfaced two real problems, both fixed:

- **False positives on correct code** — the call-side "method defined nowhere" check fired on `localStorage.setItem`, `this.setState`, `element.setAttribute`, and on genuine external/on-chain calls (`transferOwnership`, Anchor `setAuthority`) because a static scanner can't see node_modules / ABIs / IDLs; default no-op props (`onClose = () => {}`) tripped the empty-handler rule; a read-only `fetch` + `setStatus('done')` and helper-wrapped confirmations tripped optimistic-success; standard presentational-component splits tripped fake-verification; audio `samples/` imports tripped mock-as-real; static prices tripped fabricated-metric. **Fix:** dropped the structurally-impossible defined-nowhere check, restricted no-op to same-file empty/stub ceremony handlers, narrowed tx-send detection (no bare `fetch`), added comment-masking, made fake-verification gate-aware, and tightened fabricated-metric to magnitudes.
- **Evasions of common idioms** — Redux/dispatch and domain-named success setters, mixed-case `Operational`/`Live` badges (a case-sensitivity bug), stats in arrays/template literals, braced `href={"#"}`, `DEMO_MODE`, and empty *function-declaration* handlers all slipped through. **Fix:** broadened the success/mock/flag signals, made the badge match case-insensitive, added a metric-keyed-literal pass, the braced/`"#"` CTA forms, and a function-declaration arm.

Result, on a fresh corpus replicating those cases: the **16 false-positive cases now produce 0 findings**, the **6 common evasions are caught**, and the planted proof stays **precision 1.000 / recall 1.000 / FP 0**. The headline accuracy numbers are the score on the bundled shapes, not a guarantee on arbitrary code — cross-module / on-chain existence and static-vs-live distinctions still need the manual review loop.

## Reproduce

```bash
cd skills/deception-defense/examples/planted-deception
node verify.mjs
```

Node >= 18, zero dependencies.
