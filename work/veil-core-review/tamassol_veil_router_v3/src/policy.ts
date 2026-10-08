import { VeilError } from "./errors.js";
import { isSha256Hex } from "./crypto.js";
import { isValidSolanaAddress } from "./solana.js";
import type {
  ProviderManifest,
  ProviderQuote,
  RouterPolicy,
  VeilIntent,
} from "./types.js";


export function assertRouterPolicyValid(policy: RouterPolicy): void {
  if (policy.version !== 1) {
    throw new VeilError("INVALID_POLICY_VERSION", "Unsupported router policy version.");
  }
  if (!Number.isFinite(policy.minPrivacyScore) || policy.minPrivacyScore < 0 || policy.minPrivacyScore > 100) {
    throw new VeilError("INVALID_MIN_PRIVACY_SCORE", "minPrivacyScore must be between 0 and 100.");
  }
  for (const [name, value] of Object.entries({
    maxQuoteAgeMs: policy.maxQuoteAgeMs,
    maxIntentAgeMs: policy.maxIntentAgeMs,
    maxClockSkewMs: policy.maxClockSkewMs,
  })) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new VeilError("INVALID_POLICY_DURATION", `${name} must be a non-negative safe integer.`);
    }
  }
  if (policy.maxQuoteAgeMs > policy.maxIntentAgeMs) {
    throw new VeilError("INVALID_POLICY_DURATION", "Quote TTL cannot exceed intent TTL policy.");
  }
  for (const [assetId, fee] of Object.entries(policy.maxFeeByAssetId ?? {})) {
    if (!assetId || fee < 0n) {
      throw new VeilError("INVALID_FEE_POLICY", "Fee policy entries must use a non-empty asset and non-negative bigint.");
    }
  }
}

export function assertIntentBasics(
  intent: VeilIntent,
  policy: RouterPolicy,
  nowMs = Date.now(),
): void {
  if (intent.version !== 3) {
    throw new VeilError("UNSUPPORTED_INTENT_VERSION", "Unsupported Veil intent version.");
  }
  if (!intent.requestId || !intent.nonce) {
    throw new VeilError("INVALID_INTENT_IDENTITY", "Intent requestId and nonce are required.");
  }
  if (!Number.isSafeInteger(intent.createdAtMs) || !Number.isSafeInteger(intent.expiresAtMs)) {
    throw new VeilError("INVALID_INTENT_TIME", "Intent timestamps must be safe integers.");
  }
  if (!intent.asset.assetId || !intent.asset.symbol) {
    throw new VeilError("INVALID_ASSET", "Asset id and symbol are required.");
  }
  if (!Number.isInteger(intent.asset.decimals) || intent.asset.decimals < 0 || intent.asset.decimals > 255) {
    throw new VeilError("INVALID_ASSET_DECIMALS", "Asset decimals must be an integer between 0 and 255.");
  }
  if (intent.recipient?.kind === "solana" && !isValidSolanaAddress(intent.recipient.address)) {
    throw new VeilError("INVALID_RECIPIENT", "Invalid Solana recipient address.");
  }
  if (intent.recipient?.kind === "shielded" && !intent.recipient.providerRecipientId) {
    throw new VeilError("INVALID_RECIPIENT", "Shielded recipient id is required.");
  }
  if (intent.amountBaseUnits <= 0n) {
    throw new VeilError("INVALID_AMOUNT", "Amount must be greater than zero.");
  }
  if (intent.feeCeilingBaseUnits < 0n) {
    throw new VeilError("INVALID_FEE_CEILING", "Fee ceiling cannot be negative.");
  }
  if (intent.createdAtMs > nowMs + policy.maxClockSkewMs) {
    throw new VeilError("INTENT_FROM_FUTURE", "Intent creation time exceeds clock-skew policy.");
  }
  if (intent.expiresAtMs <= nowMs || intent.expiresAtMs <= intent.createdAtMs) {
    throw new VeilError("INTENT_EXPIRED", "Veil intent has expired.");
  }
  if (intent.expiresAtMs - intent.createdAtMs > policy.maxIntentAgeMs) {
    throw new VeilError("INTENT_TTL_TOO_LONG", "Intent approval window exceeds policy.");
  }
  if (
    policy.allowedAssetIds !== "dynamic" &&
    !policy.allowedAssetIds.includes(intent.asset.assetId)
  ) {
    throw new VeilError("ASSET_NOT_ALLOWED", "Asset is not enabled by Veil policy.");
  }
  const maxFee = policy.maxFeeByAssetId?.[intent.asset.assetId];
  if (maxFee !== undefined && intent.feeCeilingBaseUnits > maxFee) {
    throw new VeilError("FEE_POLICY_EXCEEDED", "Intent fee ceiling exceeds wallet policy.");
  }
  if (
    (intent.operation === "private_transfer" || intent.operation === "unshield") &&
    !intent.recipient
  ) {
    throw new VeilError("RECIPIENT_REQUIRED", "Operation requires a recipient.");
  }
}

