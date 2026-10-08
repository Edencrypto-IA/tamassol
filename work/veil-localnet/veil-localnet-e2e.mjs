import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import {
  createKeyPairSignerFromPrivateKeyBytes,
  getSignatureFromTransaction,
  sendAndConfirmTransactionFactory,
  signTransactionWithSigners,
} from "@solana/kit";
import {
  buildDepositTransaction,
  buildRegistrationTransaction,
  buildTransferTransaction,
  createZolanaClient,
  LocalKeys,
  ShieldedKeypair,
  SigningKey,
  SOL_MINT,
  syncWallet,
  Wallet,
} from "@heliuslabs/zolana";
import {
  MemoryReplayGuard,
  ProviderRegistry,
  VeilEngine,
  VeilRouter,
  createVeilIntent,
  verifyPublicReceiptIntegrity,
} from "../veil-core-review/tamassol_veil_router_v3/dist/index.js";
import {
  createLocalnetProvider,
  LOCALNET_POLICY,
} from "./localnet-provider.mjs";
import { localnetReadiness } from "./localnet-preflight.mjs";

const RPC = "http://127.0.0.1:8899";
const ROOT = "localnet-evidence";
const SECRETS = "secrets/localnet-only.json";
const DEPOSIT = 10_000_000n;
const TRANSFER = 3_000_000n;

const report = {
  version: 1,
  network: "localnet",
  status: "started",
  scope: "TAMASSOL Veil + official Zolana localnet validation",
  hostedDevnetUsed: false,
  mainnetUsed: false,
  hardwareTransactionSigning: false,
  phases: [],
};

const json = (value) =>
  JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item), 2);

async function durable(path, value, exclusive = false) {
  const file = await open(path, exclusive ? "wx" : "w", 0o600);
  try {
    await file.writeFile(json(value));
    await file.sync();
  } finally {
    await file.close();
  }
}

