import { decode } from "@toon-format/toon";

export function decodeFromToon(input: string): unknown {
  try {
    return decode(input);
  } catch {
    return input;
  }
}
