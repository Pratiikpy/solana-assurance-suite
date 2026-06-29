# deception-defense rules

Enforceable review rules. Each maps to a scanner pattern and is phrased as a hard gate.

1. **Success is earned, not assumed.** Success/confirmed state may be set only inside an awaited-confirmation branch that checked the result (`value.err` / receipt status / `res.ok`). Never set success before or alongside the send. → `optimistic-success`
2. **A status badge must be able to go red.** Any `LIVE`/`Operational`/`Healthy`/`Verified` indicator is derived from a check that can fail. No literal status words rendered as status. → `hardcoded-status-badge`
3. **No ceremony without an effect.** Every admin/transfer/upgrade/migrate control runs a non-empty, non-stub handler and asserts the resulting on-chain state before claiming success. (The scanner flags same-file empty/stub ceremony handlers; whether an external call hits a real method is a manual-review check it can't make.) → `no-op-ceremony`
4. **Every number traces to a source.** Displayed stats are bound to an on-chain read, indexer, or API — or labeled explicitly illustrative. No hardcoded headline metrics. → `fabricated-metric`
5. **No dead controls.** Every button/link has a real handler or route, verified in every state and viewport (including mobile and post-error). No `onClick={() => {}}`, no `href="#"`. → `dead-cta`
6. **A "verified" badge requires a verification.** A proof/audit/verified indicator renders only when a real verify/recompute/check call has run and passed near it. If it can't be verified, it isn't badged. → `fake-verification`
7. **Mocks never ship as real.** No mock/stub/fixture import in a runtime path; no `USE_MOCK`-style flag enabled in shipped code. Render honest empty/pending states instead of fabricated data. → `mock-as-real`

**Gate.** A release blocks on any high-severity finding (rules 1, 2, 3, 6, 7). Medium findings (4, 5) are warnings that must be triaged by reach before launch.

**Definition of "not lying."** A success/liveness/verification claim ships only when it is derived from a real check that can fail, traced to ground truth via the source-of-truth hierarchy. Anything else is a deception defect.
