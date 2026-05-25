import { encode } from "@toon-format/toon";

export function encodeToToon(value: unknown): string {
  return encode(value);
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
