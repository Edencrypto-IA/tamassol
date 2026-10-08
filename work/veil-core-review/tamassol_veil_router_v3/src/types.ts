export type VeilNetwork = "devnet" | "mainnet-beta";
export type VeilOperation =
  | "shield"
  | "private_transfer"
  | "unshield"
  | "private_swap";

export type PrivacyDimension =
  | "sender"
  | "recipient"
  | "asset"
  | "amount"
  | "history";

export type PrivacyRequirementLevel = "required" | "preferred" | "irrelevant";
export type Visibility = "hidden" | "conditional" | "public" | "unknown";
export type ProviderRelease = "production" | "devnet" | "experimental" | "demo";
export type HardwareKeyIsolation = "compatible" | "conditional" | "incompatible";
export type SecretStateModel = "none" | "wallet_derived" | "provider_notes";

export interface AssetRef {
  symbol: string;
  decimals: number;
  /** SOL uses literal "SOL". SPL assets use mint address. */
  assetId: string;
}

export type Recipient =
  | { kind: "solana"; address: string }
  | {
      kind: "shielded";
      providerRecipientId: string;
      address?: string;
      viewingPublicKey?: string;
    };

export interface PrivacyRequirements {
  sender: PrivacyRequirementLevel;
  recipient: PrivacyRequirementLevel;
  asset: PrivacyRequirementLevel;
  amount: PrivacyRequirementLevel;
  history: PrivacyRequirementLevel;
}

export interface ExposureProfile {
  sender: Visibility;
  recipient: Visibility;
  asset: Visibility;
  amount: Visibility;
  history: Visibility;
  note: string;
}

export interface VeilIntent {
  version: 3;
  requestId: string;
  nonce: string;
  createdAtMs: number;
  expiresAtMs: number;
  network: VeilNetwork;
  operation: VeilOperation;
  asset: AssetRef;
  amountBaseUnits: bigint;
  recipient?: Recipient;
  privacy: PrivacyRequirements;
  feeCeilingBaseUnits: bigint;
}

export interface ProviderManifest {
  providerId: string;
  providerVersion: string;
  displayName: string;
  release: ProviderRelease;
  networks: VeilNetwork[];
  operations: VeilOperation[];
  supportedAssetIds: string[] | "dynamic";
  hardwareKeyIsolation: HardwareKeyIsolation;
  selfCustodial: boolean;
  secretStateModel: SecretStateModel;
  /** Conservative maximum privacy this provider claims per operation. */
  exposureByOperation: Partial<Record<VeilOperation, ExposureProfile>>;
}

export interface ProviderQuote {
  providerId: string;
  providerVersion: string;
  quoteId: string;
  validUntilMs: number;
  exposure: ExposureProfile;
  estimatedFeeBaseUnits: bigint;
  estimatedLatencyMs: number;
  /** Hash/commitment created by the provider adapter over its execution plan. */
  providerPlanCommitment: string;
  warnings: string[];
  /** Opaque provider state. Never log or serialize into public receipts. */
  providerContext?: unknown;
}

export interface RouteScoreBreakdown {
  privacy: number;
  keyIsolation: number;
  selfCustody: number;
  readiness: number;
  fees: number;
  latency: number;
  total: number;
}

export interface RouteCandidateSummary {
  providerId: string;
  providerVersion: string;
  quoteId: string;
  exposure: ExposureProfile;
  estimatedFeeBaseUnits: string;
  estimatedLatencyMs: number;
  providerPlanCommitment: string;
  score: RouteScoreBreakdown;
}

export interface RouteRejection {
  providerId: string;
  providerVersion: string;
  reason: string;
}

export interface RoutePlan {
  version: 1;
  intentHash: string;
  policyHash: string;
  catalogHash: string;
  selectedProviderId: string;
  selectedProviderVersion: string;
  selectedQuoteId: string;
  selectedProviderPlanCommitment: string;
  selectedExposure: ExposureProfile;
  selectedFeeBaseUnits: string;
  selectedLatencyMs: number;
  selectedScore: RouteScoreBreakdown;
  candidates: RouteCandidateSummary[];
  /** Every registered provider not in candidates appears here exactly once. */
  rejections: RouteRejection[];
  createdAtMs: number;
  expiresAtMs: number;
  routePlanHash: string;
}

export interface PreparedRoute {
  intent: VeilIntent;
  intentHash: string;
  plan: RoutePlan;
  selectedQuote: ProviderQuote;
}

