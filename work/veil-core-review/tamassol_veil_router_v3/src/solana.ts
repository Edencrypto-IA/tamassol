const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const DIGITS = new Map(Array.from(BASE58).map((char, index) => [char, BigInt(index)]));

export function decodeBase58(value: string): Uint8Array | null {
  if (!value) return null;
  let number = 0n;
  for (const char of value) {
    const digit = DIGITS.get(char);
    if (digit === undefined) return null;
    number = number * 58n + digit;
  }

  const bytes: number[] = [];
  while (number > 0n) {
    bytes.push(Number(number & 0xffn));
    number >>= 8n;
  }
  bytes.reverse();

  let leadingZeroCount = 0;
  while (leadingZeroCount < value.length && value[leadingZeroCount] === "1") {
    leadingZeroCount += 1;
  }
  return Uint8Array.from([
    ...new Array<number>(leadingZeroCount).fill(0),
    ...bytes,
  ]);
}

export function isValidSolanaAddress(value: string): boolean {
  return decodeBase58(value)?.length === 32;
}
