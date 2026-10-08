<p align="center">
  <img src="docs/brand/universe.webp" alt="The six TAMASSOL companions in their elemental universe" width="100%">
</p>

<h1 align="center">TAMASSOL</h1>
<p align="center"><strong>A living companion for Solana.</strong><br>Physical presence. Intent-based privacy. Deliberate approval.</p>
<p align="center"><a href="https://tamassol.com">Explore the website</a> · <a href="https://tamassol.com/privacy.html#localnet-proof">Localnet evidence</a> · <a href="#roadmap">Roadmap</a> · <a href="README.pt-BR.md">Português</a></p>

> **Experimental prototype · Localnet & Devnet only.** No audited mainnet product, no traditional cold-wallet claim, and no real-funds release. Concept artwork illustrates the product vision, not finished hardware.

## What we are building

TAMASSOL brings an expressive physical companion to the Solana experience. Instead of another balance screen, we are building a character that reacts to wallet activity and, over time, helps users understand and deliberately authorize operations.

**Veil Router** is the privacy-intent layer underneath that vision. Applications specify required privacy properties; Veil checks capabilities and provider health before selecting an eligible route. If no healthy route meets those requirements, the operation stops instead of silently reducing protection.

The initial product hypothesis is a companion for Solana users who want clearer controls and a more engaging daily experience. Mobile integration, user validation and distribution are upcoming work—not existing traction.

## Meet the companions

Six elements, one universe. **Solflame is the current physical prototype character.** The remaining characters are part of the visual identity and planned experience; this gallery does not imply six implemented device integrations.

<table>
  <tr>
    <td align="center"><img src="docs/brand/solflame.webp" alt="Solflame, fire companion" width="220"><br><strong>SOLFLAME</strong><br>Fire · Courage</td>
    <td align="center"><img src="docs/brand/frost.webp" alt="Frost, ice companion" width="220"><br><strong>FROST</strong><br>Ice · Resilience</td>
    <td align="center"><img src="docs/brand/volt.webp" alt="Volt, electric companion" width="220"><br><strong>VOLT</strong><br>Electricity · Energy</td>
  </tr>
  <tr>
    <td align="center"><img src="docs/brand/mizu.webp" alt="Mizu, water companion" width="220"><br><strong>MIZU</strong><br>Water · Adaptability</td>
    <td align="center"><img src="docs/brand/verdant.webp" alt="Verdant, nature companion" width="220"><br><strong>VERDANT</strong><br>Nature · Growth</td>
    <td align="center"><img src="docs/brand/void.webp" alt="Void, shadow companion" width="220"><br><strong>VOID</strong><br>Shadow · Discovery</td>
  </tr>
</table>

## Evidence before promises

| Area | Demonstrated | Boundary |
| --- | --- | --- |
| Physical companion | ESP32-S3 display, animated Solflame and Devnet activity experiments | Not a production device |
| Confidential provider | A recorded confidential transfer on Devnet | Separate from integrated physical approval |
| Veil + Zolana | Successful automated Localnet routing, proving, transaction, decryption and receipt verification | Localnet only; no physical approval in this run |
| Provider health | Health gating and fail-closed routing covered by automated tests | Compatible fallback is mocked, not a live second-provider integration |
| Mobile signing | Architecture and roadmap | Not implemented or demonstrated by the Localnet run |

### October 8, 2026 — Localnet validation

**Passed:** local Solana RPC + Photon + prover → Veil route → confidential transaction → decrypted balances → verified Veil Receipt.

| Test result | Amount |
| --- | ---: |
| Private deposit | 0.010 test SOL |
| Confidential transfer | 0.003 test SOL |
| Sender's verified private balance | 0.007 test SOL |
| Recipient's verified private balance | 0.003 test SOL |

