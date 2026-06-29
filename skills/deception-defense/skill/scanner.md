# The static scanner

`tools/deception-scan/deception-scan.mjs` is a zero-dependency Node (>= 18) scanner that flags the seven deception patterns across a codebase, each with file:line evidence and a fix. It is conservative by design — it favors precision over recall, because a deception report nobody trusts is worthless.

## Run it

```bash
# human-readable
node tools/deception-scan/deception-scan.mjs <path-to-app>

# machine-readable (for CI / further processing)
node tools/deception-scan/deception-scan.mjs <path-to-app> --json
```

It scans `.ts .tsx .js .jsx .mjs .cjs .sol .html`, skips `node_modules`, build output, and (for the runtime-only patterns) test directories.

## Read the output

Each finding is `Severity | Pattern | file:line | evidence | fix`. Severities:

- **high** — a claim a user or judge will act on: optimistic-success, hardcoded-status-badge, fake-verification, no-op-ceremony, mock-as-real.
- **medium** — fabricated-metric, dead-cta.

Triage by reach: a defect on a money path or a verified badge outranks one on an internal page.

## CI gate

Fail the build when high-severity deceptions appear:

```bash
COUNT=$(node tools/deception-scan/deception-scan.mjs ./src --json | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const a=JSON.parse(d);process.stdout.write(String(a.filter(f=>f.severity==="high").length))})')
if [ "$COUNT" -gt 0 ]; then echo "deception-scan: $COUNT high-severity deception(s) — blocked"; exit 1; fi
```

## Limits (stated honestly)

It is a static scanner. It will not catch a fake-success that only manifests at runtime, a badge wired to a check that itself lies, or a metric bound to a source that returns garbage — those need the live review loop in `review-loop.md`. It can also miss a pattern expressed in an idiom it doesn't recognize; treat a clean scan as "no *known-shape* deception found," not "the product tells the truth." The proof in `examples/planted-deception` measures it on a fixture set (precision 1.000, recall 1.000, FP 0 across the seven planted classes) — that is its score on those shapes, not a universal guarantee.

## Extend it

Each detector is a small function in `deception-scan.mjs` returning `{severity, pattern, file, line, evidence, fix}`. Add a project-specific deception (e.g. a house-specific "fake live" idiom) by adding a detector and a planted fixture + clean control in `examples/planted-deception`, then re-run `node verify.mjs` to keep precision at 1.000.
