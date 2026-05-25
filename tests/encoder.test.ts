import { describe, it, expect } from "vitest";
import { encodeToToon } from "../src/lib/encoder";
import { decodeFromToon } from "../src/lib/decoder";

describe("encoder round-trip", () => {
  it("round-trips a uniform tabular array losslessly", () => {
    const input = [
      { id: 1, name: "Alice", score: 9.5 },
      { id: 2, name: "Bob", score: 8.2 },
      { id: 3, name: "Carol", score: 7.8 },
    ];
    expect(decodeFromToon(encodeToToon(input))).toEqual(input);
  });

  it("round-trips a nested object containing a tabular array", () => {
    const input = {
      context: { task: "hike list", location: "Boulder" },
      hikes: [
        { id: 1, name: "Blue Lake", km: 7.5 },
        { id: 2, name: "Ridge Overlook", km: 9.2 },
      ],
    };
    expect(decodeFromToon(encodeToToon(input))).toEqual(input);
  });

  it("round-trips deeply nested mixed structure", () => {
    const input = {
      meta: { version: 1, tags: ["a", "b", "c"] },
      rows: [
        { x: 10, y: 20, label: "point-1" },
        { x: 30, y: 40, label: "point-2" },
        { x: 50, y: 60, label: "has, comma" },
      ],
    };
    expect(decodeFromToon(encodeToToon(input))).toEqual(input);
  });
});
