---
name: solana-bridge
description: Move value and messages between Solana and other chains, safely. Covers the 2026 cross-chain stack — Circle CCTP v2 (native USDC burn/mint), Wormhole Native Token Transfers (canonical SPL tokens), Wormhole core messaging (arbitrary payloads / VAAs), and deBridge DLN (intent-based liquidity swaps) — with a decision tree for picking the right one and a security spine drawn from the real bridge hacks (Wormhole 2022, Nomad, Ronin). Extends solana-dev-skill: for writing the Solana program and client, delegates to the core skill; this skill owns the cross-chain layer — choosing a bridge, integrating its SDK, and not getting drained doing it.
user-invocable: true
---

# Solana Bridge — Cross-Chain Without Getting Drained

> **Extends**: [solana-dev-skill](../solana-dev/SKILL.md) — core Solana development (programs, client, security). This skill owns the **cross-chain layer**: which bridge, how to integrate it, and how to verify it's safe. For program/client basics it delegates to the core skill; for testing the integration it pairs with the [solana-testing](../solana-testing/SKILL.md) skill.

Bridges are the most-exploited primitive in crypto — Wormhole ($325M), Ronin ($625M), Nomad ($190M) were all bridge or bridge-adjacent. Most Solana builders need to move USDC in, make a token multichain, or accept a cross-chain message, and the choice + the safety checks are non-obvious. This skill makes the agent **pick the right bridge for the goal** and **wire the verification that stops the drain**.

## What This Skill Is For

Use this skill when the user asks for:

### Choosing a bridge (start here)
- "Which bridge should I use?" → [bridge-landscape.md](bridge-landscape.md) — the decision tree

### Moving tokens
- Native **USDC** between Solana and EVM → [cctp.md](cctp.md) (Circle CCTP v2)
- Make **your own SPL token** canonical cross-chain → [wormhole-ntt.md](wormhole-ntt.md) (Native Token Transfers)
- Best-price **swap-and-bridge** / intents → [debridge.md](debridge.md) (deBridge DLN)

### Moving messages
- Arbitrary cross-chain **payloads**, governance, state sync → [messaging.md](messaging.md) (Wormhole core / VAAs)

### Doing it safely & proving it
- Integration code with the unified Wormhole SDK → [integration-patterns.md](integration-patterns.md)
- The security failure modes + pre-deploy checklist → [bridge-security.md](bridge-security.md)
- Testing a cross-chain integration without burning funds → [testing-bridges.md](testing-bridges.md)

### Delegate to the core skill
- Writing the Solana program / client → [programs/anchor.md](../solana-dev/references/programs/anchor.md), [kit/overview.md](../solana-dev/references/kit/overview.md)
- Static security review of your own program → core `security.md`

## Default Stack Decisions (Opinionated, June 2026)

1. **Native USDC → CCTP v2** (live on Solana, domain `5`). Burn-and-mint, no wrapped asset, Circle-issued. The cleanest path for USDC.
2. **Your SPL token cross-chain → Wormhole NTT** (`@wormhole-foundation/sdk-*-ntt` 7.2.x). Canonical token, rate-limited, pausable.
3. **Arbitrary message → Wormhole core messaging** (VAAs + Guardians).
4. **Swap across chains / no wrapped asset → deBridge DLN** (intent/solver, market rate).
5. **SDK → `@wormhole-foundation/sdk` 6.1.x.** App-side Solana instructions use `@solana/kit` 6.x; note the Wormhole SDK still wraps `@solana/web3.js` 1.x internally — see the adapter note in [integration-patterns.md](integration-patterns.md).
6. **Never mint/release before required finality.** Verify attestations/VAAs, track consumed messages, allowlist emitters. Always.

> Program IDs, domain IDs, and SDK versions drift and differ by cluster. [resources.md](resources.md) pins the June-2026 values; **confirm from official docs before mainnet**.

## Operating Procedure

### 1. Classify the cross-chain task
| Goal | Bridge | Skill file |
|------|--------|------------|
| Move native USDC | CCTP v2 | [cctp.md](cctp.md) |
| Make my SPL token multichain | Wormhole NTT | [wormhole-ntt.md](wormhole-ntt.md) |
| Send an arbitrary payload | Wormhole messaging | [messaging.md](messaging.md) |
| Swap asset A→B across chains | deBridge DLN | [debridge.md](debridge.md) |
| Not sure | — | [bridge-landscape.md](bridge-landscape.md) |

