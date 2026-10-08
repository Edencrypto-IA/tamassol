import test from "node:test";
import assert from "node:assert/strict";

import {
  AMOUNT_CONFIDENTIALITY,
  FULL_ANONYMITY,
  PUBLIC_SOLANA_EXPOSURE,
  comparePrivacy,
  PAYMENT_PRIVACY,
  DeterministicDemoProvider,
  MemoryDeviceTrustStore,
  MemoryReplayGuard,
  ProviderRegistry,
  VeilEngine,
  VeilRouter,
  assertNoPrivacyDowngrade,
  buildApprovalEnvelope,
  bytesToBase64,
  canonicalApprovalEnvelope,
  createDisclosureProof,
  createDisclosureSecret,
  createVeilIntent,
  hashIntent,
  hashRoutePlan,
  isValidSolanaAddress,
  privacyScore,
  quoteDoesNotOverclaim,
  sha256Hex,
  redactForLogs,
  utf8,
  verifyDisclosureProof,
  verifyDeviceApprovalProof,
  verifyPublicReceiptIntegrity,
  verifyRoutePlanIntegrity,
} from "../dist/index.js";

const SOL = { symbol: "SOL", decimals: 9, assetId: "SOL" };

test("review: demo cannot claim production readiness", () => {
  assert.throws(() => new DeterministicDemoProvider({
    providerId: "fake", exposure: FULL, feeBaseUnits: 1n,
    latencyMs: 1, release: "production",
  }), /cannot be labeled/);
});

test("review: replaced quote exposure is rejected", async () => {
  const setup = routerWith([provider("review", FULL)]);
  const prepared = await setup.router.prepare(intent());
  prepared.selectedQuote.exposure = { ...PUBLIC };
  assert.equal(await verifyRoutePlanIntegrity(prepared, setup.policy), false);
});

test("review: caller mutation during approval cannot change execution", async () => {
  const setup = routerWith([provider("review", FULL)], policy({ requireHardwareApproval: true }));
  const engine = new VeilEngine(setup.router, setup.policy, new MemoryReplayGuard());
  const prepared = await engine.prepare(intent());
  const hw = await makeSoftwareHardware();
  const original = hw.gateway.requestApproval.bind(hw.gateway);
  hw.gateway.requestApproval = async (envelope) => {
    prepared.intent.amountBaseUnits = 999n;
    prepared.selectedQuote.estimatedFeeBaseUnits = 999n;
    return original(envelope);
  };
  const result = await engine.execute(prepared, { hardware: hw.gateway, trustStore: hw.trust });
  assert.equal(result.prepared.intent.amountBaseUnits, 1_000_000n);
  assert.equal(result.prepared.selectedQuote.estimatedFeeBaseUnits, 10_000n);
});

test("review: provider cannot mutate receipt input through execution arguments", async () => {
  const p = provider("review", FULL);
  const original = p.execute.bind(p);
  p.execute = async (i, q, ctx) => {
    i.amountBaseUnits = 999n;
    ctx.routePlan.selectedFeeBaseUnits = "999";
    return original(i, q, ctx);
  };
  const setup = routerWith([p]);
  const engine = new VeilEngine(setup.router, setup.policy, new MemoryReplayGuard());
  const result = await engine.execute(await engine.prepare(intent()));
  assert.equal(result.prepared.intent.amountBaseUnits, 1_000_000n);
  assert.equal(result.prepared.plan.selectedFeeBaseUnits, "10000");
});

// Review regressions: these must reject before a provider is invoked.
for (const [field, value] of [
  ["estimatedFeeBaseUnits", 999_999n],
  ["estimatedLatencyMs", 9999],
  ["validUntilMs", 0],
]) {
  test(`review: rejects modified selected quote ${field}`, async () => {
    const p = provider("review", FULL);
    let executed = false;
    p.execute = async () => { executed = true; throw new Error("provider reached"); };
    const setup = routerWith([p]);
    const engine = new VeilEngine(setup.router, setup.policy, new MemoryReplayGuard());
    const prepared = await engine.prepare(intent());
    prepared.selectedQuote[field] = value;
    await assert.rejects(() => engine.execute(prepared));
    assert.equal(executed, false);
  });
}

