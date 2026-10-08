import {
  FULL_ANONYMITY,
  DeterministicDemoProvider,
  MemoryDeviceTrustStore,
  MemoryReplayGuard,
  ProviderRegistry,
  VeilEngine,
  VeilRouter,
  bytesToBase64,
  canonicalApprovalEnvelope,
  createDisclosureProof,
  createVeilIntent,
  utf8,
  verifyDisclosureProof,
  verifyPublicReceiptIntegrity,
} from "../dist/index.js";

const fullExposure = {
  sender: "hidden",
  recipient: "hidden",
  asset: "hidden",
  amount: "hidden",
  history: "conditional",
  note: "Demo anonymous provider.",
};
const paymentExposure = {
  sender: "hidden",
  recipient: "hidden",
  asset: "public",
  amount: "hidden",
  history: "conditional",
  note: "Demo payment-private provider.",
};
const amountExposure = {
  sender: "public",
  recipient: "public",
  asset: "public",
  amount: "hidden",
  history: "public",
  note: "Demo amount-confidential provider.",
};

const registry = new ProviderRegistry();
registry.register(new DeterministicDemoProvider({
  providerId: "demo-anonymous",
  displayName: "Anonymous ZK Demo",
  exposure: fullExposure,
  feeBaseUnits: 30_000n,
  latencyMs: 1_800,
}));
registry.register(new DeterministicDemoProvider({
  providerId: "demo-payment",
  displayName: "Payment Privacy Demo",
  exposure: paymentExposure,
  feeBaseUnits: 5_000n,
  latencyMs: 800,
}));
registry.register(new DeterministicDemoProvider({
  providerId: "demo-confidential",
  displayName: "Amount Confidential Demo",
  exposure: amountExposure,
  feeBaseUnits: 1_000n,
  latencyMs: 400,
}));

const policy = {
  version: 1,
  enabledProviderIds: "all",
  allowedAssetIds: ["SOL"],
  allowDemoProviders: true,
  allowExperimentalProviders: false,
  requireSelfCustody: true,
  requireHardwareKeyIsolation: "strict",
  requireHardwareApproval: true,
  minPrivacyScore: 0,
  maxQuoteAgeMs: 90_000,
  maxIntentAgeMs: 180_000,
  maxClockSkewMs: 30_000,
  maxFeeByAssetId: { SOL: 2_000_000n },
};

const pair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);
const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
const deviceId = "TAMASSOL-DEMO-001";
const trustStore = new MemoryDeviceTrustStore([{
  deviceId,
  algorithm: "ECDSA_P256_SHA256",
  publicKeySpkiBase64: bytesToBase64(spki),
  enabled: true,
}]);
const hardware = {
  async isConnected() { return true; },
  async requestApproval(envelope) {
    const signature = new Uint8Array(await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      pair.privateKey,
      utf8(canonicalApprovalEnvelope(envelope)),
    ));
    return {
      version: 3,
      deviceId,
      requestId: envelope.requestId,
      nonce: envelope.nonce,
      routePlanHash: envelope.routePlanHash,
      intentHash: envelope.intentHash,
      decision: "approved",
      approvedAtMs: Date.now(),
      algorithm: "ECDSA_P256_SHA256",
      signatureBase64: bytesToBase64(signature),
    };
  },
};

const intent = createVeilIntent({
  network: "devnet",
  operation: "private_transfer",
  asset: { symbol: "SOL", decimals: 9, assetId: "SOL" },
  amountBaseUnits: 25_000_000n,
  recipient: { kind: "solana", address: "11111111111111111111111111111111" },
  privacy: FULL_ANONYMITY,
  feeCeilingBaseUnits: 100_000n,
});

const router = new VeilRouter(registry, policy);
const engine = new VeilEngine(router, policy, new MemoryReplayGuard());
const prepared = await engine.prepare(intent);
const progress = [];
const outcome = await engine.execute(prepared, {
  hardware,
  trustStore,
  disclosureFields: {
    amountBaseUnits: intent.amountBaseUnits.toString(),
    recipient: intent.recipient.address,
  },
  onProgress: phase => progress.push(phase),
});

const amountSecret = outcome.disclosureSecrets.find(item => item.field === "amountBaseUnits");
const amountCommitment = outcome.receipt.disclosureCommitments.find(item => item.field === "amountBaseUnits");
const disclosureVerified = amountSecret && amountCommitment
  ? await verifyDisclosureProof(amountCommitment, createDisclosureProof(amountSecret))
  : false;

console.log(JSON.stringify({
  product: "TAMASSOL Veil Router v3",
  requestedPrivacy: intent.privacy,
  selectedProvider: prepared.plan.selectedProviderId,
  routeScore: prepared.plan.selectedScore,
  candidates: prepared.plan.candidates.map(candidate => ({
    provider: candidate.providerId,
    score: candidate.score.total,
    exposure: candidate.exposure,
  })),
  rejectedProviders: prepared.plan.rejections,
  hardwareApproved: outcome.approval?.decision === "approved",
  antiDowngradeBound: true,
  progress,
  receipt: {
    hash: outcome.receipt.receiptHash,
    privacyScore: outcome.receipt.privacyScore,
    integrityVerified: await verifyPublicReceiptIntegrity(outcome.receipt),
    selectiveDisclosureVerified: disclosureVerified,
  },
}, null, 2));
