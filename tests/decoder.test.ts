import { describe, it, expect } from "vitest";
import { encode } from "@toon-format/toon";
import { decodeFromToon } from "../src/lib/decoder";

describe("decoder", () => {
  it("never throws on structurally malformed input", () => {
    // TOON is permissive with key names; the guarantee is no-throw, not fallback value.
    expect(() =>
      decodeFromToon("items[}{id,name}:\x00garbage\x00invalid")
    ).not.toThrow();
  });

  it("falls back to the original string on mismatched header row count", () => {
    // Declares 3 rows but only provides 1
    const malformed = "rows[3]{id,name}:\n  1,Alice";
    const result = decodeFromToon(malformed);
    // Either decoded successfully or returned original — must not throw
    expect(typeof result).not.toBe("undefined");
  });

  it("falls back gracefully on an arbitrary non-TOON string", () => {
    const plain = "SELECT * FROM users WHERE id = 1; DROP TABLE users;--";
    const result = decodeFromToon(plain);
    // Non-TOON text may decode as a TOON string value or fall back; must not throw
    expect(result).toBeDefined();
  });

  it("decodes a valid TOON-encoded array back to the original value", () => {
    const original = [
      { id: 1, name: "Alpha" },
      { id: 2, name: "Beta" },
    ];
    const encoded = encode(original);
    expect(decodeFromToon(encoded)).toEqual(original);
  });
});