export function providerAllowedByPolicy(
  manifest: ProviderManifest,
  intent: VeilIntent,
  policy: RouterPolicy,
): { allowed: boolean; reason?: string } {
  if (
    policy.enabledProviderIds !== "all" &&
    !policy.enabledProviderIds.includes(manifest.providerId)
  ) {
    return { allowed: false, reason: "provider_disabled" };
  }
  if (!manifest.networks.includes(intent.network)) {
    return { allowed: false, reason: "network_unsupported" };
  }
  if (!manifest.operations.includes(intent.operation)) {
    return { allowed: false, reason: "operation_unsupported" };
  }
  if (
    manifest.supportedAssetIds !== "dynamic" &&
    !manifest.supportedAssetIds.includes(intent.asset.assetId)
  ) {
    return { allowed: false, reason: "asset_unsupported" };
  }
  if (manifest.release === "demo" && !policy.allowDemoProviders) {
    return { allowed: false, reason: "demo_provider_disabled" };
  }
  if (manifest.release === "experimental" && !policy.allowExperimentalProviders) {
    return { allowed: false, reason: "experimental_provider_disabled" };
  }
  if (policy.requireSelfCustody && !manifest.selfCustodial) {
    return { allowed: false, reason: "self_custody_required" };
  }
  if (
    policy.requireHardwareKeyIsolation === "strict" &&
    manifest.hardwareKeyIsolation !== "compatible"
  ) {
    return { allowed: false, reason: "strict_key_isolation_required" };
  }
  if (
    policy.requireHardwareKeyIsolation === "allow_conditional" &&
    manifest.hardwareKeyIsolation === "incompatible"
  ) {
    return { allowed: false, reason: "key_isolation_incompatible" };
  }
  return { allowed: true };
}

export function quoteAllowedByPolicy(
  quote: ProviderQuote,
  intent: VeilIntent,
  policy: RouterPolicy,
  nowMs = Date.now(),
): { allowed: boolean; reason?: string } {
  if (quote.providerId.length === 0 || quote.providerVersion.length === 0) {
    return { allowed: false, reason: "invalid_quote_identity" };
  }
  if (!isSha256Hex(quote.quoteId) || !isSha256Hex(quote.providerPlanCommitment)) {
    return { allowed: false, reason: "invalid_quote_commitment" };
  }
  if (!Number.isSafeInteger(quote.validUntilMs) || quote.validUntilMs <= nowMs) {
    return { allowed: false, reason: "quote_expired" };
  }
  if (quote.validUntilMs - nowMs > policy.maxQuoteAgeMs) {
    return { allowed: false, reason: "quote_ttl_too_long" };
  }
  if (typeof quote.estimatedFeeBaseUnits !== "bigint" || quote.estimatedFeeBaseUnits < 0n) {
    return { allowed: false, reason: "invalid_fee" };
  }
  if (!Number.isSafeInteger(quote.estimatedLatencyMs) || quote.estimatedLatencyMs < 0) {
    return { allowed: false, reason: "invalid_latency" };
  }
  if (quote.estimatedFeeBaseUnits > intent.feeCeilingBaseUnits) {
    return { allowed: false, reason: "fee_ceiling_exceeded" };
  }
  const maxFee = policy.maxFeeByAssetId?.[intent.asset.assetId];
  if (maxFee !== undefined && quote.estimatedFeeBaseUnits > maxFee) {
    return { allowed: false, reason: "wallet_fee_policy_exceeded" };
  }
  return { allowed: true };
}
