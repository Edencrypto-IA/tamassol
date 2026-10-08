import { privacyDimensions, privacyScore } from "./privacy.js";
import type { ExposureProfile, PrivacyDimension } from "./types.js";

export interface PrivacyAnalysis {
  score: number;
  hidden: PrivacyDimension[];
  conditional: PrivacyDimension[];
  exposed: PrivacyDimension[];
  unknown: PrivacyDimension[];
}

export interface PrivacyComparison {
  before: PrivacyAnalysis;
  after: PrivacyAnalysis;
  scoreImprovement: number;
  newlyHidden: PrivacyDimension[];
}

export const PUBLIC_SOLANA_EXPOSURE: ExposureProfile = {
  sender: "public",
  recipient: "public",
  asset: "public",
  amount: "public",
  history: "public",
  note: "Baseline public Solana transfer exposure.",
};

export function analyzeExposure(exposure: ExposureProfile): PrivacyAnalysis {
  const hidden: PrivacyDimension[] = [];
  const conditional: PrivacyDimension[] = [];
  const exposed: PrivacyDimension[] = [];
  const unknown: PrivacyDimension[] = [];

  for (const dimension of privacyDimensions()) {
    const visibility = exposure[dimension];
    if (visibility === "hidden") hidden.push(dimension);
    else if (visibility === "conditional") conditional.push(dimension);
    else if (visibility === "public") exposed.push(dimension);
    else unknown.push(dimension);
  }

  return {
    score: privacyScore(exposure),
    hidden,
    conditional,
    exposed,
    unknown,
  };
}

export function comparePrivacy(
  beforeExposure: ExposureProfile,
  afterExposure: ExposureProfile,
): PrivacyComparison {
  const before = analyzeExposure(beforeExposure);
  const after = analyzeExposure(afterExposure);
  return {
    before,
    after,
    scoreImprovement: Math.round((after.score - before.score) * 100) / 100,
    newlyHidden: after.hidden.filter(dimension => !before.hidden.includes(dimension)),
  };
}
