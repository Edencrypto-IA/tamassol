import { assertNoPrivacyDowngrade } from "./privacy.js";
import { assertRoutePlanIntegrity, VeilRouter } from "./router.js";
import {
  buildApprovalEnvelope,
  requestAndVerifyHardwareApproval,
  type DeviceTrustStore,
  type HardwareApprovalGateway,
} from "./hardware.js";
import type { ReplayGuard } from "./replay.js";
import { createDisclosureBundle, publicDisclosureCommitments } from "./disclosure.js";
import { createPublicReceipt } from "./receipt.js";
import { VeilError } from "./errors.js";
import type {
  DeviceApprovalProof,
  PreparedRoute,
  RouterPolicy,
  VeilExecutionOutcome,
  VeilIntent,
} from "./types.js";

export interface ExecuteOptions {
  hardware?: HardwareApprovalGateway;
  trustStore?: DeviceTrustStore;
  disclosureFields?: Record<string, string>;
  onProgress?: (phase: string) => void;
  /** Passed only to the selected provider after route approval. */
  transactionSigner?: import("./types.js").TamassolTransactionSigner;
  nowMs?: number;
}

export class VeilEngine {
  constructor(
    private readonly router: VeilRouter,
    private readonly policy: RouterPolicy,
    private readonly replayGuard: ReplayGuard,
  ) {}

  prepare(intent: VeilIntent, nowMs = Date.now()): Promise<PreparedRoute> {
    return this.router.prepare(intent, nowMs);
  }

  async execute(
    prepared: PreparedRoute,
    options: ExecuteOptions = {},
  ): Promise<VeilExecutionOutcome> {
    // Own the data across asynchronous approval; caller mutation must not alter it.
    prepared = structuredClone(prepared);
    const nowMs = options.nowMs ?? Date.now();
    await assertRoutePlanIntegrity(
      prepared,
      this.policy,
      await this.router.getCatalogHash(),
    );
    if (!(await this.router.verifySemantics(prepared))) {
      throw new VeilError(
        "ROUTE_SEMANTICS_INVALID",
        "Route plan no longer matches provider manifests or wallet policy.",
      );
    }

    if (prepared.plan.expiresAtMs <= nowMs || prepared.intent.expiresAtMs <= nowMs) {
      throw new VeilError("ROUTE_EXPIRED", "Prepared Veil route has expired.");
    }

    await this.replayGuard.assertFresh(
      prepared.intent.nonce,
      prepared.plan.expiresAtMs,
      nowMs,
    );

    await this.router.assertHealthy(prepared);
    let approval: DeviceApprovalProof | null = null;
    if (this.policy.requireHardwareApproval) {
      if (!options.hardware || !options.trustStore) {
        throw new VeilError(
          "HARDWARE_CONFIGURATION_REQUIRED",
          "Hardware gateway and device trust store are required by policy.",
        );
      }
      const envelope = buildApprovalEnvelope(prepared);
      approval = await requestAndVerifyHardwareApproval(
        options.hardware,
        options.trustStore,
        envelope,
      );
    }

    if (prepared.plan.expiresAtMs <= Date.now()) {
      throw new VeilError(
        "ROUTE_EXPIRED_AFTER_APPROVAL",
        "Route expired during hardware approval. Prepare it again.",
      );
    }

    // Approval awaits external code: revalidate the catalog before dispatch.
    await assertRoutePlanIntegrity(prepared, this.policy, await this.router.getCatalogHash());
    if (!(await this.router.verifySemantics(prepared))) {
      throw new VeilError("ROUTE_SEMANTICS_INVALID", "Route changed during approval.");
    }

    await this.router.assertHealthy(prepared);
    // Consume immediately before handing execution to the provider. Any retry
    // requires a fresh intent and a fresh physical approval.
    await this.replayGuard.consume(
      prepared.intent.nonce,
      prepared.plan.expiresAtMs,
      nowMs,
    );

    const provider = this.router.getProvider(prepared.plan.selectedProviderId);
    if (!provider) {
      throw new VeilError("PROVIDER_UNAVAILABLE", "Selected provider is no longer registered.");
    }

    const execution = await provider.execute(
      structuredClone(prepared.intent),
      structuredClone(prepared.selectedQuote),
      {
        routePlan: structuredClone(prepared.plan),
        approval,
        ...(options.transactionSigner ? { transactionSigner: options.transactionSigner } : {}),
        ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      },
    );

    if (!execution.ok) {
      throw new VeilError("PROVIDER_EXECUTION_FAILED", execution.safeMessage ?? "Privacy provider execution failed.");
    }
    if (
      execution.providerId !== prepared.plan.selectedProviderId ||
      execution.providerVersion !== prepared.plan.selectedProviderVersion
    ) {
      throw new VeilError("PROVIDER_IDENTITY_CHANGED", "Provider identity changed during execution.");
    }

    const completionNow = Date.now();
    if (
      !Number.isSafeInteger(execution.completedAtMs) ||
      execution.completedAtMs < prepared.plan.createdAtMs - this.policy.maxClockSkewMs ||
      execution.completedAtMs > completionNow + this.policy.maxClockSkewMs
    ) {
      throw new VeilError(
        "INVALID_COMPLETION_TIME",
        "Provider returned an invalid completion timestamp.",
      );
    }

    assertNoPrivacyDowngrade(prepared.intent.privacy, execution.actualExposure);

    if (
      provider.manifest.secretStateModel === "provider_notes" &&
      !execution.secretStateCommitted
    ) {
      throw new VeilError(
        "SECRET_STATE_NOT_COMMITTED",
        "Provider created spendable private state that was not durably committed.",
      );
    }

    const disclosureFields = options.disclosureFields ?? {};
    const disclosureSecrets = await createDisclosureBundle(disclosureFields);
    const receipt = await createPublicReceipt(
      prepared,
      execution,
      publicDisclosureCommitments(disclosureSecrets),
    );

    return {
      prepared,
      approval,
      execution,
      receipt,
      disclosureSecrets,
    };
  }
}
