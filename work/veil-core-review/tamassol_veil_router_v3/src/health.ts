export type ProviderHealth = "HEALTHY" | "DEGRADED" | "UNAVAILABLE";
export interface ProviderHealthCheck {
  health: ProviderHealth;
  proverReady: boolean;
  errorCode?: string;
}
export interface ProviderHealthRecord extends ProviderHealthCheck {
  provider: string;
  timestamp: number;
  lastSuccessfulCheck: number | null;
}
// Fixed codes only: never surface or persist arbitrary provider exception text.
export function healthErrorCode(error: unknown): string {
  const e = error as { code?: string; message?: string; details?: { reason?: string } } | null;
  const text = `${e?.code ?? ""} ${e?.message ?? ""} ${e?.details?.reason ?? ""}`.toLowerCase();
  if (text.includes("stale root") || text.includes("stale_root")) return "STALE_ROOT";
  if (text.includes("indexer_unavailable")) return "INDEXER_UNAVAILABLE";
  return "HEALTH_CHECK_FAILED";
}
export const PRIVACY_ROUTE_UNAVAILABLE_MESSAGE = "This privacy route is temporarily unavailable.";
