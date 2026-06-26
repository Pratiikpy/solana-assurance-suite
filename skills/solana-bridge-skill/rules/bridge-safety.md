# Rule: Cross-Chain Bridge Safety (auto-loaded)

These constraints apply whenever this skill writes, reviews, or scaffolds a bridge integration. Bridges are the single most-exploited primitive in crypto — a destination mint creates value purely on the strength of an attestation, so one missing check mints unbacked supply from nothing. Full failure-mode detail and the cited post-mortems are in `bridge-security.md`; this is the non-negotiable floor.

## Never release value before required finality
- Do not mint/release on the destination off a source event that can still be reorged. Respect the finality threshold.
- CCTP **Fast V2** mints on soft finality only because **Circle fronts the reorg risk** — if you use it, that tradeoff must be explicit and accepted, not accidental. A hand-rolled verifier minting before source finality is exploitable (reorg the burn, keep the mint).

## Always verify the attestation and the emitter
- Verify the VAA/attestation against the **expected** signer set (Guardian set / Circle attester), with signatures read from **identity-checked accounts** — never an unchecked sysvar or an account whose address you didn't constrain. This omitted check *is* the Wormhole-2022 hack.
- Enforce a **source emitter / peer allowlist**: accept messages only from the registered emitter on the known source chain. Registration / `setPeer` is owner-gated.

## Always track consumed messages (replay)
- Every attestation is consumable **exactly once**. Track consumption in a PDA (consumed-message hash / used-nonce) and reject re-submission. Do not rely solely on the bridge's own claim PDA — track it independently. Unbounded replay of one message was the Nomad drain.

## Normalize decimals explicitly
- State and apply the scaling at **both ends**. NTT normalizes SVM amounts to **9 decimals** on the wire and trims; **CCTP USDC is 6 decimals** everywhere; EVM ERC-20s are often 18. A wrong factor mints orders of magnitude too much or silently truncates value. Round-trip must conserve value and never overflow.

## Treat every cross-chain message as untrusted input
- A valid signature proves the message is *genuine*, not that *you* should act on it. Validate the in-payload **sender and recipient** (DLN `dstChainTokenOutRecipient` included) before any state change or payout. The bridge proves authenticity; authorization is on you.

## Never hardcode unverified program IDs / domains / addresses
- Program IDs, CCTP domains (Solana = `5`), NTT manager/transceiver addresses, and deBridge internal chain ids (Solana = `7565164`) come from official sources at integration time — Circle's `solana-cctp-contracts` IDL, your `deployment.json`, the live API response, the pinned Core Contract address. Any constant gets a source citation and a confirm flag. A swapped testnet/mainnet program ID is the most common bridge bug.

## Test the malicious path before shipping
- The malicious-VAA / forged-attestation / replayed-nonce / foreign-domain paths are written as failing tests **before** the integration ships — they pass/drain against the broken behavior and reject against the fix, with coverage confirming the guard branch was reached (`testing-bridges.md`, Tier 1; bug-class catalogue at `../solana-testing/bug-class-playbook.md`). A failure mode never encoded as a failing test is undefended. If it isn't tested, it isn't ready — say so.

## Configure the blast-radius cap (NTT) and guard its authority
- Set per-chain inbound/outbound **rate limits** and a **pause** switch; an over-limit transfer is queued/rejected, never silently minted. The **pause/owner authority itself** is access-controlled — pauser on a hot key separate from `owner`, `owner` on a multisig/governance.

## Prefer the issuer-native rail and a reviewed implementation
- Route per `bridge-landscape.md`: CCTP for native USDC, NTT for your own token, messaging for arbitrary payloads, DLN for intent swaps. Reach for a lock-and-mint wrapped bridge essentially never. Build on a security-reviewed reference (Circle CCTP programs, Wormhole NTT framework); if you hand-roll a verifier, get an audit and treat the checklist as the minimum, not the ceiling.
