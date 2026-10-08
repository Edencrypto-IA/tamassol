import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  DriverBackedVeilProvider,
  hashIntent,
} from "../veil-core-review/tamassol_veil_router_v3/dist/index.js";

export const LOCALNET_EXPOSURE = Object.freeze({
  sender: "public",
  recipient: "public",
  asset: "hidden",
  amount: "hidden",
  history: "unknown",
  note: "Local Zolana validation: amount and asset confidential; no sender, recipient, or history anonymity claim.",
});

export const LOCALNET_POLICY = Object.freeze({
  version: 1,
  enabledProviderIds: ["zolana-localnet"],
  allowedAssetIds: ["SOL"],
  allowDemoProviders: false,
  allowExperimentalProviders: true,
  requireSelfCustody: true,
  requireHardwareKeyIsolation: "off",
  requireHardwareApproval: false,
  minPrivacyScore: 0,
  maxQuoteAgeMs: 600_000,
  maxIntentAgeMs: 600_000,
  maxClockSkewMs: 5_000,
  maxFeeByAssetId: { SOL: 100_000n },
});

const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function createLocalnetProvider(transport) {
  const issued = new Map();

  const manifest = {
    providerId: "zolana-localnet",
    providerVersion: "0.1.0-localnet",
    displayName: "Zolana localnet",
    release: "experimental",
    networks: ["localnet"],
    operations: ["private_transfer"],
    supportedAssetIds: ["SOL"],
    hardwareKeyIsolation: "incompatible",
    selfCustodial: true,
    secretStateModel: "wallet_derived",
    exposureByOperation: {
      private_transfer: { ...LOCALNET_EXPOSURE },
    },
  };

  const driver = {
    async healthCheck(intent) {
      if (intent && intent.network !== "localnet") {
        return {
          health: "UNAVAILABLE",
          proverReady: false,
          errorCode: "NETWORK_UNAVAILABLE",
        };
      }
      return transport.checkReadiness();
    },

    async quote(intent) {
      assert.equal(intent.network, "localnet");
      assert.equal(intent.operation, "private_transfer");
      assert.equal(intent.asset.assetId, "SOL");
      assert.equal(intent.asset.decimals, 9);
      assert.equal(intent.recipient?.kind, "solana");
      assert.equal(intent.recipient.address, transport.recipientAddress);
      assert(intent.amountBaseUnits > 0n);
      assert(intent.amountBaseUnits <= 3_000_000n, "Localnet validation amount cap");

      const intentHash = await hashIntent(intent);
      const quoteId = digest(randomUUID());
      const validUntilMs = Math.min(intent.expiresAtMs, Date.now() + 600_000);
      const providerPlanCommitment = digest({
        domain: "TAMASSOL_ZOLANA_LOCALNET_V1",
        intentHash,
        quoteId,
        validUntilMs,
        sender: transport.senderAddress,
        recipient: transport.recipientAddress,
        exposure: LOCALNET_EXPOSURE,
      });

      const quote = {
        quoteId,
        validUntilMs,
        exposure: { ...LOCALNET_EXPOSURE },
        estimatedFeeBaseUnits: 100_000n,
        estimatedLatencyMs: 30_000,
        providerPlanCommitment,
        warnings: [
          "LOCALNET ONLY. This is not Devnet or Mainnet evidence.",
          "Solana transaction signer remains in the local test process.",
        ],
      };

      issued.set(quoteId, {
        intentHash,
        quote: structuredClone(quote),
      });
      return quote;
    },

    async execute(intent, quote, context) {
      const original = issued.get(quote.quoteId);
      assert(original, "Unknown or consumed quote");
      assert.equal(await hashIntent(intent), original.intentHash);
      assert.equal(context.routePlan.intentHash, original.intentHash);
      assert.equal(
        context.routePlan.selectedProviderPlanCommitment,
        quote.providerPlanCommitment,
      );
      assert.equal(context.routePlan.selectedProviderId, manifest.providerId);
      issued.delete(quote.quoteId);

      const result = await transport.execute(
        structuredClone(intent),
        structuredClone(context.routePlan),
      );

      assert.equal(result.network, "localnet");
      assert.equal(
        result.verifiedAmountBaseUnits,
        intent.amountBaseUnits.toString(),
      );
      assert(["confirmed", "finalized"].includes(result.confirmation));

      return {
        ok: true,
        completedAtMs: Date.now(),
        actualExposure: { ...LOCALNET_EXPOSURE },
        chainSignature: result.signature,
        providerEvidence: JSON.stringify(result),
        secretStateCommitted: true,
      };
    },
  };

  return new DriverBackedVeilProvider(manifest, driver);
}
