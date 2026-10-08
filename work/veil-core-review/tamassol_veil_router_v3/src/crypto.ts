function ensureCrypto(): Crypto {
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
    throw new Error("Web Crypto API is required.");
  }
  return globalThis.crypto;
}

export function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]*$/i.test(value) || value.length % 2 !== 0) {
    throw new Error("Invalid hex string.");
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}


export function isSha256Hex(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

export async function sha256Bytes(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await ensureCrypto().subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? utf8(value) : value;
  return bytesToHex(await sha256Bytes(bytes));
}

export function randomHex(byteLength = 24): string {
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0) {
    throw new Error("byteLength must be a positive integer.");
  }
  const bytes = new Uint8Array(byteLength);
  ensureCrypto().getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function importP256SpkiPublicKey(spkiBase64: string): Promise<CryptoKey> {
  return ensureCrypto().subtle.importKey(
    "spki",
    base64ToBytes(spkiBase64),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}

export async function verifyP256Sha256(
  publicKey: CryptoKey,
  message: Uint8Array,
  signatureBase64: string,
): Promise<boolean> {
  return ensureCrypto().subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    base64ToBytes(signatureBase64),
    message,
  );
}
