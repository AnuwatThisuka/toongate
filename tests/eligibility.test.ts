import { describe, it, expect } from "vitest";
import { scoreEligibility } from "../src/lib/eligibility";

describe("scoreEligibility", () => {
  it("scores a uniform tabular array as 1.0", () => {
    const input = [
      { id: 1, name: "Alice", active: true },
      { id: 2, name: "Bob", active: false },
      { id: 3, name: "Carol", active: true },
    ];
    expect(scoreEligibility(input)).toBe(1.0);
  });

  it("scores an array with non-uniform keys as 0.5", () => {
    const input = [
      { id: 1, name: "Alice" },
      { id: 2, age: 30 },
    ];
    expect(scoreEligibility(input)).toBe(0.5);
  });

  it("scores an array containing non-objects as 0.5", () => {
    expect(scoreEligibility([1, 2, 3])).toBe(0.5);
  });

  it("scores a plain string as 0.0", () => {
    expect(scoreEligibility("hello world")).toBe(0.0);
  });

  it("scores a number as 0.0", () => {
    expect(scoreEligibility(42)).toBe(0.0);
  });

  it("scores a boolean as 0.0", () => {
    expect(scoreEligibility(false)).toBe(0.0);
  });

  it("scores null as 0.0", () => {
    expect(scoreEligibility(null)).toBe(0.0);
  });

  it("scores an empty array as 0.0", () => {
    expect(scoreEligibility([])).toBe(0.0);
  });

  it("recurses into objects and averages child scores", () => {
    const input = {
      table: [{ a: 1 }, { a: 2 }], // 1.0
      label: "hello",              // 0.0
    };
    expect(scoreEligibility(input)).toBe(0.5);
  });

  it("recursion: object with all high-scoring children scores near 1.0", () => {
    const input = {
      users: [
        { id: 1, role: "admin" },
        { id: 2, role: "user" },
      ],
      items: [
        { sku: "A", qty: 5 },
        { sku: "B", qty: 3 },
      ],
    };
    expect(scoreEligibility(input)).toBe(1.0);
  });
});
