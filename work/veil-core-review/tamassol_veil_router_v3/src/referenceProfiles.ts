import type { ExposureProfile, ProviderManifest } from "./types.js";

const publicBoundary: ExposureProfile = {
  sender: "public",
  recipient: "public",
  asset: "public",
  amount: "public",
  history: "public",
  note: "Public boundary transaction.",
};

const cloakPrivateTransfer: ExposureProfile = {
  sender: "hidden",
  recipient: "hidden",
  asset: "public",
  amount: "hidden",
  history: "conditional",
  note: "Cloak shielded transfer; per-mint pool means asset identity is conservatively treated as public.",
};

const heliusAnonymousTransfer: ExposureProfile = {
  sender: "hidden",
  recipient: "hidden",
  asset: "hidden",
  amount: "hidden",
  history: "conditional",
  note: "Anonymous custom Privacy Ring profile as publicly described by Helius on Devnet.",
};

const token2022ConfidentialTransfer: ExposureProfile = {
  sender: "public",
  recipient: "public",
  asset: "public",
  amount: "hidden",
  history: "public",
  note: "Token-2022 Confidential Balances hide amount/balance, not participating accounts or mint.",
};

/**
 * Reference manifests are NOT registered automatically. They exist for the app
 * and Codex integration layer to map a real provider adapter against a reviewed
 * capability profile.
 */
export const REVIEWED_PROVIDER_PROFILES: Readonly<Record<string, ProviderManifest>> = {
  cloak_0_2_5: {
    providerId: "cloak",
    providerVersion: "0.2.5",
    displayName: "Cloak",
    release: "production",
    networks: ["mainnet-beta"],
    operations: ["shield", "private_transfer", "unshield", "private_swap"],
    supportedAssetIds: [
      "SOL",
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "Es9vMFrzaCERmJfrF4H2FYDGTqWDKKqjJ1T6YgABnNw",
    ],
    hardwareKeyIsolation: "conditional",
    selfCustodial: true,
    secretStateModel: "provider_notes",
    exposureByOperation: {
      shield: publicBoundary,
      private_transfer: cloakPrivateTransfer,
      unshield: publicBoundary,
      private_swap: {
        sender: "hidden",
        recipient: "public",
        asset: "public",
        amount: "conditional",
        history: "conditional",
        note: "Conservative swap profile pending app-specific route review.",
      },
    },
  },
  helius_privacy_devnet: {
    providerId: "helius-privacy",
    providerVersion: "devnet-current",
    displayName: "Helius Privacy",
    release: "devnet",
    networks: ["devnet"],
    operations: ["shield", "private_transfer", "unshield"],
    supportedAssetIds: "dynamic",
    hardwareKeyIsolation: "compatible",
    selfCustodial: true,
    secretStateModel: "wallet_derived",
    exposureByOperation: {
      shield: publicBoundary,
      private_transfer: heliusAnonymousTransfer,
      unshield: publicBoundary,
    },
  },
  token2022_confidential: {
    providerId: "token2022-confidential",
    providerVersion: "solana-current",
    displayName: "Token-2022 Confidential Balances",
    release: "production",
    networks: ["devnet", "mainnet-beta"],
    operations: ["shield", "private_transfer", "unshield"],
    supportedAssetIds: "dynamic",
    hardwareKeyIsolation: "conditional",
    selfCustodial: true,
    secretStateModel: "wallet_derived",
    exposureByOperation: {
      shield: publicBoundary,
      private_transfer: token2022ConfidentialTransfer,
      unshield: publicBoundary,
    },
  },
};