test("review: rejects rehashed selected fee inconsistent with winner", async () => {
  const setup = routerWith([provider("review", FULL)]);
  const prepared = await setup.router.prepare(intent());
  prepared.plan.selectedFeeBaseUnits = "1";
  const { routePlanHash, ...rest } = prepared.plan;
  prepared.plan.routePlanHash = await hashRoutePlan(rest);
  assert.equal(await verifyRoutePlanIntegrity(prepared, setup.policy), false);
});

test("review: rejects invalid quote expiry NaN", async () => {
  const p = provider("review", FULL);
  const original = p.quote.bind(p);
  p.quote = async (i) => ({ ...await original(i), validUntilMs: NaN });
  const setup = routerWith([p]);
  await assert.rejects(() => setup.router.prepare(intent()));
});
const RECIPIENT = "11111111111111111111111111111111";

const FULL = {
  sender: "hidden",
  recipient: "hidden",
  asset: "hidden",
  amount: "hidden",
  history: "conditional",
  note: "Full private route with public boundary caveat.",
};

const PAYMENT = {
  sender: "hidden",
  recipient: "hidden",
  asset: "public",
  amount: "hidden",
  history: "conditional",
  note: "Payment privacy; asset remains visible.",
};

const AMOUNT_ONLY = {
  sender: "public",
  recipient: "public",
  asset: "public",
  amount: "hidden",
  history: "public",
  note: "Amount confidentiality only.",
};

const PUBLIC = {
  sender: "public",
  recipient: "public",
  asset: "public",
  amount: "public",
  history: "public",
  note: "Public transfer.",
};

function policy(overrides = {}) {
  return {
    version: 1,
    enabledProviderIds: "all",
    allowedAssetIds: ["SOL"],
    allowDemoProviders: true,
    allowExperimentalProviders: false,
    requireSelfCustody: true,
    requireHardwareKeyIsolation: "strict",
    requireHardwareApproval: false,
    minPrivacyScore: 0,
    maxQuoteAgeMs: 90_000,
    maxIntentAgeMs: 180_000,
    maxClockSkewMs: 30_000,
    maxFeeByAssetId: { SOL: 5_000_000n },
    ...overrides,
  };
}

function intent(privacy = FULL_ANONYMITY, overrides = {}) {
  return createVeilIntent({
    network: "devnet",
    operation: "private_transfer",
    asset: SOL,
    amountBaseUnits: 1_000_000n,
    recipient: { kind: "solana", address: RECIPIENT },
    privacy,
    feeCeilingBaseUnits: 100_000n,
    ttlMs: 120_000,
    ...overrides,
  });
}

function provider(id, exposure, fee = 10_000n, latency = 1_000) {
  return new DeterministicDemoProvider({
    providerId: id,
    exposure,
    feeBaseUnits: fee,
    latencyMs: latency,
  });
}

function routerWith(providers, p = policy()) {
  const registry = new ProviderRegistry();
  for (const item of providers) registry.register(item);
  return { router: new VeilRouter(registry, p), registry, policy: p };
}

