const SENSITIVE_KEYS = [
  "privatekey",
  "private_key",
  "secret",
  "seed",
  "mnemonic",
  "providercontext",
  "provider_context",
  "viewingkey",
  "viewing_key",
  "utxo",
  "note",
  "salt",
  "approvalproof",
  "signaturebase64",
];

function sensitive(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.some(fragment => lower.includes(fragment));
}

export function redactForLogs(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[MAX_DEPTH]";
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return value;
  if (value instanceof Uint8Array) return `[bytes:${value.length}]`;
  if (Array.isArray(value)) return value.map(item => redactForLogs(item, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    output[key] = sensitive(key) ? "[REDACTED]" : redactForLogs(child, depth + 1);
  }
  return output;
}
