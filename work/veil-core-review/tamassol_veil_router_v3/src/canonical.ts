import type {
  ApprovalEnvelope,
  ExposureProfile,
  PrivacyRequirements,
  Recipient,
  RouteCandidateSummary,
  RoutePlan,
  RouterPolicy,
  ProviderManifest,
  VeilIntent,
} from "./types.js";
import { sha256Hex, utf8 } from "./crypto.js";

function byteLength(value: string): number {
  return utf8(value).length;
}

function field(value: string): string {
  return `${byteLength(value)}:${value}`;
}

function bool(value: boolean): string {
  return value ? "1" : "0";
}

function list(values: readonly string[]): string {
  return values.map(field).join("");
}

export function canonicalRecipient(recipient?: Recipient): string {
  if (!recipient) return "none";
  if (recipient.kind === "solana") return `solana:${recipient.address}`;
  return [
    "shielded",
    recipient.providerRecipientId,
    recipient.address ?? "",
    recipient.viewingPublicKey ?? "",
  ].map(field).join("");
}

export function canonicalPrivacyRequirements(value: PrivacyRequirements): string {
  return [
    value.sender,
    value.recipient,
    value.asset,
    value.amount,
    value.history,
  ].map(field).join("");
}

export function canonicalExposure(value: ExposureProfile): string {
  return [
    value.sender,
    value.recipient,
    value.asset,
    value.amount,
    value.history,
    value.note,
  ].map(field).join("");
}

export function canonicalIntent(intent: VeilIntent): string {
  return [
    "TAMASSOL_VEIL_INTENT_V3",
    String(intent.version),
    intent.requestId,
    intent.nonce,
    String(intent.createdAtMs),
    String(intent.expiresAtMs),
    intent.network,
    intent.operation,
    intent.asset.symbol,
    String(intent.asset.decimals),
    intent.asset.assetId,
    intent.amountBaseUnits.toString(),
    canonicalRecipient(intent.recipient),
    canonicalPrivacyRequirements(intent.privacy),
    intent.feeCeilingBaseUnits.toString(),
  ].map(field).join("");
}

export async function hashIntent(intent: VeilIntent): Promise<string> {
  return sha256Hex(canonicalIntent(intent));
}


function canonicalManifest(manifest: ProviderManifest): string {
  const exposureRows = [...manifest.operations]
    .sort()
    .map(operation => {
      const exposure = manifest.exposureByOperation[operation];
      return field(operation) + field(exposure ? canonicalExposure(exposure) : "none");
    })
    .join("");
  const assets = manifest.supportedAssetIds === "dynamic"
    ? "dynamic"
    : [...manifest.supportedAssetIds].sort().join(",");
  return [
    manifest.providerId,
    manifest.providerVersion,
    manifest.displayName,
    manifest.release,
    [...manifest.networks].sort().join(","),
    [...manifest.operations].sort().join(","),
    assets,
    manifest.hardwareKeyIsolation,
    bool(manifest.selfCustodial),
    manifest.secretStateModel,
    exposureRows,
  ].map(field).join("");
}

export async function hashProviderCatalog(manifests: readonly ProviderManifest[]): Promise<string> {
  const canonical = [...manifests]
    .sort((a, b) => a.providerId.localeCompare(b.providerId))
    .map(canonicalManifest)
    .join("");
  return sha256Hex(field("TAMASSOL_VEIL_PROVIDER_CATALOG_V1") + canonical);
}

export function canonicalPolicy(policy: RouterPolicy): string {
  const enabled = policy.enabledProviderIds === "all"
    ? "all"
    : [...policy.enabledProviderIds].sort().join(",");
  const assets = policy.allowedAssetIds === "dynamic"
    ? "dynamic"
    : [...policy.allowedAssetIds].sort().join(",");
  const feeRows = Object.entries(policy.maxFeeByAssetId ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([assetId, amount]) => `${field(assetId)}${field(amount.toString())}`)
    .join("");

  return [
    "TAMASSOL_VEIL_POLICY_V1",
    String(policy.version),
    enabled,
    assets,
    bool(policy.allowDemoProviders),
    bool(policy.allowExperimentalProviders),
    bool(policy.requireSelfCustody),
    policy.requireHardwareKeyIsolation,
    bool(policy.requireHardwareApproval),
    String(policy.minPrivacyScore),
    String(policy.maxQuoteAgeMs),
    String(policy.maxIntentAgeMs),
    String(policy.maxClockSkewMs),
    feeRows,
  ].map(field).join("");
}

