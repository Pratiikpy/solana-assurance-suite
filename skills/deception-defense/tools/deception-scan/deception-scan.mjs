#!/usr/bin/env node
// deception-scan — static tripwire for the "deception defect class": code/UI that claims
// success, liveness, or verification it can't back up. Zero-dependency, Node >= 18.
//
//   node deception-scan.mjs <dir>            scan a directory, print findings
//   node deception-scan.mjs <dir> --json     machine-readable output
//
// Detectors (each emits Severity | Pattern | File:line | Evidence | Fix):
//   optimistic-success    a success signal fires after a tx-send with no awaited confirmation
//   hardcoded-status-badge a LIVE/Operational/Verified status word rendered from a literal
//   no-op-ceremony        an admin/transfer/upgrade handler with an empty (or stub) body
//   fabricated-metric     a headline stat ($M / % / users) hardcoded instead of bound to data
//   dead-cta              a button/link with no real handler/route
//   fake-verification     a verified/proof/audit claim with no verify call and no boolean gate
//   mock-as-real          mock/stub/fixture data, or a demo/mock flag, in a runtime path
//
// HONEST SCOPE. This is a regex tripwire for the COMMON SHAPES of these patterns; it favors
// precision over recall. It cannot resolve node_modules, deployed ABIs, or Anchor IDLs, so it
// deliberately does NOT try to prove an external/on-chain method "exists" (that only yields
// false positives) and it will miss idioms it doesn't recognize. A clean scan means "no
// known-shape deception in source," not "the product tells the truth." Pair it with the manual
// review loop in skill/review-loop.md, and treat findings (especially medium) as triage
// candidates, not verdicts. Accuracy numbers in this repo are measured on the bundled fixture
// set only — see examples/planted-deception.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname, sep } from "node:path";

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sol", ".html"]);
const SKIP_DIR = new Set(["node_modules", ".git", "dist", "build", "out", "coverage", ".next", "target", "vendor"]);
const TEST_RE = /(^|[\\/])(__tests__|__mocks__|tests?|spec|e2e|cypress|\.storybook)([\\/]|$)|\.(test|spec|stories)\.[tj]sx?$/i;
const isTest = (f) => TEST_RE.test(f);

function walk(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const name of entries) {
    if (SKIP_DIR.has(name)) continue;
    const full = join(dir, name);
    let st; try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, acc);
    else if (CODE_EXT.has(extname(name))) acc.push(full);
  }
  return acc;
}

// Blank out comments (preserving length + newlines) so prose never matches; keep strings intact.
function maskComments(src) {
  let out = "", i = 0; const n = src.length; let s = null;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (s) { out += c; if (c === "\\") { out += d ?? ""; i += 2; continue; } if (c === s) s = null; i++; continue; }
    if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") { out += " "; i++; } continue; }
    if (c === "/" && d === "*") { out += "  "; i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { out += src[i] === "\n" ? "\n" : " "; i++; } if (i < n) { out += "  "; i += 2; } continue; }
    if (c === '"' || c === "'" || c === "`") { s = c; out += c; i++; continue; }
    out += c; i++;
  }
  return out;
}

const lineOf = (content, idx) => content.slice(0, idx).split("\n").length;
const snippet = (s) => s.replace(/\s+/g, " ").trim().slice(0, 120);

// --- detectors --------------------------------------------------------------

