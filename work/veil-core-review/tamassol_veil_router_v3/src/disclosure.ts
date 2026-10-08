import { randomHex, sha256Hex } from "./crypto.js";
import type {
  DisclosureCommitment,
  DisclosureProof,
  DisclosureSecret,
} from "./types.js";

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

function canonicalDisclosure(field: string, value: string, saltHex: string): string {
  return `TAMASSOL_VEIL_DISCLOSURE_V1|${utf8Length(field)}:${field}|${utf8Length(value)}:${value}|${saltHex}`;
}

export async function createDisclosureSecret(
  field: string,
  value: string,
): Promise<DisclosureSecret> {
  if (!field) throw new Error("Disclosure field is required.");
  const saltHex = randomHex(32);
  const commitment = await sha256Hex(canonicalDisclosure(field, value, saltHex));
  return { field, value, saltHex, commitment };
}

export async function createDisclosureBundle(
  fields: Record<string, string>,
): Promise<DisclosureSecret[]> {
  const entries = Object.entries(fields).sort(([a], [b]) => a.localeCompare(b));
  const output: DisclosureSecret[] = [];
  for (const [field, value] of entries) {
    output.push(await createDisclosureSecret(field, value));
  }
  return output;
}

export function publicDisclosureCommitments(
  secrets: DisclosureSecret[],
): DisclosureCommitment[] {
  return secrets
    .map(({ field, commitment }) => ({ field, commitment }))
    .sort((a, b) => a.field.localeCompare(b.field));
}

export function createDisclosureProof(secret: DisclosureSecret): DisclosureProof {
  return {
    field: secret.field,
    value: secret.value,
    saltHex: secret.saltHex,
  };
}

export async function verifyDisclosureProof(
  commitment: DisclosureCommitment,
  proof: DisclosureProof,
): Promise<boolean> {
  if (commitment.field !== proof.field) return false;
  const expected = await sha256Hex(
    canonicalDisclosure(proof.field, proof.value, proof.saltHex),
  );
  return expected === commitment.commitment;
}
