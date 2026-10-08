import { HardwareApprovalError } from "./errors.js";
import {
  canonicalApprovalEnvelope,
  canonicalRecipient,
} from "./canonical.js";
import {
  importP256SpkiPublicKey,
  utf8,
  verifyP256Sha256,
} from "./crypto.js";
import type {
  ApprovalEnvelope,
  DeviceApprovalProof,
  PreparedRoute,
  TrustedDeviceRecord,
} from "./types.js";

export interface HardwareApprovalGateway {
  isConnected(): Promise<boolean>;
  requestApproval(
    envelope: ApprovalEnvelope,
    options?: { timeoutMs?: number },
  ): Promise<DeviceApprovalProof>;
}

export interface DeviceTrustStore {
  get(deviceId: string): Promise<TrustedDeviceRecord | null>;
}

export class MemoryDeviceTrustStore implements DeviceTrustStore {
  private readonly devices = new Map<string, TrustedDeviceRecord>();

  constructor(records: TrustedDeviceRecord[] = []) {
    for (const record of records) this.devices.set(record.deviceId, record);
  }

  put(record: TrustedDeviceRecord): void {
    this.devices.set(record.deviceId, record);
  }

  async get(deviceId: string): Promise<TrustedDeviceRecord | null> {
    return this.devices.get(deviceId) ?? null;
  }
}

export function buildApprovalEnvelope(prepared: PreparedRoute): ApprovalEnvelope {
  return {
    version: 3,
    deviceProtocol: "TAMASSOL_VEIL_APPROVAL_V3",
    requestId: prepared.intent.requestId,
    nonce: prepared.intent.nonce,
    createdAtMs: prepared.plan.createdAtMs,
    expiresAtMs: prepared.plan.expiresAtMs,
    network: prepared.intent.network,
    operation: prepared.intent.operation,
    assetId: prepared.intent.asset.assetId,
    assetSymbol: prepared.intent.asset.symbol,
    assetDecimals: prepared.intent.asset.decimals,
    amountBaseUnits: prepared.intent.amountBaseUnits.toString(),
    recipientBinding: canonicalRecipient(prepared.intent.recipient),
    requestedPrivacy: prepared.intent.privacy,
    routePlanHash: prepared.plan.routePlanHash,
    intentHash: prepared.intentHash,
    selectedProviderId: prepared.plan.selectedProviderId,
    selectedProviderVersion: prepared.plan.selectedProviderVersion,
    providerPlanCommitment: prepared.plan.selectedProviderPlanCommitment,
    selectedExposure: prepared.plan.selectedExposure,
    feeBaseUnits: prepared.plan.selectedFeeBaseUnits,
  };
}

export async function verifyDeviceApprovalProof(
  envelope: ApprovalEnvelope,
  proof: DeviceApprovalProof,
  trustStore: DeviceTrustStore,
  nowMs = Date.now(),
): Promise<boolean> {
  if (proof.version !== 3 || proof.algorithm !== "ECDSA_P256_SHA256") return false;
  if (proof.decision !== "approved") return false;
  if (!Number.isSafeInteger(proof.approvedAtMs)) return false;
  if (proof.approvedAtMs > nowMs + 30_000) return false;
  if (proof.approvedAtMs < envelope.createdAtMs - 30_000) return false;
  if (proof.approvedAtMs > envelope.expiresAtMs) return false;
  if (proof.requestId !== envelope.requestId) return false;
  if (proof.nonce !== envelope.nonce) return false;
  if (proof.routePlanHash !== envelope.routePlanHash) return false;
  if (proof.intentHash !== envelope.intentHash) return false;

  const record = await trustStore.get(proof.deviceId);
  if (!record || !record.enabled || record.algorithm !== proof.algorithm) return false;
  try {
    const publicKey = await importP256SpkiPublicKey(record.publicKeySpkiBase64);
    return await verifyP256Sha256(
      publicKey,
      utf8(canonicalApprovalEnvelope(envelope)),
      proof.signatureBase64,
    );
  } catch {
    return false;
  }
}

export async function requestAndVerifyHardwareApproval(
  gateway: HardwareApprovalGateway,
  trustStore: DeviceTrustStore,
  envelope: ApprovalEnvelope,
): Promise<DeviceApprovalProof> {
  if (!(await gateway.isConnected())) {
    throw new HardwareApprovalError(
      "HARDWARE_REQUIRED",
      "TAMASSOL hardware is not connected.",
    );
  }

  const proof = await gateway.requestApproval(envelope, { timeoutMs: 120_000 });
  if (proof.decision !== "approved") {
    throw new HardwareApprovalError(
      "HARDWARE_REJECTED",
      "Operation was rejected on TAMASSOL hardware.",
    );
  }

  const valid = await verifyDeviceApprovalProof(
    envelope,
    proof,
    trustStore,
    Date.now(),
  );
  if (!valid) {
    throw new HardwareApprovalError(
      "INVALID_HARDWARE_PROOF",
      "Device approval signature did not verify.",
    );
  }
  return proof;
}
