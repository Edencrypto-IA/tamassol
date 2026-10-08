import type { VeilProvider } from "./provider.js";
import type { ProviderHealthCheck } from "./health.js";
import type {
  ProviderExecutionContext,
  ProviderExecutionResult,
  ProviderManifest,
  ProviderQuote,
  VeilIntent,
} from "./types.js";

/**
 * Thin seam for real protocol integrations. The Veil core owns routing,
 * policy, hardware approval, anti-downgrade checks and receipts. A protocol
 * driver only has to produce a truthful quote and execute the approved plan.
 */
export interface ExternalPrivacyDriver {
  healthCheck(intent?: VeilIntent): Promise<ProviderHealthCheck>;
  quote(intent: VeilIntent): Promise<Omit<ProviderQuote, "providerId" | "providerVersion">>;
  execute(
    intent: VeilIntent,
    quote: ProviderQuote,
    context: ProviderExecutionContext,
  ): Promise<Omit<ProviderExecutionResult, "providerId" | "providerVersion">>;
}

export class DriverBackedVeilProvider implements VeilProvider {
  constructor(
    public readonly manifest: ProviderManifest,
    private readonly driver: ExternalPrivacyDriver,
  ) {}

  healthCheck(intent?: VeilIntent): Promise<ProviderHealthCheck> {
    return this.driver.healthCheck(intent);
  }

  async quote(intent: VeilIntent): Promise<ProviderQuote> {
    const quote = await this.driver.quote(intent);
    return {
      providerId: this.manifest.providerId,
      providerVersion: this.manifest.providerVersion,
      ...quote,
    };
  }

  async execute(
    intent: VeilIntent,
    quote: ProviderQuote,
    context: ProviderExecutionContext,
  ): Promise<ProviderExecutionResult> {
    const result = await this.driver.execute(intent, quote, context);
    return {
      providerId: this.manifest.providerId,
      providerVersion: this.manifest.providerVersion,
      ...result,
    };
  }
}
