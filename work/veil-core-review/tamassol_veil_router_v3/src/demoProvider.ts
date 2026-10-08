import { sha256Hex } from "./crypto.js";
import type { VeilProvider } from "./provider.js";
import type { ProviderHealthCheck } from "./health.js";
import type {
  ExposureProfile,
  ProviderExecutionContext,
  ProviderExecutionResult,
  ProviderManifest,
  ProviderQuote,
  VeilIntent,
} from "./types.js";

export interface DemoProviderConfig {
  providerId: string;
  providerVersion?: string;
  displayName?: string;
  exposure: ExposureProfile;
  feeBaseUnits: bigint;
  latencyMs: number;
  release?: "demo";
  hardwareKeyIsolation?: ProviderManifest["hardwareKeyIsolation"];
  selfCustodial?: boolean;
  secretStateModel?: ProviderManifest["secretStateModel"];
}

export class DeterministicDemoProvider implements VeilProvider {
  readonly manifest: ProviderManifest;

  constructor(private readonly config: DemoProviderConfig) {
    if (config.release !== undefined && config.release !== "demo") {
      throw new Error("Demo providers cannot be labeled as real integrations.");
    }
    const version = config.providerVersion ?? "1.0.0-demo";
    this.manifest = {
      providerId: config.providerId,
      providerVersion: version,
      displayName: config.displayName ?? config.providerId,
      release: "demo",
      networks: ["devnet"],
      operations: ["shield", "private_transfer", "unshield", "private_swap"],
      supportedAssetIds: "dynamic",
      hardwareKeyIsolation: config.hardwareKeyIsolation ?? "compatible",
      selfCustodial: config.selfCustodial ?? true,
      secretStateModel: config.secretStateModel ?? "none",
      exposureByOperation: {
        shield: config.exposure,
        private_transfer: config.exposure,
        unshield: config.exposure,
        private_swap: config.exposure,
      },
    };
  }

  async healthCheck(): Promise<ProviderHealthCheck> {
    return { health: "HEALTHY", proverReady: true };
  }

  async quote(intent: VeilIntent): Promise<ProviderQuote> {
    const providerPlanCommitment = await sha256Hex(
      [
        this.manifest.providerId,
        this.manifest.providerVersion,
        intent.requestId,
        intent.operation,
        intent.asset.assetId,
        intent.amountBaseUnits.toString(),
        this.config.feeBaseUnits.toString(),
      ].join("|"),
    );
    return {
      providerId: this.manifest.providerId,
      providerVersion: this.manifest.providerVersion,
      quoteId: await sha256Hex(`${intent.requestId}:${providerPlanCommitment}`),
      validUntilMs: Math.min(intent.expiresAtMs, Date.now() + 60_000),
      exposure: this.config.exposure,
      estimatedFeeBaseUnits: this.config.feeBaseUnits,
      estimatedLatencyMs: this.config.latencyMs,
      providerPlanCommitment,
      warnings: ["Demo provider: no blockchain transaction is submitted."],
      providerContext: { demo: true },
    };
  }

  async execute(
    intent: VeilIntent,
    quote: ProviderQuote,
    context: ProviderExecutionContext,
  ): Promise<ProviderExecutionResult> {
    context.onProgress?.("proving");
    context.onProgress?.("relaying");
    context.onProgress?.("confirming");
    const chainSignature = `DEMO_${(await sha256Hex(context.routePlan.routePlanHash)).slice(0, 32)}`;
    return {
      ok: true,
      providerId: this.manifest.providerId,
      providerVersion: this.manifest.providerVersion,
      completedAtMs: Date.now(),
      actualExposure: quote.exposure,
      chainSignature,
      providerEvidence: JSON.stringify({
        mode: "demo",
        quoteId: quote.quoteId,
        routePlanHash: context.routePlan.routePlanHash,
        requestId: intent.requestId,
      }),
      secretStateCommitted: true,
      safeMessage: "Demo execution completed.",
    };
  }
}
