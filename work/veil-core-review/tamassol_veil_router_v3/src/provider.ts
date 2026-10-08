import type {
  ProviderExecutionContext,
  ProviderExecutionResult,
  ProviderManifest,
  ProviderQuote,
  VeilIntent,
} from "./types.js";
import type { ProviderHealthCheck } from "./health.js";

export interface VeilProvider {
  readonly manifest: ProviderManifest;

  healthCheck(intent?: VeilIntent): Promise<ProviderHealthCheck>;
  quote(intent: VeilIntent): Promise<ProviderQuote>;
  execute(
    intent: VeilIntent,
    quote: ProviderQuote,
    context: ProviderExecutionContext,
  ): Promise<ProviderExecutionResult>;
}

export class ProviderRegistry {
  private readonly providers = new Map<string, VeilProvider>();

  register(provider: VeilProvider): void {
    const id = provider.manifest.providerId;
    if (this.providers.has(id)) {
      throw new Error(`Provider already registered: ${id}`);
    }
    this.providers.set(id, provider);
  }

  get(providerId: string): VeilProvider | undefined {
    return this.providers.get(providerId);
  }

  list(): VeilProvider[] {
    return [...this.providers.values()].sort((a, b) =>
      a.manifest.providerId.localeCompare(b.manifest.providerId),
    );
  }
}
