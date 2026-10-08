import { randomHex } from "./crypto.js";
import { isValidSolanaAddress } from "./solana.js";
import type {
  AssetRef,
  PrivacyRequirements,
  Recipient,
  VeilIntent,
  VeilNetwork,
  VeilOperation,
} from "./types.js";

export const FULL_ANONYMITY: PrivacyRequirements = {
  sender: "required",
  recipient: "required",
  asset: "required",
  amount: "required",
  history: "preferred",
};

export const PAYMENT_PRIVACY: PrivacyRequirements = {
  sender: "required",
  recipient: "required",
  asset: "irrelevant",
  amount: "required",
  history: "preferred",
};

export const AMOUNT_CONFIDENTIALITY: PrivacyRequirements = {
  sender: "irrelevant",
  recipient: "irrelevant",
  asset: "irrelevant",
  amount: "required",
  history: "irrelevant",
};

export interface CreateVeilIntentInput {
  network: VeilNetwork;
  operation: VeilOperation;
  asset: AssetRef;
  amountBaseUnits: bigint;
  recipient?: Recipient;
  privacy: PrivacyRequirements;
  feeCeilingBaseUnits: bigint;
  ttlMs?: number;
  nowMs?: number;
}

export function createVeilIntent(input: CreateVeilIntentInput): VeilIntent {
  const nowMs = input.nowMs ?? Date.now();
  const ttlMs = input.ttlMs ?? 120_000;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new Error("ttlMs must be a positive safe integer.");
  }
  if (input.recipient?.kind === "solana" && !isValidSolanaAddress(input.recipient.address)) {
    throw new Error("Invalid Solana recipient address.");
  }
  return {
    version: 3,
    requestId: randomHex(16),
    nonce: randomHex(24),
    createdAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
    network: input.network,
    operation: input.operation,
    asset: input.asset,
    amountBaseUnits: input.amountBaseUnits,
    ...(input.recipient ? { recipient: input.recipient } : {}),
    privacy: input.privacy,
    feeCeilingBaseUnits: input.feeCeilingBaseUnits,
  };
}
