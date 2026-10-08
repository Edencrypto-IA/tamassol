# TAMASSOL Veil — isolated Zolana localnet validation

This directory is intentionally separate from the saved Devnet evidence.

Its purpose is to obtain one reproducible end-to-end confidential transfer on
the official Zolana local stack without depending on the degraded hosted
Devnet indexer.

A localnet success is **not** Devnet evidence and must never be presented as
such.

## Official stack

The matching SDK in TAMASSOL is `@heliuslabs/zolana@0.4.0-alpha`.
Use the matching official CLI release:

```bash
cargo install --git https://github.com/helius-labs/zolana --tag v0.4.0-alpha zolana-cli
```

Start the official pre-initialized stack in Ubuntu/WSL:

```bash
zolana dev start
```

It provides:

- Solana local validator: `127.0.0.1:8899`
- Photon: `127.0.0.1:8784`
- prover: `127.0.0.1:3001`

The CLI verifies its downloaded release artifacts against its embedded SHA-256
lockfile.

## TAMASSOL validation

In another shell:

```bash
cd work/veil-localnet
npm install
npm run preflight
npm test
npm run e2e
```

The E2E script is one-shot and writes evidence under
`localnet-evidence/`. That directory is ignored by Git.

The script:

1. verifies the three local services;
2. creates isolated local-only wallets if missing;
3. airdrops local validator SOL;
4. registers both Zolana recipients;
5. deposits 0.01 local SOL into the sender shielded balance;
6. proves and executes a 0.003 confidential transfer through Veil;
7. syncs both wallets and checks 0.007 / 0.003 private balances;
8. creates and verifies the Veil receipt;
9. never talks to Devnet or Mainnet.

## Scope

Current localnet validation still uses a software Solana signer. It proves the
privacy protocol + Veil routing path independently of the hosted Helius Devnet
service. Hardware transaction signing is a separate release gate.
