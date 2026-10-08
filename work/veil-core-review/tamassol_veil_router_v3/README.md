# TAMASSOL Veil Router v3

> LOCAL REVIEW BUILD — not approved for real funds or publication. See
> `REVIEW_STATUS.md` for independently reproduced results and unresolved gates.
> The original reports below describe the supplied release, not an independent audit.
> Receipt integrity is not proof of settlement. Privacy scores are heuristics,
> not percentages of anonymity. Execution exposure is provider-reported.

**Privacy intent routing + anti-downgrade hardware approval + verifiable privacy receipts for Solana.**

This repository is an engineering handoff for the TAMASSOL hackathon build. The core is provider-neutral and has **zero runtime npm dependencies**. It compiles under strict TypeScript, runs a deterministic end-to-end demo, and ships with a security-focused test suite.

## What is new

Most privacy integrations force the app/user to choose a protocol. Veil reverses that relationship:

```text
User intent
  "hide sender + recipient + amount + asset"
                |
                v
       TAMASSOL Veil Router
                |
       evaluates real guarantees
                |
       picks an eligible provider
                |
      hardware signs Route Plan
                |
       provider executes route
                |
        anti-downgrade check
                |
      verifiable Veil Receipt
```

The provider is an implementation detail. The user's privacy requirement is the product contract.

## Core innovations

### 1. Privacy Intent
Apps ask for properties, not a vendor:

```ts
privacy: {
  sender: "required",
  recipient: "required",
  asset: "required",
  amount: "required",
  history: "preferred"
}
```

### 2. No silent privacy downgrade
A provider that cannot meet every `required` privacy dimension is not eligible. If execution produces weaker exposure than the approved route, the engine rejects the result.

### 3. Deterministic provider routing
Eligible routes are scored on:
- requested privacy fulfillment;
- hardware key isolation;
- self custody;
- protocol readiness;
- fee;
- latency.

Ties are deterministic.

### 4. Cryptographically bound Route Plan
The route plan binds:
- full intent hash;
- privacy request;
- provider + version;
- provider execution-plan commitment;
- exposure profile;
- fee;
- candidate scores;
- expiry.

The paired TAMASSOL device signs this route plan with a separate **P-256 attestation key**.

### 5. Two-phase hardware binding
Route approval and final Solana transaction signing are separate security steps. The real provider driver receives a `TamassolTransactionSigner` and must bind the final serialized transaction to the approved `routePlanHash` before requesting a Solana signature.

### 6. Veil Receipt
After execution, TAMASSOL generates a receipt that can be verified for integrity without publishing hidden amount/recipient data.

### 7. Selective disclosure commitments
The user can later reveal only one field (for example amount or recipient) together with its salt. A verifier can prove that field was committed in the original Veil Receipt without revealing unrelated private fields.

This is a commitment-based selective disclosure mechanism, **not** a zero-knowledge proof and is not marketed as one.

## Validation status

Run:

```bash
npm test
npm run demo
```

Current engineering validation:
- strict TypeScript build: PASS
- automated tests: 40/40 PASS
- deterministic demo: PASS
- npm runtime dependencies: 0
- npm package audit: 0 known dependency vulnerabilities (core has no third-party packages)
- TODO/FIXME/NOT_IMPLEMENTED scan in compiled core: none
- unsafe `parseFloat`, `Math.random`, `eval`, localStorage/sessionStorage scan in core: none

See `VALIDATION_REPORT.md`, `AUDIT_REPORT.md`, `docs/RELEASE_GATES.md`, and `INTEGRATION_MANIFEST.json`.

## Important audit boundary

This pack has received an **engineering/security review of the TAMASSOL Veil core**. It is not an independent cryptographic audit of Cloak, Helius, Solana Token-2022, the final ESP32 firmware, or code that Codex has not yet merged into the actual TAMASSOL repository.

The compiled core contains no fake production provider. The only executable provider included is explicitly named `DeterministicDemoProvider` and is used for tests/demo. Real protocol adapters belong in the app integration layer and must use the reviewed driver seam in `src/driverProvider.ts`.

## Files Codex should read first

1. `CODEX_MASTER_PROMPT.md`
2. `docs/ARCHITECTURE.md`
3. `docs/SECURITY_MODEL.md`
4. `integrations/cloak/IMPLEMENTATION.md`
5. `firmware/TAMASSOL_VEIL_PROTOCOL_V3.md`
6. `docs/HACKATHON_DEMO.md`

## Recommended hackathon story

> **TAMASSOL Veil is the privacy router for Solana.** Developers specify the privacy they need; Veil chooses an eligible privacy rail, cryptographically binds the route to TAMASSOL hardware, prevents silent privacy downgrades, and produces a selectively-disclosable receipt.

This maps directly to Colosseum's published evaluation dimensions: functionality/code quality, ecosystem impact, novelty, UX, open-source composability, and business viability.
