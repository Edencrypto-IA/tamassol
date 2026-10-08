import test from "node:test";
import assert from "node:assert/strict";
import {
  VeilRouter,
  ProviderRegistry,
  createVeilIntent,
} from "../veil-core-review/tamassol_veil_router_v3/dist/index.js";
import {
  createLocalnetProvider,
  LOCALNET_POLICY,
} from "./localnet-provider.mjs";

const recipient = "J29y21XVkphcaW5mEzWMwz5CWkF6ZLzSfAs7Rip5XEfV";

function intent() {
  return createVeilIntent({
    network: "localnet",
    operation: "private_transfer",
    asset: { assetId: "SOL", symbol: "SOL", decimals: 9 },
    amountBaseUnits: 1_000_000n,
    recipient: { kind: "solana", address: recipient },
    privacy: {
      sender: "irrelevant",
      recipient: "irrelevant",
      asset: "required",
      amount: "required",
      history: "irrelevant",
    },
    feeCeilingBaseUnits: 100_000n,
    ttlMs: 120_000,
  });
}

test("localnet provider is selected only when ready", async () => {
  const registry = new ProviderRegistry();
  registry.register(
    createLocalnetProvider({
      senderAddress: "8zcPAg2tKBbKhSfpVWixuhcDCgvDnfNHxTZkqoXCWZVH",
      recipientAddress: recipient,
      checkReadiness: async () => ({
        health: "HEALTHY",
        proverReady: true,
        errorCode: "NONE",
      }),
      execute: async () => {
        throw new Error("not executed");
      },
    }),
  );
  const route = await new VeilRouter(registry, LOCALNET_POLICY).prepare(intent());
  assert.equal(route.plan.selectedProviderId, "zolana-localnet");
  assert.equal(route.intent.network, "localnet");
});

test("localnet provider fails closed if services are unavailable", async () => {
  const registry = new ProviderRegistry();
  registry.register(
    createLocalnetProvider({
      senderAddress: "8zcPAg2tKBbKhSfpVWixuhcDCgvDnfNHxTZkqoXCWZVH",
      recipientAddress: recipient,
      checkReadiness: async () => ({
        health: "UNAVAILABLE",
        proverReady: false,
        errorCode: "LOCALNET_SERVICE_UNAVAILABLE",
      }),
      execute: async () => {
        throw new Error("not executed");
      },
    }),
  );
  await assert.rejects(
    () => new VeilRouter(registry, LOCALNET_POLICY).prepare(intent()),
    { code: "NO_HEALTHY_PRIVACY_ROUTE" },
  );
});