export async function hashPolicy(policy: RouterPolicy): Promise<string> {
  return sha256Hex(canonicalPolicy(policy));
}

function canonicalScore(candidate: RouteCandidateSummary): string {
  const s = candidate.score;
  return [s.privacy, s.keyIsolation, s.selfCustody, s.readiness, s.fees, s.latency, s.total]
    .map(value => field(String(value)))
    .join("");
}

export function canonicalCandidate(candidate: RouteCandidateSummary): string {
  return [
    candidate.providerId,
    candidate.providerVersion,
    candidate.quoteId,
    canonicalExposure(candidate.exposure),
    candidate.estimatedFeeBaseUnits,
    String(candidate.estimatedLatencyMs),
    candidate.providerPlanCommitment,
    canonicalScore(candidate),
  ].map(field).join("");
}

export function canonicalRoutePlanWithoutHash(plan: Omit<RoutePlan, "routePlanHash">): string {
  const candidates = [...plan.candidates]
    .sort((a, b) => {
      if (b.score.total !== a.score.total) return b.score.total - a.score.total;
      return a.providerId.localeCompare(b.providerId);
    })
    .map(canonicalCandidate)
    .join("");
  const rejections = [...plan.rejections]
    .sort((a, b) => a.providerId.localeCompare(b.providerId))
    .map(item => field(item.providerId) + field(item.providerVersion) + field(item.reason))
    .join("");

  return [
    "TAMASSOL_VEIL_ROUTE_PLAN_V1",
    String(plan.version),
    plan.intentHash,
    plan.policyHash,
    plan.catalogHash,
    plan.selectedProviderId,
    plan.selectedProviderVersion,
    plan.selectedQuoteId,
    plan.selectedProviderPlanCommitment,
    canonicalExposure(plan.selectedExposure),
    plan.selectedFeeBaseUnits,
    String(plan.selectedLatencyMs),
    canonicalScore({
      providerId: plan.selectedProviderId,
      providerVersion: plan.selectedProviderVersion,
      quoteId: plan.selectedQuoteId,
      exposure: plan.selectedExposure,
      estimatedFeeBaseUnits: plan.selectedFeeBaseUnits,
      estimatedLatencyMs: plan.selectedLatencyMs,
      providerPlanCommitment: plan.selectedProviderPlanCommitment,
      score: plan.selectedScore,
    }),
    candidates,
    rejections,
    String(plan.createdAtMs),
    String(plan.expiresAtMs),
  ].map(field).join("");
}

export async function hashRoutePlan(plan: Omit<RoutePlan, "routePlanHash">): Promise<string> {
  return sha256Hex(canonicalRoutePlanWithoutHash(plan));
}

export function canonicalApprovalEnvelope(envelope: ApprovalEnvelope): string {
  return [
    envelope.deviceProtocol,
    String(envelope.version),
    envelope.requestId,
    envelope.nonce,
    String(envelope.createdAtMs),
    String(envelope.expiresAtMs),
    envelope.network,
    envelope.operation,
    envelope.assetId,
    envelope.assetSymbol,
    String(envelope.assetDecimals),
    envelope.amountBaseUnits,
    envelope.recipientBinding,
    canonicalPrivacyRequirements(envelope.requestedPrivacy),
    envelope.routePlanHash,
    envelope.intentHash,
    envelope.selectedProviderId,
    envelope.selectedProviderVersion,
    envelope.providerPlanCommitment,
    canonicalExposure(envelope.selectedExposure),
    envelope.feeBaseUnits,
  ].map(field).join("");
}