### 2. Pick the right agent
| Task | Agent | Model |
|------|-------|-------|
| Choose + integrate a bridge | **bridge-engineer** | sonnet |
| Audit an integration for drain risk | **bridge-security-reviewer** | opus |

### 3. Integrate with the async lifecycle in mind
Every bridge is async and multi-minute: **initiate → attestation/VAA → redeem**. Build idempotent retries and store the transfer handle so a crashed process can resume. See [integration-patterns.md](integration-patterns.md).

### 4. Verify before value moves
Run [bridge-security.md](bridge-security.md): signature/attestation verification, replay tracking, finality before mint, rate-limits/pause, emitter allowlist, decimal normalization. Each item maps to a hack that happened.

### 5. Test the malicious path
Write the forged/replayed-VAA test before shipping — [testing-bridges.md](testing-bridges.md) (pairs with the [solana-testing](../solana-testing/SKILL.md) skill).

---

## Progressive Disclosure (Read When Needed)

### Choose
- [bridge-landscape.md](bridge-landscape.md) — decision tree, trust models, wrapped vs canonical vs native

### Integrate
- [cctp.md](cctp.md) — native USDC burn/mint, Iris attestation, domains
- [wormhole-ntt.md](wormhole-ntt.md) — Native Token Transfers, manager + transceivers, rate limits
- [messaging.md](messaging.md) — VAAs, Guardians, emit/consume a payload
- [debridge.md](debridge.md) — DLN intents, solver fills, quotes
- [integration-patterns.md](integration-patterns.md) — unified Wormhole SDK, lifecycle, retries

### Secure & test
- [bridge-security.md](bridge-security.md) — failure modes + pre-deploy checklist
- [testing-bridges.md](testing-bridges.md) — testnet, mainnet-fork, mock attestations, malicious-VAA tests
- [resources.md](resources.md) — pinned versions, program IDs, domains, docs

### Core Solana Dev Skills (from solana-dev-skill)
> Provided by [solana-dev-skill](../solana-dev/SKILL.md) — install if not present.
- [programs/anchor.md](../solana-dev/references/programs/anchor.md) — writing the program
- [kit/overview.md](../solana-dev/references/kit/overview.md) — `@solana/kit` client
- [security.md](../solana-dev/references/security.md) — program-side static checks

---

## Task Routing Guide

| User asks about... | Primary skill file(s) |
|--------------------|----------------------|
| which bridge / wrapped vs native | bridge-landscape.md |
| bridge USDC, Circle, CCTP | cctp.md |
| make my token multichain, NTT | wormhole-ntt.md |
| cross-chain message, VAA, governance | messaging.md |
| swap and bridge, deBridge, intents | debridge.md |
| SDK code, transfer lifecycle, retries | integration-patterns.md |
| is my bridge integration safe | bridge-security.md |
| test the bridge, mock VAA | testing-bridges.md → [solana-testing](../solana-testing/SKILL.md) |
| program IDs, domains, versions | resources.md |
| **writing the Solana program** | solana-dev → programs/anchor.md |

---

## Commands

| Command | Description |
|---------|-------------|
| `/add-bridge` | Pick the bridge for the goal, scaffold the transfer integration (CCTP / NTT / deBridge) with attestation polling + retries |
| `/bridge-security-check` | Run the pre-integration security checklist; report pass/fail per item with the hack it prevents |
| `/quote-bridge` | Get a live cross-chain quote (deBridge DLN / CCTP) — read-only, no funds moved |

## Agents

| Agent | Purpose |
|-------|---------|
| **bridge-engineer** | Chooses and integrates the right bridge with a correct async lifecycle and safety wiring |
| **bridge-security-reviewer** | Audits an integration against the real bridge-hack failure modes; emits the pre-deploy verdict |

## Worked Example

`examples/bridge-guards/` is a **runnable** TypeScript module of the verification logic every
bridge integrator needs — emitter allowlisting, replay tracking, and cross-chain decimal
normalization (9-dp NTT wire ↔ 6-dp USDC) — with a `node:test` suite that passes. It turns
the [bridge-security.md](bridge-security.md) checklist into code you can drop in and test.
