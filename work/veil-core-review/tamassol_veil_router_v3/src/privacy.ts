import type {
  ExposureProfile,
  PrivacyDimension,
  PrivacyRequirementLevel,
  PrivacyRequirements,
  Visibility,
} from "./types.js";
import { PrivacyDowngradeError } from "./errors.js";

const DIMENSIONS: PrivacyDimension[] = [
  "sender",
  "recipient",
  "asset",
  "amount",
  "history",
];

const WEIGHTS: Record<PrivacyDimension, number> = {
  sender: 25,
  recipient: 25,
  amount: 25,
  asset: 15,
  history: 10,
};

const VISIBILITY_FACTOR: Record<Visibility, number> = {
  hidden: 1,
  conditional: 0.4,
  public: 0,
  unknown: 0,
};

const VISIBILITY_STRENGTH: Record<Visibility, number> = {
  unknown: 0,
  public: 1,
  conditional: 2,
  hidden: 3,
};

export function privacyDimensions(): readonly PrivacyDimension[] {
  return DIMENSIONS;
}

export function privacyScore(exposure: ExposureProfile): number {
  const raw = DIMENSIONS.reduce((sum, dimension) => {
    return sum + WEIGHTS[dimension] * VISIBILITY_FACTOR[exposure[dimension]];
  }, 0);
  return Math.round(raw * 100) / 100;
}

export function requiredDimensionSatisfied(
  requirement: PrivacyRequirementLevel,
  visibility: Visibility,
): boolean {
  if (requirement !== "required") return true;
  return visibility === "hidden";
}

export function satisfiesPrivacyRequirements(
  requirements: PrivacyRequirements,
  exposure: ExposureProfile,
): boolean {
  return DIMENSIONS.every(dimension =>
    requiredDimensionSatisfied(requirements[dimension], exposure[dimension]),
  );
}

export function assertNoPrivacyDowngrade(
  requirements: PrivacyRequirements,
  actualExposure: ExposureProfile,
): void {
  const failed = DIMENSIONS.filter(
    dimension =>
      requirements[dimension] === "required" &&
      actualExposure[dimension] !== "hidden",
  );

  if (failed.length > 0) {
    throw new PrivacyDowngradeError(
      `Required privacy dimension(s) became visible: ${failed.join(", ")}.`,
    );
  }
}

/**
 * A quote may be weaker than a conservative manifest guarantee for a particular
 * flow, but it may never claim stronger privacy than the manifest advertises.
 */
export function quoteDoesNotOverclaim(
  manifestExposure: ExposureProfile,
  quoteExposure: ExposureProfile,
): boolean {
  return DIMENSIONS.every(dimension => {
    return (
      VISIBILITY_STRENGTH[quoteExposure[dimension]] <=
      VISIBILITY_STRENGTH[manifestExposure[dimension]]
    );
  });
}


export function requirementWeightedPrivacyFraction(
  requirements: PrivacyRequirements,
  exposure: ExposureProfile,
): number {
  const relevant = DIMENSIONS.filter(
    dimension => requirements[dimension] !== "irrelevant",
  );
  if (relevant.length === 0) return 1;

  const achieved = relevant.reduce((sum, dimension) => {
    const requirement = requirements[dimension];
    if (requirement === "required") {
      return sum + (exposure[dimension] === "hidden" ? 1 : 0);
    }
    return sum + VISIBILITY_FACTOR[exposure[dimension]];
  }, 0);
  return achieved / relevant.length;
}

export function preferredPrivacyFraction(
  requirements: PrivacyRequirements,
  exposure: ExposureProfile,
): number {
  const preferred = DIMENSIONS.filter(
    dimension => requirements[dimension] === "preferred",
  );
  if (preferred.length === 0) return 1;

  const achieved = preferred.reduce(
    (sum, dimension) => sum + VISIBILITY_FACTOR[exposure[dimension]],
    0,
  );
  return achieved / preferred.length;
}

export function compareVisibility(
  left: Visibility,
  right: Visibility,
): number {
  return VISIBILITY_STRENGTH[left] - VISIBILITY_STRENGTH[right];
}
