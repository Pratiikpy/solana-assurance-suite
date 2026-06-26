# L6 — Security / Secrets

The supply-chain-and-secrets layer. Two complementary scanners on every push/PR: **gitleaks** over the full history (entropy + rule-based, catches the broad class), and a **context-aware `git grep` backstop** that hard-fails on a raw secret-key literal committed in a key context (catches the specific leak gitleaks' default rules missed). Both are hard gates — any finding blocks the release. Born from a real incident, hardened so the same leak can never recur silently.

Grounded in the `secrets-scan` job of `.github/workflows/ci.yml` and `.gitleaksignore` from the source repo.

## What the real job does

```yaml
# .github/workflows/ci.yml — secrets-scan job
  secrets-scan:
    name: Secrets scan (gitleaks)
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7
        with: { fetch-depth: 0 }          # full history — gitleaks sweeps every commit
      - uses: gitleaks/gitleaks-action@83373cf2f8c4db6e24b41c1a9b086bb9619e9cd3 # v2.3.7
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      # Incident 2026-05-24 follow-up: required backstop to gitleaks, fail if a raw
      # private-key literal is committed in a key context (the leak was
      # `--private-key 0x<64hex>` on a cast / cargo-stylus command line). Context-aware
      # so it does NOT false-fail on tx/block hashes, topic0, or Pyth feed ids
      # (also 0x+64hex). Known public test keys live only in test/seed/.env.example,
      # which are path-excluded.
      - name: No raw private keys in tracked source
        run: |
          PATTERN='(--private-key[ =]+0x[0-9a-fA-F]{64})|([A-Za-z_]*(PRIVATE_?KEY|DEPLOYER_?KEY|SECRET|MNEMONIC)[A-Za-z_]*[ =:]{1,3}.{0,2}0x[0-9a-fA-F]{64})'
          if git grep -nIiE "$PATTERN" -- \
              ':!**/*test*' ':!**/*.t.sol' ':!scripts/seed.s.sol' \
              ':!.env.example' ':!resources/**'; then
            echo "::error::Possible raw private key committed to source (see incidents/2026-05-24-...). Move it to an env var / keystore and rotate the key."
            exit 1
          fi
          echo "OK: no raw private-key literals in tracked source."
```

Design points, all load-bearing:
- **`gitleaks-action` is SHA-pinned** (`@83373cf2…` # v2.3.7), not `@v2`. A mutable tag means an attacker who compromises the action's repo runs arbitrary code in your secrets-scan job. Pin the commit. (Same discipline applies to every `uses:` in the file — see [ci-wiring.md](ci-wiring.md).)
- **`fetch-depth: 0`** — gitleaks scans the **whole history**, not just the diff. A secret committed and "removed" three months ago is still in the git objects and still leaked; shallow clone would miss it.
- **`permissions: contents: read`**, `timeout-minutes: 5` — least privilege, fast fail.
- **The backstop is a separate hard step**, not a gitleaks rule. Gitleaks is general; the backstop is a targeted assertion about *this* codebase's known footgun. Defense in depth: if gitleaks' rules drift or a finding gets allowlisted too broadly, the backstop still fires.

### The post-incident hardening pattern

The backstop exists because of a real leak: a deployer private key landed in a local temp log as `--private-key 0x<64hex>` on a `cast`/`cargo-stylus` command line — a shape gitleaks' generic high-entropy rules didn't catch in that context. The follow-up wasn't "be more careful." It was **encode the specific failure as a permanent, named CI gate**:

1. **Rotate** the leaked key immediately (assume compromised the instant it touches a log).
2. **Add a backstop test that fails on the exact leaked shape** — a regression test for the incident.
3. **Make it context-aware** so it stays green on benign look-alikes (tx/block hashes, `topic0`, Pyth feed ids are all `0x`+64hex too) — a noisy gate that cries wolf gets disabled, which is worse than no gate.
4. **Leave the incident reference in the code** (`see incidents/2026-05-24-...`) so the *why* survives.

That is the pattern: every confirmed leak becomes a named, dated, context-aware CI assertion that makes the same leak impossible to reintroduce quietly.

### `.gitleaksignore` — narrow, fingerprinted, justified

```ini
# .gitleaksignore
# gitleaks --log-opts="--all" sweeps every commit including .env.example. The
# Hardhat default-account private key ships as a known public test fixture (it
# appears verbatim in the Hardhat docs + every tutorial), so flagging it as a
# secret is a false positive. Carved out here so the gitleaks job stays green and
# a real secret leak is not buried in noise.
#
# Format: one fingerprint per line. Generate with:
#   gitleaks detect --report-format=csv --report-path=- --no-banner
# then copy the colon-prefixed fingerprint of any confirmed false positive.

# .env.example:13, Hardhat account #0 default private key (public).
.env.example:generic-api-key:13
```

The rule for allowlisting: ignore by **specific fingerprint** (`file:rule:line`), never by a broad path or rule glob, and **only after confirming the finding is a genuine public test fixture**. Each line carries a comment saying what it is and why it's safe. A `.gitleaksignore` that ignores `**/*.env` or a whole rule is how a real secret hides in plain sight.

## Solana mapping: the backstop catches Solana key shapes, not EVM hex

The EVM backstop matches `0x<64hex>`. Solana keys do not look like that. **Rewrite the regex** for the Solana key footprint — there are four distinct shapes:

1. **`id.json` / byte-array secret key** — `solana-keygen` writes a 64-element `u8` array. This is the canonical Solana key leak: someone commits a keypair file.
2. **`[u8; 64]` literal in source** — the same byte array inlined into a `.ts`/`.rs`/`.json` file.
3. **`Keypair.fromSecretKey(...)` with a literal** — a hardcoded secret passed to the web3.js constructor.
4. **base58 secret key** — a Phantom-exported / `bs58`-encoded 64-byte secret, an 87–88 char base58 string. (Note: 32-byte base58 *public* keys are 43–44 chars and everywhere — do **not** match those, or the gate is pure noise.)

```bash
# Solana raw-key backstop — drop-in replacement for the EVM step.
- name: No raw Solana keypairs in tracked source
  run: |
    set -euo pipefail
    # 1) id.json / inline byte-array secret key: 64 comma-separated 0-255 ints.
    #    (a real secretKey is 64 bytes; allow whitespace/newlines between ints)
    ARRAY='\[[[:space:]]*([0-9]{1,3}[[:space:]]*,[[:space:]]*){63}[0-9]{1,3}[[:space:]]*\]'
    # 2) fromSecretKey with a literal array or bs58 string
    FROMSECRET='fromSecretKey[[:space:]]*\('
    # 3) base58 secret key: 87-88 base58 chars (NOT the 43-44 of a pubkey)
    BS58SECRET='[1-9A-HJ-NP-Za-km-z]{87,88}'

    HITS=0
    for PAT in "$ARRAY" "$FROMSECRET" "$BS58SECRET"; do
      if git grep -nIE "$PAT" -- \
          ':!**/*test*' ':!**/*.test.*' ':!**/fixtures/**' \
          ':!.env.example' ':!**/idl/*.json' ':!**/*.idl.json' \
          ':!**/target/idl/**' ':!resources/**'; then
        HITS=1
      fi
    done
    if [ "$HITS" -eq 1 ]; then
      echo "::error::Possible Solana keypair (id.json byte-array / fromSecretKey literal / base58 secret) in tracked source. Move it to a keystore / env var and ROTATE the key immediately."
      exit 1
    fi
    echo "OK: no raw Solana keypair literals in tracked source."
```

Path exclusions matter as much as the regex. Exclude test fixtures, `.env.example`, and crucially **Anchor IDL JSON** (`target/idl/*.json`, `*.idl.json`) — an IDL's account/instruction discriminator arrays are short `[u8]` arrays that can trip a loose byte-array pattern. Tune the array pattern to require exactly 64 ints so it only matches a full secret key, not a 32-byte seed or an 8-byte discriminator. As with EVM, only public, fund-less test keypairs belong in the path-excluded fixtures, and each goes in `.gitleaksignore` by fingerprint.

### Add `cargo-audit` for the program crate

gitleaks finds secrets; it does not find a vulnerable dependency. For the Rust program, add an advisory-DB scan of the dependency tree — the supply-chain analog to secret scanning:

```yaml
  cargo-audit:
    name: Rust dep advisories (cargo-audit)
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7
      - uses: actions-rust-lang/setup-rust-toolchain@b113a30d27a8e59c969077c0a0168cc13dab5ffc # v1.8.0
      - run: cargo install --locked cargo-audit
      # Fails on any RUSTSEC advisory in Cargo.lock. Use --ignore RUSTSEC-XXXX-NNNN
      # ONLY with a dated comment + tracking issue, never a blanket ignore.
      - run: cargo audit --deny warnings
```

### Program supply chain: `anchor verify` / verifiable builds

Secret scanning protects the repo; **verifiable builds** protect what's actually on-chain. The deployed program bytecode should be reproducible from the committed source. Anchor's verifiable build pins the toolchain in a Docker image so the build is deterministic, and `anchor verify` checks that the on-chain program hash matches a build of the source:

```bash
# Deterministic, reproducible build — same bytecode hash anyone can reproduce.
anchor build --verifiable

# Assert the on-chain program matches this source (run in CI against the
# deployed program id; fails if the on-chain hash diverges from the source build).
anchor verify -p <program_name> <PROGRAM_ID> --provider.cluster mainnet
```

A divergence here is the on-chain analog of a secret leak: the running program is **not** the audited source. Treat a verify mismatch as a hard release blocker. (The publicly verifiable equivalent is `solana-verify` against OtterSec's registry; pick one and gate on it.)

## Checklist

- [ ] `gitleaks-action` SHA-pinned (not `@v2`); `fetch-depth: 0` for full-history scan; `permissions: contents: read`.
- [ ] Context-aware raw-key backstop as a **separate hard step**, regex rewritten for Solana: `id.json`/`[u8;64]` byte-arrays, `Keypair.fromSecretKey` literals, **87–88-char** base58 secrets (never 43–44-char pubkeys).
- [ ] Path-exclude test fixtures, `.env.example`, and **Anchor IDL JSON**; require exactly 64 ints in the byte-array pattern.
- [ ] `.gitleaksignore` allowlists by **fingerprint** (`file:rule:line`) only, each with a justification comment; only public/fund-less test keys.
- [ ] Post-incident pattern: rotate → encode the exact leaked shape as a named, dated, context-aware backstop → keep the incident reference in code.
- [ ] `cargo-audit --deny warnings` on the program crate's deps (`--ignore` only with a dated TODO + issue).
- [ ] `anchor build --verifiable` + `anchor verify` (or `solana-verify`) — on-chain bytecode reproducible from source; mismatch = hard block.

See also: [release-gate.md](release-gate.md) · [model.md](model.md) · [ci-wiring.md](ci-wiring.md)

_Last verified: June 2026_