async function makeSoftwareHardware(deviceId = "test-device") {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  const trust = new MemoryDeviceTrustStore([{
    deviceId,
    algorithm: "ECDSA_P256_SHA256",
    publicKeySpkiBase64: bytesToBase64(spki),
    enabled: true,
  }]);
  const gateway = {
    async isConnected() { return true; },
    async requestApproval(envelope) {
      const sig = new Uint8Array(await crypto.subtle.sign(
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
        signatureBase64: bytesToBase64(sig),
      };
    },
  };
  return { gateway, trust, pair };
}

test("privacy score is 100 for fully hidden exposure", () => {
  assert.equal(privacyScore({ ...FULL, history: "hidden" }), 100);
});

test("privacy score reflects amount-only confidentiality", () => {
  assert.equal(privacyScore(AMOUNT_ONLY), 25);
});

test("full anonymity routes only to a provider hiding asset too", async () => {
  const { router } = routerWith([
    provider("payment-private", PAYMENT, 1_000n),
    provider("full-private", FULL, 50_000n),
  ]);
  const prepared = await router.prepare(intent(FULL_ANONYMITY));
  assert.equal(prepared.plan.selectedProviderId, "full-private");
});

test("payment privacy can choose cheaper provider when asset privacy is irrelevant", async () => {
  const { router } = routerWith([
    provider("payment-private", PAYMENT, 1_000n, 500),
    provider("full-private", FULL, 80_000n, 2_000),
  ]);
  const prepared = await router.prepare(intent(PAYMENT_PRIVACY));
  assert.equal(prepared.plan.selectedProviderId, "payment-private");
});

test("amount confidentiality can use amount-only provider", async () => {
  const { router } = routerWith([
    provider("amount", AMOUNT_ONLY, 100n, 300),
    provider("full", FULL, 80_000n, 2_000),
  ]);
  const prepared = await router.prepare(intent(AMOUNT_CONFIDENTIALITY));
  assert.equal(prepared.plan.selectedProviderId, "amount");
});

test("router rejects silent privacy downgrade", async () => {
  const { router } = routerWith([provider("public", PUBLIC)]);
  await assert.rejects(() => router.prepare(intent(FULL_ANONYMITY)), {code:'NO_HEALTHY_PRIVACY_ROUTE'});
});

test("required privacy downgrade assertion rejects public recipient", () => {
  assert.throws(
    () => assertNoPrivacyDowngrade(FULL_ANONYMITY, PAYMENT),
    /asset/i,
  );
});

test("manifest prevents provider quote from overclaiming privacy", () => {
  assert.equal(quoteDoesNotOverclaim(PUBLIC, FULL), false);
  assert.equal(quoteDoesNotOverclaim(FULL, PAYMENT), true);
});

test("fee ceiling removes expensive route", async () => {
  const { router } = routerWith([
    provider("too-expensive", FULL, 200_000n),
    provider("fits", FULL, 50_000n),
  ]);
  const prepared = await router.prepare(intent(FULL_ANONYMITY));
  assert.equal(prepared.plan.selectedProviderId, "fits");
});

test("provider order does not change deterministic routing result", async () => {
  const a = provider("alpha", FULL, 10_000n, 1_000);
  const b = provider("beta", FULL, 10_000n, 1_000);
  const route1 = await routerWith([b, a]).router.prepare(intent(FULL_ANONYMITY));
  const route2 = await routerWith([a, b]).router.prepare(intent(FULL_ANONYMITY));
  assert.equal(route1.plan.selectedProviderId, "alpha");
  assert.equal(route2.plan.selectedProviderId, "alpha");
});

test("route plan integrity validates untouched plan", async () => {
  const p = policy();
  const { router } = routerWith([provider("full", FULL)], p);
  const prepared = await router.prepare(intent(FULL_ANONYMITY));
  assert.equal(await verifyRoutePlanIntegrity(prepared, p), true);
});

test("route plan integrity detects selected fee tampering", async () => {
  const p = policy();
  const { router } = routerWith([provider("full", FULL)], p);
  const prepared = await router.prepare(intent(FULL_ANONYMITY));
  const tampered = structuredClone(prepared);
  tampered.plan.selectedFeeBaseUnits = "1";
  assert.equal(await verifyRoutePlanIntegrity(tampered, p), false);
});

test("route plan integrity detects candidate score tampering", async () => {
  const p = policy();
  const { router } = routerWith([provider("a", FULL), provider("b", FULL)], p);
  const prepared = await router.prepare(intent(FULL_ANONYMITY));
  const tampered = structuredClone(prepared);
  tampered.plan.candidates[0].score.total += 1;
  assert.equal(await verifyRoutePlanIntegrity(tampered, p), false);
});

test("intent hash changes when recipient changes", async () => {
  const first = intent(FULL_ANONYMITY);
  const second = { ...first, recipient: { kind: "solana", address: "So11111111111111111111111111111111111111112" } };
  assert.notEqual(await hashIntent(first), await hashIntent(second));
});

test("intent hash changes when privacy requirement changes", async () => {
  const first = intent(FULL_ANONYMITY);
  const second = { ...first, privacy: PAYMENT_PRIVACY };
  assert.notEqual(await hashIntent(first), await hashIntent(second));
});

test("intent hash changes when fee ceiling changes", async () => {
  const first = intent(FULL_ANONYMITY);
  const second = { ...first, feeCeilingBaseUnits: first.feeCeilingBaseUnits + 1n };
  assert.notEqual(await hashIntent(first), await hashIntent(second));
});

test("P-256 hardware approval verifies", async () => {
  const p = policy({ requireHardwareApproval: true });
  const { router } = routerWith([provider("full", FULL)], p);
  const prepared = await router.prepare(intent(FULL_ANONYMITY));
  const envelope = buildApprovalEnvelope(prepared);
  const { gateway, trust } = await makeSoftwareHardware();
  const proof = await gateway.requestApproval(envelope);
  assert.equal(await verifyDeviceApprovalProof(envelope, proof, trust), true);
});

test("hardware proof fails after route plan tampering", async () => {
  const p = policy({ requireHardwareApproval: true });
  const { router } = routerWith([provider("full", FULL)], p);
  const prepared = await router.prepare(intent(FULL_ANONYMITY));
  const envelope = buildApprovalEnvelope(prepared);
  const { gateway, trust } = await makeSoftwareHardware();
  const proof = await gateway.requestApproval(envelope);
  const changed = { ...envelope, routePlanHash: "00".repeat(32) };
  assert.equal(await verifyDeviceApprovalProof(changed, proof, trust), false);
});

test("hardware proof from unknown device fails", async () => {
  const p = policy({ requireHardwareApproval: true });
  const { router } = routerWith([provider("full", FULL)], p);
  const prepared = await router.prepare(intent(FULL_ANONYMITY));
  const envelope = buildApprovalEnvelope(prepared);
  const { gateway } = await makeSoftwareHardware("unknown");
  const proof = await gateway.requestApproval(envelope);
  assert.equal(await verifyDeviceApprovalProof(envelope, proof, new MemoryDeviceTrustStore()), false);
});

test("engine executes with verified hardware and creates receipt", async () => {
  const p = policy({ requireHardwareApproval: true });
  const { router } = routerWith([provider("full", FULL)], p);
  const engine = new VeilEngine(router, p, new MemoryReplayGuard());
  const prepared = await engine.prepare(intent(FULL_ANONYMITY));
  const { gateway, trust } = await makeSoftwareHardware();
  const outcome = await engine.execute(prepared, {
    hardware: gateway,
    trustStore: trust,
    disclosureFields: {
      amountBaseUnits: prepared.intent.amountBaseUnits.toString(),
      recipient: RECIPIENT,
    },
  });
  assert.equal(outcome.execution.ok, true);
  assert.equal(await verifyPublicReceiptIntegrity(outcome.receipt), true);
  assert.equal(outcome.receipt.disclosureCommitments.length, 2);
});

test("replay guard prevents executing same approved route twice", async () => {
  const p = policy({ requireHardwareApproval: true });
  const { router } = routerWith([provider("full", FULL)], p);
  const engine = new VeilEngine(router, p, new MemoryReplayGuard());
  const prepared = await engine.prepare(intent(FULL_ANONYMITY));
  const { gateway, trust } = await makeSoftwareHardware();
  await engine.execute(prepared, { hardware: gateway, trustStore: trust });
  await assert.rejects(
    () => engine.execute(prepared, { hardware: gateway, trustStore: trust }),
    /already used/i,
  );
});

test("engine rejects provider that downgrades actual exposure after approval", async () => {
  const bad = provider("bad", FULL);
  bad.execute = async (i, q) => ({
    ok: true,
    providerId: bad.manifest.providerId,
    providerVersion: bad.manifest.providerVersion,
    completedAtMs: Date.now(),
    actualExposure: PAYMENT,
    providerEvidence: "downgraded",
    secretStateCommitted: true,
  });
  const p = policy();
  const { router } = routerWith([bad], p);
  const engine = new VeilEngine(router, p, new MemoryReplayGuard());
  const prepared = await engine.prepare(intent(FULL_ANONYMITY));
  await assert.rejects(() => engine.execute(prepared), /asset/i);
});

test("provider-note route cannot succeed before secret state is committed", async () => {
  const notes = new DeterministicDemoProvider({
    providerId: "notes",
    exposure: FULL,
    feeBaseUnits: 10n,
    latencyMs: 100,
    secretStateModel: "provider_notes",
  });
  notes.execute = async (_i, q) => ({
    ok: true,
    providerId: notes.manifest.providerId,
    providerVersion: notes.manifest.providerVersion,
    completedAtMs: Date.now(),
    actualExposure: q.exposure,
    providerEvidence: "not persisted",
    secretStateCommitted: false,
  });
  const p = policy();
  const { router } = routerWith([notes], p);
  const engine = new VeilEngine(router, p, new MemoryReplayGuard());
  const prepared = await engine.prepare(intent(FULL_ANONYMITY));
  await assert.rejects(() => engine.execute(prepared), /durably committed/i);
});

test("selective disclosure proof verifies without storing plaintext in receipt", async () => {
  const secret = await createDisclosureSecret("amountBaseUnits", "1000000");
  const commitment = { field: secret.field, commitment: secret.commitment };
  assert.equal(await verifyDisclosureProof(commitment, createDisclosureProof(secret)), true);
  assert.equal(await verifyDisclosureProof(commitment, { ...createDisclosureProof(secret), value: "999" }), false);
});

test("receipt integrity detects tampering", async () => {
  const p = policy();
  const { router } = routerWith([provider("full", FULL)], p);
  const engine = new VeilEngine(router, p, new MemoryReplayGuard());
  const prepared = await engine.prepare(intent(FULL_ANONYMITY));
  const outcome = await engine.execute(prepared);
  const tampered = structuredClone(outcome.receipt);
  tampered.privacyScore = 0;
  assert.equal(await verifyPublicReceiptIntegrity(tampered), false);
});

test("log redaction removes provider context and secret-like keys", () => {
  const value = redactForLogs({
    amount: 1n,
    providerContext: { raw: "x" },
    privateKey: "secret",
    nested: { viewingKey: "secret2" },
  });
  assert.deepEqual(value, {
    amount: "1",
    providerContext: "[REDACTED]",
    privateKey: "[REDACTED]",
    nested: { viewingKey: "[REDACTED]" },
  });
});

test("Solana validator accepts 32-byte base58 and rejects invalid text", () => {
  assert.equal(isValidSolanaAddress(RECIPIENT), true);
  assert.equal(isValidSolanaAddress("not-solana"), false);
});

test("duplicate provider ids are rejected", () => {
  const registry = new ProviderRegistry();
  registry.register(provider("same", FULL));
  assert.throws(() => registry.register(provider("same", FULL)), /already registered/i);
});

test("expired intent is rejected before quotes", async () => {
  const p = policy();
  const { router } = routerWith([provider("full", FULL)], p);
  const now = Date.now();
  const expired = intent(FULL_ANONYMITY, { nowMs: now - 10_000, ttlMs: 1_000 });
  await assert.rejects(() => router.prepare(expired, now), /expired/i);
});

test("asset policy blocks unapproved asset", async () => {
  const p = policy({ allowedAssetIds: ["USDC"] });
  const { router } = routerWith([provider("full", FULL)], p);
  await assert.rejects(() => router.prepare(intent(FULL_ANONYMITY)), /Asset is not enabled/i);
});


test("two-phase transaction signer is bound to the approved route plan", async () => {
  const bound = provider("bound", FULL);
  let signerCalled = false;
  bound.execute = async (i, q, context) => {
    assert.ok(context.transactionSigner);
    const tx = new TextEncoder().encode("unsigned-solana-message");
    const txHash = await sha256Hex(tx);
    const signed = await context.transactionSigner.signSolanaTransaction({
      version: 1,
      routePlanHash: context.routePlan.routePlanHash,
      intentHash: context.routePlan.intentHash,
      providerId: bound.manifest.providerId,
      providerVersion: bound.manifest.providerVersion,
      network: i.network,
      transactionHash: txHash,
      serializedTransaction: tx,
      expectedProgramIds: ["11111111111111111111111111111111"],
      display: {
        operation: i.operation,
        assetSymbol: i.asset.symbol,
        amountBaseUnits: i.amountBaseUnits.toString(),
        recipientBinding: "solana:11111111111111111111111111111111",
      },
    });
    assert.ok(signed.length > 0);
    return {
      ok: true,
      providerId: bound.manifest.providerId,
      providerVersion: bound.manifest.providerVersion,
      completedAtMs: Date.now(),
      actualExposure: q.exposure,
      providerEvidence: "bound-signer",
      secretStateCommitted: true,
    };
  };

  const p = policy();
  const { router } = routerWith([bound], p);
  const engine = new VeilEngine(router, p, new MemoryReplayGuard());
  const prepared = await engine.prepare(intent(FULL_ANONYMITY));
  const transactionSigner = {
    async signSolanaTransaction(request) {
      signerCalled = true;
      assert.equal(request.routePlanHash, prepared.plan.routePlanHash);
      assert.equal(request.intentHash, prepared.intentHash);
      assert.equal(request.transactionHash, await sha256Hex(request.serializedTransaction));
      return new Uint8Array([1, 2, 3]);
    },
  };
  await engine.execute(prepared, { transactionSigner });
  assert.equal(signerCalled, true);
});

test("engine rejects route when provider catalog changes after preparation", async () => {
  const p = policy();
  const first = provider("first", FULL);
  const { router, registry } = routerWith([first], p);
  const engine = new VeilEngine(router, p, new MemoryReplayGuard());
  const prepared = await engine.prepare(intent(FULL_ANONYMITY));
  registry.register(provider("added-after-approval", FULL));
  await assert.rejects(() => engine.execute(prepared), /integrity/i);
});


test("privacy analyzer shows improvement from public transfer to full route", () => {
  const comparison = comparePrivacy(PUBLIC_SOLANA_EXPOSURE, FULL);
  assert.equal(comparison.before.score, 0);
  assert.equal(comparison.after.score, 94);
  assert.deepEqual(comparison.newlyHidden.sort(), ["amount", "asset", "recipient", "sender"].sort());
});


test("semantic verifier rejects maliciously rehashed candidate score", async () => {
  const p = policy();
  const { router } = routerWith([provider("a", FULL, 10_000n), provider("b", FULL, 20_000n)], p);
  const engine = new VeilEngine(router, p, new MemoryReplayGuard());
  const prepared = await engine.prepare(intent(FULL_ANONYMITY));
  const tampered = structuredClone(prepared);
  const victim = tampered.plan.candidates.find(c => c.providerId === "b");
  victim.score.total = 999;
  tampered.plan.selectedProviderId = "b";
  tampered.plan.selectedProviderVersion = victim.providerVersion;
  tampered.plan.selectedQuoteId = victim.quoteId;
  tampered.plan.selectedProviderPlanCommitment = victim.providerPlanCommitment;
  tampered.plan.selectedExposure = victim.exposure;
  tampered.plan.selectedFeeBaseUnits = victim.estimatedFeeBaseUnits;
  tampered.plan.selectedLatencyMs = victim.estimatedLatencyMs;
  tampered.plan.selectedScore = victim.score;
  const { routePlanHash: _old, ...withoutHash } = tampered.plan;
  tampered.plan.routePlanHash = await hashRoutePlan(withoutHash);
  tampered.selectedQuote = {
    ...tampered.selectedQuote,
    providerId: victim.providerId,
    providerVersion: victim.providerVersion,
    quoteId: victim.quoteId,
    providerPlanCommitment: victim.providerPlanCommitment,
    exposure: victim.exposure,
    estimatedFeeBaseUnits: BigInt(victim.estimatedFeeBaseUnits),
    estimatedLatencyMs: victim.estimatedLatencyMs,
  };
  await assert.rejects(() => engine.execute(tampered), /manifests or wallet policy/i);
});


test("provider health failure does not block a healthy fallback", async () => {
  const broken = provider("broken", FULL, 1n);
  broken.healthCheck = async () => { throw new Error("offline"); };
  const healthy = provider("healthy", FULL, 2n);
  const p = policy();
  const { router } = routerWith([broken, healthy], p);
  const prepared = await router.prepare(intent(FULL_ANONYMITY));
  assert.equal(prepared.plan.selectedProviderId, "healthy");
  assert.equal(prepared.plan.rejections.find(r => r.providerId === "broken")?.reason, "health_check_failed");
});

test("provider quote failure does not block a healthy fallback", async () => {
  const broken = provider("broken-quote", FULL, 1n);
  broken.quote = async () => { throw new Error("quote offline"); };
  const healthy = provider("healthy-quote", FULL, 2n);
  const p = policy();
  const { router } = routerWith([broken, healthy], p);
  const prepared = await router.prepare(intent(FULL_ANONYMITY));
  assert.equal(prepared.plan.selectedProviderId, "healthy-quote");
  assert.equal(prepared.plan.rejections.find(r => r.providerId === "broken-quote")?.reason, "quote_failed");
});

test("route plan covers every registered provider as candidate or rejection", async () => {
  const p = policy();
  const { router } = routerWith([
    provider("full-ok", FULL),
    provider("amount-rejected", AMOUNT_ONLY),
    provider("payment-rejected", PAYMENT),
  ], p);
  const prepared = await router.prepare(intent(FULL_ANONYMITY));
  const covered = [
    ...prepared.plan.candidates.map(c => c.providerId),
    ...prepared.plan.rejections.map(r => r.providerId),
  ].sort();
  assert.deepEqual(covered, ["amount-rejected", "full-ok", "payment-rejected"].sort());
});

test("router rejects invalid policy configuration immediately", () => {
  const registry = new ProviderRegistry();
  registry.register(provider("p", FULL));
  assert.throws(
    () => new VeilRouter(registry, policy({ minPrivacyScore: 101 })),
    /between 0 and 100/i,
  );
});

test("router rejects an intent created beyond allowed clock skew", async () => {
  const p = policy({ maxClockSkewMs: 30_000 });
  const { router } = routerWith([provider("future-safe", FULL)], p);
  const nowMs = Date.now();
  const futureIntent = intent(FULL_ANONYMITY, { nowMs: nowMs + 31_000 });
  await assert.rejects(
    () => router.prepare(futureIntent, nowMs),
    /clock-skew|future/i,
  );
});

test("malformed hardware signature fails closed instead of throwing", async () => {
  const p = policy({ requireHardwareApproval: true });
  const { router } = routerWith([provider("full-malformed", FULL)], p);
  const prepared = await router.prepare(intent(FULL_ANONYMITY));
  const envelope = buildApprovalEnvelope(prepared);
  const { gateway, trust } = await makeSoftwareHardware();
  const proof = await gateway.requestApproval(envelope);
  const malformed = { ...proof, signatureBase64: "***not-base64***" };
  assert.equal(await verifyDeviceApprovalProof(envelope, malformed, trust), false);
});
