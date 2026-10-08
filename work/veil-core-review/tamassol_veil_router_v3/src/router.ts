import { NoPrivacyRouteError, RouteIntegrityError } from "./errors.js";
import { canonicalExposure, hashIntent, hashPolicy, hashProviderCatalog, hashRoutePlan } from "./canonical.js";
import {
  quoteDoesNotOverclaim,
  privacyScore,
  satisfiesPrivacyRequirements,
} from "./privacy.js";
import {
  assertIntentBasics,
  assertRouterPolicyValid,
  providerAllowedByPolicy,
  quoteAllowedByPolicy,
} from "./policy.js";
import { scoreRoute } from "./scoring.js";
import type { VeilProvider } from "./provider.js";
import { ProviderRegistry } from "./provider.js";
import { healthErrorCode, type ProviderHealthCheck, type ProviderHealthRecord } from "./health.js";
import type {
  PreparedRoute,
  ProviderQuote,
  RouteCandidateSummary,
  RoutePlan,
  RouteRejection,
  RouterPolicy,
  VeilIntent,
} from "./types.js";

interface EligibleRoute {
  provider: VeilProvider;
  quote: ProviderQuote;
  summary: RouteCandidateSummary;
}

function compareEligible(left: EligibleRoute, right: EligibleRoute): number {
  if (right.summary.score.total !== left.summary.score.total) {
    return right.summary.score.total - left.summary.score.total;
  }
  if (left.quote.estimatedFeeBaseUnits !== right.quote.estimatedFeeBaseUnits) {
    return left.quote.estimatedFeeBaseUnits < right.quote.estimatedFeeBaseUnits ? -1 : 1;
  }
  if (left.quote.estimatedLatencyMs !== right.quote.estimatedLatencyMs) {
    return left.quote.estimatedLatencyMs - right.quote.estimatedLatencyMs;
  }
  return left.provider.manifest.providerId.localeCompare(right.provider.manifest.providerId);
}

function candidateSummary(provider: VeilProvider, quote: ProviderQuote, intent: VeilIntent, policy: RouterPolicy): RouteCandidateSummary {
  return {
    providerId: quote.providerId,
    providerVersion: quote.providerVersion,
    quoteId: quote.quoteId,
    exposure: quote.exposure,
    estimatedFeeBaseUnits: quote.estimatedFeeBaseUnits.toString(),
    estimatedLatencyMs: quote.estimatedLatencyMs,
    providerPlanCommitment: quote.providerPlanCommitment,
    score: scoreRoute(provider.manifest, quote, intent, policy),
  };
}

