import type {
  ProviderManifest,
  ProviderQuote,
  RouteScoreBreakdown,
  RouterPolicy,
  VeilIntent,
} from "./types.js";
import { requirementWeightedPrivacyFraction } from "./privacy.js";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function scoreRoute(
  manifest: ProviderManifest,
  quote: ProviderQuote,
  intent: VeilIntent,
  policy: RouterPolicy,
): RouteScoreBreakdown {
  const fulfillment = requirementWeightedPrivacyFraction(intent.privacy, quote.exposure);
  const privacy = round2(55 * fulfillment);

  const keyIsolation =
    policy.requireHardwareKeyIsolation === "off"
      ? 10
      : manifest.hardwareKeyIsolation === "compatible"
        ? 10
        : manifest.hardwareKeyIsolation === "conditional"
          ? 5
          : 0;

  const selfCustody = manifest.selfCustodial ? 10 : 0;

  const readiness =
    manifest.release === "production"
      ? 10
      : manifest.release === "devnet"
        ? intent.network === "devnet" ? 8 : 0
        : manifest.release === "experimental"
          ? 4
          : 1;

  const ceiling = intent.feeCeilingBaseUnits > 0n ? intent.feeCeilingBaseUnits : 1n;
  const fee = quote.estimatedFeeBaseUnits < 0n ? 0n : quote.estimatedFeeBaseUnits;
  const ratioBps = fee >= ceiling ? 10_000n : (fee * 10_000n) / ceiling;
  const fees = round2(Number(10_000n - ratioBps) / 1_000);

  const latencyRatio = clamp(quote.estimatedLatencyMs / 15_000, 0, 1);
  const latency = round2(5 * (1 - latencyRatio));

  const total = round2(privacy + keyIsolation + selfCustody + readiness + fees + latency);
  return {
    privacy,
    keyIsolation,
    selfCustody,
    readiness,
    fees,
    latency,
    total,
  };
}
