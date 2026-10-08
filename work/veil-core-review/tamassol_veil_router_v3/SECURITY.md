# Security policy

TAMASSOL Veil handles transaction-routing and hardware-approval security boundaries. Treat changes to canonicalization, hashing, route policy, hardware proof verification, replay handling, receipt commitments, provider manifests, or transaction signing as security-sensitive.

## Integration rule

Never weaken a `required` privacy dimension to make a transaction succeed. Return an explicit no-route error instead.

## Secrets

Do not file issues containing wallet seeds, private keys, note/UTXO secrets, viewing secrets, raw provider contexts, API secrets, or production transaction material that is not already public on-chain.

## External provider drivers

A driver is not production-ready merely because it compiles. It must pass the provider contract tests, network exercise, durable-secret-state tests when applicable, and hardware transaction-binding tests described in `docs/RELEASE_GATES.md`.
