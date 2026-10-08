# Veil provider health layer

Implemented locally; no new transfer, hardware approval, live proving call or site publication performed for this change.

## Selection and execution

Capability/policy and requested privacy dimensions are checked before provider health. Only HEALTHY plus proverReady:true is executable. Legacy ping-only responses fail closed. STALE_ROOT and INDEXER_UNAVAILABLE override a conflicting HEALTHY response to DEGRADED.

Quotes must continue to meet every requested privacy requirement, fee ceiling, network, asset and policy constraint. The highest ranked compatible candidate is rechecked immediately before RoutePlan creation. If it degraded, the next compatible candidate is checked without changing the intent. If none qualifies, code NO_HEALTHY_PRIVACY_ROUTE is returned with the public message: “This privacy route is temporarily unavailable.” Internal exception text is not included.

The engine validates route integrity and checks selected-provider health again before hardware approval and before provider dispatch. It does not switch providers after approval; that would require a new plan and new approval.

## Internal records and actual Helius integration

Core getProviderHealth() returns safe records containing provider, health, errorCode, timestamp and lastSuccessfulCheck. Provider exceptions are mapped to fixed codes. Health checks are bounded to five seconds in the router; no automatic retry is added.

Helius uses a persistent local readiness/circuit-breaker file, provider-health/helius.json, initialized DEGRADED from the recorded real Stale Root diagnosis. Checks append safe records to provider-health/checks.jsonl. A successful genesis/RPC check alone never marks the provider healthy. Missing, incompatible-input or expired readiness fails closed.

The isolated diagnostic can update readiness only upon successful proof generation (or retain degradation after failure); a success is bound to the tested input signature and Devnet and expires after 30 seconds. No such diagnostic was executed during this change. This short-lived local evidence is a preflight gate, not a guarantee that the remote provider cannot fail afterward. Execution failures remain blocked and mark readiness degraded.

## Limitations

Cloak fallback is validated with explicit deterministic MOCK providers only. No real Cloak adapter or second production provider was added. Therefore the current real Helius degradation results in NO_HEALTHY_PRIVACY_ROUTE, not an actual fallback transfer. This change does not repair the hosted indexer or claim anonymity/audit status.

Error-code migration: integrations expecting NO_PRIVACY_ROUTE must now handle NO_HEALTHY_PRIVACY_ROUTE. The core and local Devnet adapter tests were updated. No website UI was changed; the public message is supplied by the router error boundary.
