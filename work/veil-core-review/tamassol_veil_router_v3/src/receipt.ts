import { sha256Hex } from "./crypto.js";
import { canonicalExposure, canonicalPrivacyRequirements } from "./canonical.js";
import { privacyScore } from "./privacy.js";
import type {
  DisclosureCommitment,
  ProviderExecutionResult,
  PublicVeilReceipt,
  PreparedRoute,
} from "./types.js";

function field(value: string): string {
  return `${new TextEncoder().encode(value).length}:${value}`;
}

function canonicalCommitments(values: DisclosureCommitment[]): string {
  return [...values]
    .sort((a, b) => a.field.localeCompare(b.field))
    .map(value => field(value.field) + field(value.commitment))
    .join("");
}

export function canonicalReceiptWithoutHash(
  receipt: Omit<PublicVeilReceipt, "receiptHash">,
): string {
  return [
    "TAMASSOL_VEIL_RECEIPT_V1",
    String(receipt.version),
    receipt.receiptId,
    receipt.intentHash,
    receipt.routePlanHash,
    receipt.providerId,
    receipt.providerVersion,
    receipt.network,
    receipt.operation,
    canonicalPrivacyRequirements(receipt.requestedPrivacy),
    canonicalExposure(receipt.actualExposure),
    String(receipt.privacyScore),
    receipt.chainSignature ?? "",
    receipt.providerEvidenceHash,
    receipt.secretStateCommitted ? "1" : "0",
    canonicalCommitments(receipt.disclosureCommitments),
    String(receipt.completedAtMs),
  ].map(field).join("");
}

export async function createPublicReceipt(
  prepared: PreparedRoute,
  execution: ProviderExecutionResult,
  disclosureCommitments: DisclosureCommitment[],
): Promise<PublicVeilReceipt> {
  const providerEvidenceHash = await sha256Hex(execution.providerEvidence);
  const receiptId = await sha256Hex(
    `${prepared.plan.routePlanHash}:${execution.completedAtMs}:${providerEvidenceHash}`,
  );

  const withoutHash: Omit<PublicVeilReceipt, "receiptHash"> = {
    version: 1,
    receiptId,
    intentHash: prepared.intentHash,
    routePlanHash: prepared.plan.routePlanHash,
    providerId: execution.providerId,
    providerVersion: execution.providerVersion,
    network: prepared.intent.network,
    operation: prepared.intent.operation,
    requestedPrivacy: prepared.intent.privacy,
    actualExposure: execution.actualExposure,
    privacyScore: privacyScore(execution.actualExposure),
    ...(execution.chainSignature ? { chainSignature: execution.chainSignature } : {}),
    providerEvidenceHash,
    secretStateCommitted: execution.secretStateCommitted,
    disclosureCommitments,
    completedAtMs: execution.completedAtMs,
  };
  const receiptHash = await sha256Hex(canonicalReceiptWithoutHash(withoutHash));
  return { ...withoutHash, receiptHash };
}

export async function verifyPublicReceiptIntegrity(
  receipt: PublicVeilReceipt,
): Promise<boolean> {
  const { receiptHash, ...withoutHash } = receipt;
  const expected = await sha256Hex(canonicalReceiptWithoutHash(withoutHash));
  return expected === receiptHash;
}