export interface RouterPolicy {
  version: 1;
  enabledProviderIds: string[] | "all";
  allowedAssetIds: string[] | "dynamic";
  allowDemoProviders: boolean;
  allowExperimentalProviders: boolean;
  requireSelfCustody: boolean;
  requireHardwareKeyIsolation: "strict" | "allow_conditional" | "off";
  requireHardwareApproval: boolean;
  minPrivacyScore: number;
  maxQuoteAgeMs: number;
  maxIntentAgeMs: number;
  maxClockSkewMs: number;
  maxFeeByAssetId?: Record<string, bigint>;
}

export interface SolanaTransactionSigningRequest {
  version: 1;
  routePlanHash: string;
  intentHash: string;
  providerId: string;
  providerVersion: string;
  network: VeilNetwork;
  /** SHA-256 of the exact serialized unsigned transaction/message bytes. */
  transactionHash: string;
  /** Exact bytes the hardware must parse/hash before signing. */
  serializedTransaction: Uint8Array;
  /** Program allowlist expected by the reviewed provider adapter. */
  expectedProgramIds: string[];
  display: {
    operation: VeilOperation;
    assetSymbol: string;
    amountBaseUnits: string;
    recipientBinding: string;
    networkFeeCeilingBaseUnits?: string;
  };
}

export interface TamassolTransactionSigner {
  signSolanaTransaction(request: SolanaTransactionSigningRequest): Promise<Uint8Array>;
}

export interface ProviderExecutionContext {
  routePlan: RoutePlan;
  approval: DeviceApprovalProof | null;
  /** Two-phase binding: provider asks the paired device to sign the final tx. */
  transactionSigner?: TamassolTransactionSigner;
  onProgress?: (phase: string) => void;
}

export interface ProviderExecutionResult {
  ok: boolean;
  providerId: string;
  providerVersion: string;
  completedAtMs: number;
  actualExposure: ExposureProfile;
  chainSignature?: string;
  /** Provider-specific evidence serialized as a non-secret string. */
  providerEvidence: string;
  /** Required for providers whose spendable private state is created during execution. */
  secretStateCommitted: boolean;
  safeMessage?: string;
}

export interface ApprovalEnvelope {
  version: 3;
  deviceProtocol: "TAMASSOL_VEIL_APPROVAL_V3";
  requestId: string;
  nonce: string;
  createdAtMs: number;
  expiresAtMs: number;
  network: VeilNetwork;
  operation: VeilOperation;
  assetId: string;
  assetSymbol: string;
  assetDecimals: number;
  amountBaseUnits: string;
  recipientBinding: string;
  requestedPrivacy: PrivacyRequirements;
  routePlanHash: string;
  intentHash: string;
  selectedProviderId: string;
  selectedProviderVersion: string;
  providerPlanCommitment: string;
  selectedExposure: ExposureProfile;
  feeBaseUnits: string;
}

export interface DeviceApprovalProof {
  version: 3;
  deviceId: string;
  requestId: string;
  nonce: string;
  routePlanHash: string;
  intentHash: string;
  decision: "approved" | "rejected";
  approvedAtMs: number;
  algorithm: "ECDSA_P256_SHA256";
  signatureBase64: string;
}

export interface TrustedDeviceRecord {
  deviceId: string;
  algorithm: "ECDSA_P256_SHA256";
  /** DER SubjectPublicKeyInfo, base64 encoded. */
  publicKeySpkiBase64: string;
  enabled: boolean;
}

export interface DisclosureCommitment {
  field: string;
  commitment: string;
}

export interface DisclosureSecret {
  field: string;
  value: string;
  saltHex: string;
  commitment: string;
}

export interface DisclosureProof {
  field: string;
  value: string;
  saltHex: string;
}

export interface PublicVeilReceipt {
  version: 1;
  receiptId: string;
  intentHash: string;
  routePlanHash: string;
  providerId: string;
  providerVersion: string;
  network: VeilNetwork;
  operation: VeilOperation;
  requestedPrivacy: PrivacyRequirements;
  actualExposure: ExposureProfile;
  privacyScore: number;
  chainSignature?: string;
  providerEvidenceHash: string;
  secretStateCommitted: boolean;
  disclosureCommitments: DisclosureCommitment[];
  completedAtMs: number;
  receiptHash: string;
}

export interface VeilExecutionOutcome {
  prepared: PreparedRoute;
  approval: DeviceApprovalProof | null;
  execution: ProviderExecutionResult;
  receipt: PublicVeilReceipt;
  disclosureSecrets: DisclosureSecret[];
}