async function rpc(method, params = []) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`LOCAL_RPC_HTTP_${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`LOCAL_RPC_${body.error.code}`);
  return body.result;
}

async function waitForBalance(address, minimum, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const balance = BigInt((await rpc("getBalance", [address])).value);
    if (balance >= minimum) return balance;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("LOCAL_AIRDROP_NOT_VISIBLE");
}

async function ensureAirdrop(address, minimum = 1_000_000_000n) {
  const current = BigInt((await rpc("getBalance", [address])).value);
  if (current >= minimum) return current;
  await rpc("requestAirdrop", [address, Number(2_000_000_000n)]);
  return waitForBalance(address, minimum);
}

async function loadOrCreateSeeds() {
  await mkdir("secrets", { recursive: true });
  try {
    const existing = JSON.parse(await readFile(SECRETS, "utf8"));
    assert.equal(existing.network, "localnet");
    for (const name of ["sender", "recipient"]) {
      assert.match(existing[name], /^[a-f0-9]{64}$/);
    }
    return existing;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const created = {
    network: "localnet",
    sender: randomBytes(32).toString("hex"),
    recipient: randomBytes(32).toString("hex"),
  };
  await durable(SECRETS, created, true);
  return created;
}

function privacyKeypair(seedHex) {
  const seed = Uint8Array.from(Buffer.from(seedHex, "hex"));
  return ShieldedKeypair.fromKeypair(SigningKey.fromEd25519Bytes(seed));
}

async function submit(client, transaction, signer) {
  const signed = await signTransactionWithSigners([signer], transaction);
  const signature = getSignatureFromTransaction(signed);
  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc: client.solanaRpc,
    rpcSubscriptions: client.solanaRpcSubscriptions,
  });
  await sendAndConfirm(signed, { commitment: "confirmed" });
  const slot = await client.confirmTransaction(signature);
  return { signature, slot };
}

async function main() {
  assert(process.argv.includes("--execute-localnet"), "Use --execute-localnet explicitly.");

  await mkdir(ROOT, { recursive: true });
  await durable(
    `${ROOT}/execution.lock`,
    { startedAt: new Date().toISOString() },
    true,
  );
  await durable(`${ROOT}/result.json`, report);

  const readiness = await localnetReadiness();
  assert.equal(readiness.health, "HEALTHY", "Official localnet services are not ready.");
  report.phases.push({ phase: "localnet-ready", checks: readiness.checks });
  await durable(`${ROOT}/result.json`, report);

  const seeds = await loadOrCreateSeeds();
  const senderSeed = Uint8Array.from(Buffer.from(seeds.sender, "hex"));
  const recipientSeed = Uint8Array.from(Buffer.from(seeds.recipient, "hex"));

  const senderSigner = await createKeyPairSignerFromPrivateKeyBytes(senderSeed);
  const recipientSigner = await createKeyPairSignerFromPrivateKeyBytes(recipientSeed);
  const senderKeypair = privacyKeypair(seeds.sender);
  const recipientKeypair = privacyKeypair(seeds.recipient);

  senderSeed.fill(0);
  recipientSeed.fill(0);

  await ensureAirdrop(senderSigner.address);
  await ensureAirdrop(recipientSigner.address);

  const client = await createZolanaClient({
    solanaRpcUrl: "http://127.0.0.1:8899",
    indexerUrl: "http://127.0.0.1:8784",
    proverUrl: "http://127.0.0.1:3001",
    proofDataSource: "client",
  });

  const senderWallet = new Wallet({ identity: senderKeypair.shieldedAddress() });
  const recipientWallet = new Wallet({ identity: recipientKeypair.shieldedAddress() });
  const senderKeys = LocalKeys.fromKeypair(senderKeypair, client.proofService);
  const recipientKeys = LocalKeys.fromKeypair(recipientKeypair, client.proofService);

  for (const [label, signer, keypair] of [
    ["sender", senderSigner, senderKeypair],
    ["recipient", recipientSigner, recipientKeypair],
  ]) {
    const registration = await buildRegistrationTransaction({
      client,
      owner: signer.address,
      address: keypair.shieldedAddress(),
    });
    if (registration) {
      const { signature, slot } = await submit(client, registration, signer);
      report.phases.push({
        phase: `${label}-registration`,
        signature,
        slot: slot.toString(),
      });
      await durable(`${ROOT}/result.json`, report);
    }
  }

  const deposit = await buildDepositTransaction({
    client,
    feePayer: senderSigner.address,
    recipient: senderKeypair.shieldedAddress(),
    amount: DEPOSIT,
  });
  const depositResult = await submit(client, deposit, senderSigner);

  await syncWallet({
    client,
    wallet: senderWallet,
    keys: senderKeys,
    config: { requireSlot: depositResult.slot },
  });
  assert.equal(senderWallet.balance(SOL_MINT).amount, DEPOSIT);

  report.phases.push({
    phase: "shield-deposit",
    signature: depositResult.signature,
    slot: depositResult.slot.toString(),
    verifiedPrivateLamports: DEPOSIT.toString(),
  });
  await durable(`${ROOT}/result.json`, report);

  const transport = {
    senderAddress: senderSigner.address,
    recipientAddress: recipientSigner.address,

    async checkReadiness() {
      const result = await localnetReadiness();
      return {
        health: result.health,
        proverReady: result.proverReady,
        errorCode: result.errorCode,
      };
    },

    async execute(intent, routePlan) {
      assert.equal(intent.network, "localnet");
      assert.equal(intent.amountBaseUnits, TRANSFER);
      assert.equal(intent.recipient?.kind, "solana");
      assert.equal(intent.recipient.address, recipientSigner.address);

      const transaction = await buildTransferTransaction({
        client,
        wallet: senderWallet,
        keys: senderKeys,
        feePayer: senderSigner.address,
        recipient: recipientSigner.address,
        amount: intent.amountBaseUnits,
      });

      const compiledHash = createHash("sha256")
        .update(Buffer.from(transaction.messageBytes))
        .digest("hex");

      assert(Date.now() < routePlan.expiresAtMs, "Route expired before local signing.");

      const { signature, slot } = await submit(client, transaction, senderSigner);

      await syncWallet({
        client,
        wallet: senderWallet,
        keys: senderKeys,
        config: { requireSlot: slot },
      });
      await syncWallet({
        client,
        wallet: recipientWallet,
        keys: recipientKeys,
        config: { requireSlot: slot },
      });

      const senderBalance = senderWallet.balance(SOL_MINT).amount;
      const recipientBalance = recipientWallet.balance(SOL_MINT).amount;

      assert.equal(senderBalance, DEPOSIT - TRANSFER);
      assert.equal(recipientBalance, TRANSFER);

      return {
        network: "localnet",
        signature,
        slot: slot.toString(),
        confirmation: "confirmed",
        verifiedAmountBaseUnits: intent.amountBaseUnits.toString(),
        senderPrivateLamports: senderBalance.toString(),
        recipientPrivateLamports: recipientBalance.toString(),
        routePlanHash: routePlan.routePlanHash,
        transactionMessageHash: compiledHash,
      };
    },
  };

  const registry = new ProviderRegistry();
  registry.register(createLocalnetProvider(transport));
  const router = new VeilRouter(registry, LOCALNET_POLICY);
  const engine = new VeilEngine(router, LOCALNET_POLICY, new MemoryReplayGuard());

  const intent = createVeilIntent({
    network: "localnet",
    operation: "private_transfer",
    asset: { assetId: "SOL", symbol: "SOL", decimals: 9 },
    amountBaseUnits: TRANSFER,
    recipient: { kind: "solana", address: recipientSigner.address },
    privacy: {
      sender: "irrelevant",
      recipient: "irrelevant",
      asset: "required",
      amount: "required",
      history: "irrelevant",
    },
    feeCeilingBaseUnits: 100_000n,
    ttlMs: 600_000,
  });

  const prepared = await engine.prepare(intent);
  assert.equal(prepared.plan.selectedProviderId, "zolana-localnet");

  report.intentHash = prepared.intentHash;
  report.routePlanHash = prepared.plan.routePlanHash;
  report.phases.push({
    phase: "veil-route-selected",
    provider: prepared.plan.selectedProviderId,
  });
  await durable(`${ROOT}/prepared-route.json`, prepared);
  await durable(`${ROOT}/result.json`, report);

  const outcome = await engine.execute(prepared);
  assert(await verifyPublicReceiptIntegrity(outcome.receipt));

  await durable(`${ROOT}/receipt.json`, outcome.receipt);
  report.status = "passed";
  report.completedAt = new Date().toISOString();
  report.chainSignature = outcome.execution.chainSignature;
  report.receiptHash = outcome.receipt.receiptHash;
  report.checkedBalances = {
    senderPrivateLamports: (DEPOSIT - TRANSFER).toString(),
    recipientPrivateLamports: TRANSFER.toString(),
  };
  report.phases.push({ phase: "veil-receipt-verified" });
  await durable(`${ROOT}/result.json`, report);

  console.log(
    "PASS: LOCALNET ONLY — Veil route -> Zolana proof -> local Solana transaction -> local decryption -> receipt.",
  );
}

main().catch(async (error) => {
  report.status = "blocked";
  report.failedAt = new Date().toISOString();
  report.errorCode =
    typeof error?.code === "string"
      ? error.code
      : typeof error?.message === "string" && /^[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : "LOCALNET_VALIDATION_FAILED";
  try {
    await durable(`${ROOT}/result.json`, report);
  } catch {}
  console.error(`BLOCKED: ${report.errorCode}`);
  process.exitCode = 1;
});