// 1. optimistic-success: success signal after a tx-send with no awaited confirmation between.
const SUCCESS_SIGNAL = /\b(setSuccess\(\s*true|setIsSuccess\(\s*true|set(?:Claimed|Confirmed|Completed|Done|Minted|Submitted|Sent|Paid|Approved)\(\s*true|set(?:Status|State|Phase)\(\s*['"`](?:success|confirmed|done|complete|completed)|toast\.success\(|dispatch\(\s*\{[^}]*type\s*:\s*['"`][^'"`]*(?:success|confirmed|done|complete))/i;
const SEND_CALL = /\b(?:sendTransaction|signAndSend|sendAndConfirm|sendRawTransaction|writeContract)\b|\.rpc\(\s*\)/;
const CONFIRM_GUARD = /\b(?:confirmTransaction|sendAndConfirm|getTransaction|getSignatureStatus|receipt|finaliz|confirm)\b|\.wait\(|\.value\.err|res(?:ponse)?\.ok|status\s*===?\s*(?:1|200|['"`]success)|\berr(?:or)?\b/;
const FN_BOUNDARY = /^\s*(export\s+)?(async\s+)?function\b|=>\s*\{?\s*$|^\s*(export\s+)?const\s+\w+\s*=\s*(async\s*)?\(|^\}\s*$/;

function detectOptimisticSuccess(file, lines, masked) {
  if (isTest(file)) return [];
  const out = [];
  let sentAt = -1, awaited = false;
  for (let i = 0; i < masked.length; i++) {
    const ln = masked[i];
    if (FN_BOUNDARY.test(ln)) { sentAt = -1; awaited = false; }
    const sm = ln.match(SEND_CALL);
    if (sm) { sentAt = i; const rest = ln.slice((sm.index || 0) + sm[0].length); awaited = /\bawait\b/.test(rest) || CONFIRM_GUARD.test(rest); }
    else if (sentAt >= 0 && (/\bawait\b/.test(ln) || CONFIRM_GUARD.test(ln))) awaited = true;
    if (SUCCESS_SIGNAL.test(ln) && sentAt >= 0 && i - sentAt <= 40 && !awaited) {
      out.push({ severity: "high", pattern: "optimistic-success", file, line: i + 1, evidence: snippet(lines[i]),
        fix: "Set success only after an awaited confirmation that checks the result (receipt status / value.err / res.ok). Never paint green on a fire-and-forget send." });
      sentAt = -1;
    }
  }
  return out;
}

// 2. hardcoded-status-badge: a status word rendered from a literal (case-insensitive), not derived.
function detectHardcodedBadge(file, masked, orig) {
  const out = [];
  // liveness words only — "verified"/"audited" are verification claims, handled by fake-verification
  const re = /(?:>\s*|status\s*[:=]\s*|label\s*[:=]\s*|badge\s*[:=]\s*|children\s*[:=]\s*)['"`]?\s*(LIVE|ONLINE|OPERATIONAL|HEALTHY|SECURE|PASSING)\b/gi;
  let m;
  while ((m = re.exec(masked))) {
    const around = masked.slice(Math.max(0, m.index - 40), m.index + m[0].length + 20);
    if (/[?]\s*['"`]/.test(around) || /\{\s*\w+\s*[?&|]/.test(around)) continue; // derived/ternary
    const line = lineOf(masked, m.index);
    out.push({ severity: "high", pattern: "hardcoded-status-badge", file, line, evidence: snippet(orig.split("\n")[line - 1] || m[0]),
      fix: `Derive the status from a check that can fail (status={isLive ? 'LIVE' : 'DOWN'}); a literal "${m[1]}" badge stays green while the system is down.` });
  }
  return out;
}

// 3. no-op-ceremony: an admin/transfer/upgrade handler with an empty or stub body (same file only).
const CEREMONY = "transfer[A-Z]\\w*|upgrade\\w*|migrate\\w*|finalize\\w*|handover|acceptOwnership|renounce\\w*|setAuthority|grantRole|revokeRole|setAdmin|setOwner";
function detectNoOpCeremony(file, masked, orig) {
  const out = [];
  const arrowRe = new RegExp(`\\b(${CEREMONY})\\s*[:=]\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>\\s*\\{\\s*\\}`, "g");
  const fnRe = new RegExp(`\\b(?:async\\s+)?function\\s+(${CEREMONY})\\s*\\([^)]*\\)\\s*(?::\\s*[^\\{]+)?\\{\\s*(?:return\\s+['"\`][^'"\`]*['"\`]\\s*;?\\s*)?\\}`, "g");
  for (const re of [arrowRe, fnRe]) {
    let m;
    while ((m = re.exec(masked))) {
      const line = lineOf(masked, m.index);
      out.push({ severity: "high", pattern: "no-op-ceremony", file, line, evidence: snippet(orig.split("\n")[line - 1] || m[0]),
        fix: "This admin/transfer/upgrade handler has an empty or stub body — wire it to the real call and assert the resulting on-chain state, or remove the control." });
    }
  }
  return out;
}

// 4. fabricated-metric: a headline stat hardcoded in the UI rather than bound to a source.
function detectFabricatedMetric(file, masked, orig) {
  if (extname(file) === ".sol") return [];
  const out = [];
  const jsx = />\s*(\$\s?\d[\d,]*(?:\.\d+)?\s?[KMB]\+?|\$\s?\d{1,3}(?:,\d{3})+|\d[\d,.]*\s?%|\d[\d,.]*\s?[KMB]\+?|\d{2,}[\d,]*\+?\s*(?:users|members|holders|traders|customers|deploys|requests|transactions))\s*</gi;
  const keyed = /\b(value|stat|metric|tvl|volume|count|total|users|holders|reserves)\s*[:=]\s*['"`]\s*(\$?\s?\d[\d,]*(?:\.\d+)?\s?[KMB%]\+?|\$?\d{1,3}(?:,\d{3})+)\s*['"`]/gi;
  for (const re of [jsx, keyed]) {
    let m;
    while ((m = re.exec(masked))) {
      const line = lineOf(masked, m.index);
      out.push({ severity: "medium", pattern: "fabricated-metric", file, line, evidence: snippet((orig.split("\n")[line - 1] || m[0]).trim()),
        fix: "Bind this headline stat to a real source ({tvl}, {userCount}) or label it explicitly illustrative — a hardcoded magnitude reads as live data. (Static prices on a pricing card are a known false positive; triage by reach.)" });
    }
  }
  return out;
}

// 5. dead-cta: a control that goes nowhere.
function detectDeadCta(file, masked, orig) {
  const out = [];
  const pats = [
    [/onClick=\{\s*\(\s*\)\s*=>\s*\{\s*\}\s*\}/g, "onClick is an empty function"],
    [/onClick=\{\s*(?:undefined|null)\s*\}/g, "onClick is undefined/null"],
    [/(?:href|to)=("#"|''|"")/g, 'href/to is "#" or empty'],
    [/(?:href|to)=\{\s*['"`]#?['"`]\s*\}/g, 'href/to is a braced "#"/empty'],
    [/\b(?:on[A-Z]\w*|handle[A-Z]\w*)\s*[:=]\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{\s*console\.(?:log|debug|info)\([^)]*\)\s*;?\s*\}/g, "handler only console.logs (no real action)"],
  ];
  for (const [re, why] of pats) {
    let m;
    while ((m = re.exec(masked))) {
      const line = lineOf(masked, m.index);
      out.push({ severity: "medium", pattern: "dead-cta", file, line, evidence: snippet(orig.split("\n")[line - 1] || m[0]),
        fix: `Dead control: ${why}. Wire a real handler/route or remove it; test every CTA in every state and viewport.` });
    }
  }
  return out;
}

// 6. fake-verification: a verified/proof/audit claim with no verify call AND no boolean gate.
const CLAIM = /\b(proof[\s-]?of[\s-]?reserves|verified\s*[:=]\s*true|isVerified\s*[:=]\s*true|VerifiedBadge|AuditedBadge|"audited"|'audited'|merkle\s*(?:proof|root)\s*verified)\b/gi;
const VERIFY_CALL = /(?:\bverify\w*|\brecompute\w*|\bcheckProof\w*|\bcomputeRoot\w*|\bgetSignatureStatus|\bmerkle\w*verif|\bkeccak\w*|\bsha256|\bblake3)\s*\(|\.verify\s*\(/i;
function detectFakeVerification(file, masked, orig) {
  const out = [];
  let m;
  while ((m = CLAIM.exec(masked))) {
    const ls = masked.lastIndexOf("\n", m.index) + 1;
    const le = masked.indexOf("\n", m.index);
    const lineText = masked.slice(ls, le < 0 ? masked.length : le);
    if (/^\s*import\b/.test(lineText) || /^\s*export\b[^\n]*\bfrom\b/.test(lineText)) continue;      // import of a badge component
    if (/\b(?:function|class)\s+\w*(?:Verified|Audited)\w*Badge|(?:const|let)\s+\w*Badge\s*[:=]/.test(lineText)) continue; // the component's own definition
    const before = masked.slice(Math.max(0, m.index - 60), m.index);
    if (/(?:&&|\?|if\s*\(|\}\s*&&)\s*[\(<{]?\s*$/.test(before) || /\b\w+\s*(?:&&|\?)\s*$/.test(before)) continue; // gated on a boolean → derived
    const window = masked.slice(Math.max(0, m.index - 400), m.index + 400);
    if (!VERIFY_CALL.test(window)) {
      const line = lineOf(masked, m.index);
      out.push({ severity: "high", pattern: "fake-verification", file, line, evidence: snippet(orig.split("\n")[line - 1] || m[0]),
        fix: "A verification/proof claim with no verify/recompute call and no boolean gate near it — recompute and check the proof (or gate the badge on a real check), or drop it." });
    }
  }
  return out;
}

// 7. mock-as-real: mock/stub/fixture data, or a demo/mock flag, in a runtime path.
function detectMockAsReal(file, masked, orig) {
  if (isTest(file)) return [];
  const out = [];
  const importRe = /\b(?:import|require)\b[^;\n]*\b(?:mock|mocks|stub|stubs|fixture|fixtures|dummy|fake|seed)[\w./-]*['"`]/gi;
  let m;
  while ((m = importRe.exec(masked))) {
    const line = lineOf(masked, m.index);
    out.push({ severity: "high", pattern: "mock-as-real", file, line, evidence: snippet(orig.split("\n")[line - 1] || m[0]),
      fix: "Mock/stub/fixture data imported into a runtime path — gate it behind a test-only flag or replace with the real source; render an honest empty state, not fake data." });
  }
  const flagRe = /\b(USE_MOCK|MOCK_DATA|ENABLE_MOCKS|FAKE_DATA|DEMO_MODE)\b\s*=\s*(?:true|1|['"`](?:true|1|on)['"`])/gi;
  while ((m = flagRe.exec(masked))) {
    const line = lineOf(masked, m.index);
    out.push({ severity: "high", pattern: "mock-as-real", file, line, evidence: snippet(orig.split("\n")[line - 1] || m[0]),
      fix: "A mock/demo flag is enabled in shipped code — turn it off or remove it; users will see fabricated data." });
  }
  return out;
}

// --- main -------------------------------------------------------------------
export function scan(root) {
  const files = walk(root);
  const findings = [];
  for (const f of files) {
    let content; try { content = readFileSync(f, "utf8"); } catch { continue; }
    const masked = maskComments(content);
    const lines = content.split("\n");
    const maskedLines = masked.split("\n");
    const rel = relative(root, f).split(sep).join("/");
    findings.push(
      ...detectOptimisticSuccess(rel, lines, maskedLines),
      ...detectHardcodedBadge(rel, masked, content),
      ...detectNoOpCeremony(rel, masked, content),
      ...detectFabricatedMetric(rel, masked, content),
      ...detectDeadCta(rel, masked, content),
      ...detectFakeVerification(rel, masked, content),
      ...detectMockAsReal(rel, masked, content),
    );
  }
  findings.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  return findings;
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("deception-scan.mjs");
if (isMain) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const root = args.find((a) => !a.startsWith("--")) || ".";
  const findings = scan(root);
  if (json) { console.log(JSON.stringify(findings, null, 2)); process.exit(0); }
  const C = { high: "\x1b[31m", medium: "\x1b[33m", reset: "\x1b[0m", dim: "\x1b[2m" };
  if (!findings.length) { console.log("deception-scan: no known-shape deception found (not a guarantee — see review-loop.md)."); process.exit(0); }
  console.log(`deception-scan: ${findings.length} finding(s)\n`);
  for (const f of findings) {
    console.log(`${C[f.severity] || ""}[${f.severity}] ${f.pattern}${C.reset}  ${f.file}:${f.line}`);
    console.log(`  ${C.dim}${f.evidence}${C.reset}`);
    console.log(`  → ${f.fix}\n`);
  }
  const by = {};
  for (const f of findings) by[f.pattern] = (by[f.pattern] || 0) + 1;
  console.log("by pattern:", Object.entries(by).map(([k, v]) => `${k}=${v}`).join("  "));
}