export class VeilRouter {
  private readonly healthRecords = new Map<string, ProviderHealthRecord>();
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly policy: RouterPolicy,
  ) {
    assertRouterPolicyValid(policy);
  }

  getProviderHealth(): ProviderHealthRecord[] {
    return structuredClone([...this.healthRecords.values()]);
  }

  private async checkHealth(provider: VeilProvider, intent: VeilIntent): Promise<ProviderHealthRecord> {
    const id = provider.manifest.providerId;
    let result: ProviderHealthCheck;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      result = await Promise.race([
        provider.healthCheck(structuredClone(intent)),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("health timeout")), 5000); }),
      ]);
      if (!result || !["HEALTHY", "DEGRADED", "UNAVAILABLE"].includes(result.health)) {
        result = { health: "UNAVAILABLE", proverReady: false, errorCode: "INVALID_HEALTH_RESPONSE" };
      }
      const code = healthErrorCode({code: result.errorCode});
      if (code === "STALE_ROOT" || code === "INDEXER_UNAVAILABLE") {
        result = { health: "DEGRADED", proverReady: false, errorCode: code };
      } else if (result.health === "HEALTHY" && result.proverReady !== true) {
        result = { health: "DEGRADED", proverReady: false, errorCode: "PROVER_NOT_READY" };
      }
    } catch (error) {
      const code = healthErrorCode(error);
      result = { health: code === "HEALTH_CHECK_FAILED" ? "UNAVAILABLE" : "DEGRADED", proverReady: false, errorCode: code };
    } finally { if (timer) clearTimeout(timer); }
    const timestamp = Date.now();
    const allowedCodes = ["STALE_ROOT", "INDEXER_UNAVAILABLE", "HEALTH_CHECK_FAILED", "INVALID_HEALTH_RESPONSE", "PROVER_NOT_READY", "READINESS_EXPIRED", "NETWORK_UNAVAILABLE"];
    const record: ProviderHealthRecord = {
      provider: id, health: result.health, proverReady: result.health === "HEALTHY" && result.proverReady === true,
      errorCode: result.errorCode ? (allowedCodes.includes(result.errorCode) ? result.errorCode : "HEALTH_CHECK_FAILED") : "NONE",
      timestamp, lastSuccessfulCheck: result.health === "HEALTHY" ? timestamp : this.healthRecords.get(id)?.lastSuccessfulCheck ?? null,
    };
    this.healthRecords.set(id, record);
    return record;
  }

  async assertHealthy(prepared: PreparedRoute): Promise<void> {
    const provider = this.registry.get(prepared.plan.selectedProviderId);
    if (!provider || (await this.checkHealth(provider, prepared.intent)).health !== "HEALTHY") throw new NoPrivacyRouteError();
  }

  async prepare(intent: VeilIntent, nowMs = Date.now()): Promise<PreparedRoute> {
    intent = structuredClone(intent);
    assertIntentBasics(intent, this.policy, nowMs);
    const intentHash = await hashIntent(intent);
    const policyHash = await hashPolicy(this.policy);
    const catalogHash = await this.getCatalogHash();
    const eligible: EligibleRoute[] = [];
    const rejections: RouteRejection[] = [];
    const reject = (provider: VeilProvider, reason: string): void => {
      rejections.push({
        providerId: provider.manifest.providerId,
        providerVersion: provider.manifest.providerVersion,
        reason,
      });
    };

    for (const provider of this.registry.list()) {
      const manifest = provider.manifest;
      const manifestAllowed = providerAllowedByPolicy(manifest, intent, this.policy);
      if (!manifestAllowed.allowed) {
        reject(provider, manifestAllowed.reason ?? "manifest_policy_rejected");
        continue;
      }

      const exposure = manifest.exposureByOperation[intent.operation];
      if (!exposure || !satisfiesPrivacyRequirements(intent.privacy, exposure)) {
        reject(provider, "privacy_requirements_not_met");
        continue;
      }
      const health = await this.checkHealth(provider, intent);
      if (health.health !== "HEALTHY") {
        reject(provider, health.errorCode === "HEALTH_CHECK_FAILED" ? "health_check_failed" : "provider_unhealthy");
        continue;
      }

      let quote: ProviderQuote;
      try {
        quote = structuredClone(await provider.quote(structuredClone(intent)));
      } catch {
        reject(provider, "quote_failed");
        continue;
      }
      if (
        quote.providerId !== manifest.providerId ||
        quote.providerVersion !== manifest.providerVersion
      ) {
        reject(provider, "quote_identity_mismatch");
        continue;
      }

      const maxExposure = manifest.exposureByOperation[intent.operation];
      if (!maxExposure) {
        reject(provider, "missing_exposure_profile");
        continue;
      }
      if (!quoteDoesNotOverclaim(maxExposure, quote.exposure)) {
        reject(provider, "quote_overclaims_privacy");
        continue;
      }

      const quoteAllowed = quoteAllowedByPolicy(quote, intent, this.policy, nowMs);
      if (!quoteAllowed.allowed) {
        reject(provider, quoteAllowed.reason ?? "quote_policy_rejected");
        continue;
      }
      if (!satisfiesPrivacyRequirements(intent.privacy, quote.exposure)) {
        reject(provider, "privacy_requirements_not_met");
        continue;
      }
      if (privacyScore(quote.exposure) < this.policy.minPrivacyScore) {
        reject(provider, "privacy_score_below_policy");
        continue;
      }

      eligible.push({
        provider,
        quote,
        summary: candidateSummary(provider, quote, intent, this.policy),
      });
    }

    if (eligible.length === 0) {
      throw new NoPrivacyRouteError();
    }
    eligible.sort(compareEligible);
    // Quotes may await external services. Recheck the winner immediately before
    // committing a plan; fallback is allowed only among already-compatible routes.
    while (eligible.length > 0) {
      const next = eligible[0]!;
      if ((await this.checkHealth(next.provider, intent)).health === "HEALTHY") break;
      reject(next.provider, "provider_unhealthy");
      eligible.shift();
    }
    const selected = eligible[0];
    if (!selected) throw new NoPrivacyRouteError();

    const expiresAtMs = Math.min(intent.expiresAtMs, selected.quote.validUntilMs);
    const withoutHash: Omit<RoutePlan, "routePlanHash"> = {
      version: 1,
      intentHash,
      policyHash,
      catalogHash,
      selectedProviderId: selected.provider.manifest.providerId,
      selectedProviderVersion: selected.provider.manifest.providerVersion,
      selectedQuoteId: selected.quote.quoteId,
      selectedProviderPlanCommitment: selected.quote.providerPlanCommitment,
      selectedExposure: selected.quote.exposure,
      selectedFeeBaseUnits: selected.quote.estimatedFeeBaseUnits.toString(),
      selectedLatencyMs: selected.quote.estimatedLatencyMs,
      selectedScore: selected.summary.score,
      candidates: eligible.map(item => item.summary),
      rejections,
      createdAtMs: nowMs,
      expiresAtMs,
    };

    const routePlanHash = await hashRoutePlan(withoutHash);
    return {
      intent,
      intentHash,
      selectedQuote: selected.quote,
      plan: { ...withoutHash, routePlanHash },
    };
  }

  verifySemantics(prepared: PreparedRoute): Promise<boolean> {
    return verifyRoutePlanSemantics(prepared, this.policy, this.registry);
  }

  getProvider(providerId: string): VeilProvider | undefined {
    return this.registry.get(providerId);
  }

  getCatalogHash(): Promise<string> {
    return hashProviderCatalog(this.registry.list().map(provider => provider.manifest));
  }
}