- [Original GitHub Actions run](https://github.com/Edencrypto-IA/tamassol/actions/runs/37798210420) · commit [`2275136`](https://github.com/Edencrypto-IA/tamassol/commit/22751362f10b0f4c6636d895e0217599107ee8e5).
- [Public, sanitized evidence summary](https://tamassol.com/evidence/veil-localnet-summary.json). Original CI access depends on repository permissions; downloadable CI artifacts have retention limits.
- The original test lives on [`veil-localnet-validation`](https://github.com/Edencrypto-IA/tamassol/tree/veil-localnet-validation). This default branch contains the provider-health baseline and links to that separate validation work; it does not merge those changes.

Amounts and assets are confidential in the tested route; sender and recipient are public and history privacy is not established. **This is not full anonymity.** Local signatures cannot be verified on the public Devnet Explorer. Receipt integrity alone is not settlement evidence; this run also checked the transaction and decrypted balances.

## Architecture and trust boundaries

The ESP32-S3 **does not store or use the Solana wallet private key**. A separate device-authentication key is distinct from a wallet key.

```text
Privacy intent
    ↓
Capability + provider-health checks
    ↓
Eligible route and exact transaction preparation
    ↓
ESP32-S3 displays amount, destination and network
    ↓
Authenticated physical authorization [integration milestone]
    ↓
Local test computer signs → Solana transaction → receipt + balances

Target mobile product: phone replaces the test computer as wallet signer.
No compatible healthy route → NO_HEALTHY_PRIVACY_ROUTE → no approval request.
```

The next integration must bind approval to the **exact transaction**, reject replay, expiry and altered details, and prevent the test application from signing without valid authorization. A bare USB/Wi-Fi approval signal is not sufficient.

This is an application-level approval architecture, **not cold-key isolation**. A compromised signing computer or phone can bypass its own application logic. No security audit is claimed. Zolana supplies the underlying cryptography; TAMASSOL's work is the companion experience and the intent, health, authorization and receipt orchestration.

## Explore the code

| Component | Location |
| --- | --- |
| Veil core: intent, routes, health, receipts | [`work/veil-core-review/tamassol_veil_router_v3`](work/veil-core-review/tamassol_veil_router_v3) |
| Devnet adapter and test harness | [`work/veil-devnet`](work/veil-devnet) |
| Physical prototype | [`outputs/tamassol`](outputs/tamassol) |
| Localnet instructions and workflow | [Validation branch](https://github.com/Edencrypto-IA/tamassol/tree/veil-localnet-validation/work/veil-localnet) · [CI workflow](https://github.com/Edencrypto-IA/tamassol/blob/veil-localnet-validation/.github/workflows/veil-localnet.yml) |

Some component documents are historical engineering handoffs. This overview states the current product boundary: physical approval is separate from Solana wallet signing, and integration milestones are not completed features.

### Run the core tests

Requires Node.js 22 or newer and npm. These commands build and test the core; they do not initiate a live transfer.

```sh
cd work/veil-core-review/tamassol_veil_router_v3
npm ci
npm test
npm run build
```

For the separate Localnet E2E, follow the [validation instructions](https://github.com/Edencrypto-IA/tamassol/blob/veil-localnet-validation/work/veil-localnet/README.md). Use isolated test wallets only. Never commit `.env` files, seed phrases, private keys, wallet keypairs, API keys, witnesses or sensitive logs.

## Roadmap

Milestones advance after verification, not a promised launch date.

| Stage | Deliverable | Completion gate |
| --- | --- | --- |
| **Validated** | Veil + Zolana Localnet and separate companion prototype | Recorded transaction, decrypted balances and receipt |
| **Next** | Exact-transaction physical approval in the integrated Localnet flow | Rejection, replay, expiry and tampering block signing; successful authorized run verifies balances and receipt |
| **Then** | Integrated Devnet flow | Healthy provider, explicit privacy boundaries and reproducible physical approval |
| **Then** | Mobile app and small test-network pilot | Phone-held wallet key, authenticated pairing, recovery design and documented user feedback |
| **Future decision** | Real-funds readiness | Security review, resolved critical findings and separately scoped release decision |

## Project status and attribution

TAMASSOL is an independent project. Use of Solana or Zolana does not imply endorsement, funding or partnership. Artwork is product concept material, not proof of implemented functionality. No adoption, revenue or audit metrics are claimed here.

The Veil core has its own [MIT license](work/veil-core-review/tamassol_veil_router_v3/LICENSE). Consult component licenses; that license is not a blanket license for TAMASSOL brand artwork or every file in this repository.

For review, start with the evidence, inspect the linked source commit, and keep **tested**, **demonstrated visually**, and **planned** separate.