export async function verifyRoutePlanIntegrity(
  prepared: PreparedRoute,
  policy: RouterPolicy,
  expectedCatalogHash?: string,
): Promise<boolean> {
  const expectedIntentHash = await hashIntent(prepared.intent);
  if (prepared.intentHash !== expectedIntentHash) return false;
  if (prepared.plan.intentHash !== expectedIntentHash) return false;

  const expectedPolicyHash = await hashPolicy(policy);
  if (prepared.plan.policyHash !== expectedPolicyHash) return false;
  if (expectedCatalogHash !== undefined && prepared.plan.catalogHash !== expectedCatalogHash) return false;

  const { routePlanHash, ...withoutHash } = prepared.plan;
  const expectedRouteHash = await hashRoutePlan(withoutHash);
  if (routePlanHash !== expectedRouteHash) return false;

  if (prepared.plan.selectedProviderId !== prepared.selectedQuote.providerId) return false;
  if (prepared.plan.selectedProviderVersion !== prepared.selectedQuote.providerVersion) return false;
  if (prepared.plan.selectedQuoteId !== prepared.selectedQuote.quoteId) return false;
  const quote = prepared.selectedQuote;
  const plan = prepared.plan;
  if (!quoteAllowedByPolicy(quote, prepared.intent, policy, plan.createdAtMs).allowed) return false;
  if (plan.expiresAtMs !== Math.min(prepared.intent.expiresAtMs, quote.validUntilMs)) return false;
  if (plan.selectedFeeBaseUnits !== quote.estimatedFeeBaseUnits.toString()) return false;
  if (plan.selectedLatencyMs !== quote.estimatedLatencyMs) return false;
  if (canonicalExposure(plan.selectedExposure) !== canonicalExposure(quote.exposure)) return false;
  if (
    prepared.plan.selectedProviderPlanCommitment !==
    prepared.selectedQuote.providerPlanCommitment
  ) return false;

  const sorted = [...prepared.plan.candidates].sort((a, b) => {
    if (b.score.total !== a.score.total) return b.score.total - a.score.total;
    const af = BigInt(a.estimatedFeeBaseUnits);
    const bf = BigInt(b.estimatedFeeBaseUnits);
    if (af !== bf) return af < bf ? -1 : 1;
    if (a.estimatedLatencyMs !== b.estimatedLatencyMs) {
      return a.estimatedLatencyMs - b.estimatedLatencyMs;
    }
    return a.providerId.localeCompare(b.providerId);
  });

  const winner = sorted[0];
  if (!winner) return false;
  return (
    winner.providerId === prepared.plan.selectedProviderId &&
    winner.providerVersion === prepared.plan.selectedProviderVersion &&
    winner.quoteId === prepared.plan.selectedQuoteId &&
    winner.providerPlanCommitment === plan.selectedProviderPlanCommitment &&
    winner.estimatedFeeBaseUnits === plan.selectedFeeBaseUnits &&
    winner.estimatedLatencyMs === plan.selectedLatencyMs &&
    canonicalExposure(winner.exposure) === canonicalExposure(plan.selectedExposure) &&
    scoreEqual(winner.score, plan.selectedScore)
  );
}


function scoreEqual(
  left: RouteCandidateSummary["score"],
  right: RouteCandidateSummary["score"],
): boolean {
  return (
    left.privacy === right.privacy &&
    left.keyIsolation === right.keyIsolation &&
    left.selfCustody === right.selfCustody &&
    left.readiness === right.readiness &&
    left.fees === right.fees &&
    left.latency === right.latency &&
    left.total === right.total
  );
}

/**
 * Recomputes route candidate policy/privacy semantics from the currently
 * registered provider manifests. This catches a locally tampered plan even if
 * an attacker recomputes its SHA-256 hash.
 *
 * It verifies every candidate present in the plan. It does not claim to prove
 * that an unavailable/unhealthy provider was not omitted at quote time.
 */
export async function verifyRoutePlanSemantics(
  prepared: PreparedRoute,
  policy: RouterPolicy,
  registry: ProviderRegistry,
): Promise<boolean> {
  if (!(await verifyRoutePlanIntegrity(prepared, policy))) return false;
  const currentCatalogHash = await hashProviderCatalog(
    registry.list().map(provider => provider.manifest),
  );
  if (prepared.plan.catalogHash !== currentCatalogHash) return false;

  const registered = registry.list().map(provider => provider.manifest.providerId).sort();
  const covered = [
    ...prepared.plan.candidates.map(candidate => candidate.providerId),
    ...prepared.plan.rejections.map(rejection => rejection.providerId),
  ].sort();
  if (new Set(covered).size !== covered.length) return false;
  if (registered.length !== covered.length) return false;
  if (registered.some((providerId, index) => providerId !== covered[index])) return false;

  for (const rejection of prepared.plan.rejections) {
    const provider = registry.get(rejection.providerId);
    if (!provider) return false;
    if (provider.manifest.providerVersion !== rejection.providerVersion) return false;
    if (!rejection.reason) return false;
  }

  for (const candidate of prepared.plan.candidates) {
    const provider = registry.get(candidate.providerId);
    if (!provider) return false;
    const manifest = provider.manifest;
    if (manifest.providerVersion !== candidate.providerVersion) return false;
    if (!providerAllowedByPolicy(manifest, prepared.intent, policy).allowed) return false;

    const manifestExposure = manifest.exposureByOperation[prepared.intent.operation];
    if (!manifestExposure) return false;
    if (!quoteDoesNotOverclaim(manifestExposure, candidate.exposure)) return false;
    if (!satisfiesPrivacyRequirements(prepared.intent.privacy, candidate.exposure)) return false;
    if (privacyScore(candidate.exposure) < policy.minPrivacyScore) return false;

    const fee = BigInt(candidate.estimatedFeeBaseUnits);
    if (fee < 0n || fee > prepared.intent.feeCeilingBaseUnits) return false;
    const walletMax = policy.maxFeeByAssetId?.[prepared.intent.asset.assetId];
    if (walletMax !== undefined && fee > walletMax) return false;

    const syntheticQuote: ProviderQuote = {
      providerId: candidate.providerId,
      providerVersion: candidate.providerVersion,
      quoteId: candidate.quoteId,
      validUntilMs: prepared.plan.expiresAtMs,
      exposure: candidate.exposure,
      estimatedFeeBaseUnits: fee,
      estimatedLatencyMs: candidate.estimatedLatencyMs,
      providerPlanCommitment: candidate.providerPlanCommitment,
      warnings: [],
    };
    const expectedScore = scoreRoute(manifest, syntheticQuote, prepared.intent, policy);
    if (!scoreEqual(expectedScore, candidate.score)) return false;
  }

  const sorted = [...prepared.plan.candidates].sort((a, b) => {
    if (b.score.total !== a.score.total) return b.score.total - a.score.total;
    const af = BigInt(a.estimatedFeeBaseUnits);
    const bf = BigInt(b.estimatedFeeBaseUnits);
    if (af !== bf) return af < bf ? -1 : 1;
    if (a.estimatedLatencyMs !== b.estimatedLatencyMs) {
      return a.estimatedLatencyMs - b.estimatedLatencyMs;
    }
    return a.providerId.localeCompare(b.providerId);
  });
  const winner = sorted[0];
  if (!winner) return false;
  return (
    winner.providerId === prepared.plan.selectedProviderId &&
    winner.providerVersion === prepared.plan.selectedProviderVersion &&
    winner.quoteId === prepared.plan.selectedQuoteId &&
    winner.providerPlanCommitment === prepared.plan.selectedProviderPlanCommitment
  );
}

export async function assertRoutePlanIntegrity(
  prepared: PreparedRoute,
  policy: RouterPolicy,
  expectedCatalogHash?: string,
): Promise<void> {
  if (!(await verifyRoutePlanIntegrity(prepared, policy, expectedCatalogHash))) {
    throw new RouteIntegrityError();
  }
}
