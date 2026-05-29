import { describe, it, expect } from "vitest";
import { compressRequestBody } from "../src/lib/compress";

const UNIFORM_MESSAGES = [
  { role: "user", content: [{ type: "text", text: "hello" }] },
  { role: "assistant", content: [{ type: "text", text: "hi there" }] },
  { role: "user", content: [{ type: "text", text: "how are you?" }] },
];

describe("compressRequestBody", () => {
  it("compresses eligible uniform messages array", () => {
    const body = { model: "gpt-4o", messages: UNIFORM_MESSAGES };
    const text = JSON.stringify(body);
    const result = compressRequestBody(body, text, 0.6);
    expect(result.compressed).toBe(true);
    expect(result.tokensSaved).toBeGreaterThan(0);
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
  });

  it("does not compress when score is below threshold", () => {
    const body = {
      model: "gpt-4o",
      messages: [{ role: "user", content: "plain string message" }],
    };
    const text = JSON.stringify(body);
    const result = compressRequestBody(body, text, 0.6);
    expect(result.compressed).toBe(false);
    expect(result.tokensSaved).toBe(0);
    expect(result.bodyText).toBe(text);
  });

  it("passes through body with no messages array", () => {
    const body = { model: "gpt-4o", prompt: "hello" };
    const text = JSON.stringify(body);
    const result = compressRequestBody(body, text, 0.6);
    expect(result.compressed).toBe(false);
    expect(result.bodyText).toBe(text);
  });

  it("passes through empty messages array", () => {
    const body = { model: "gpt-4o", messages: [] };
    const text = JSON.stringify(body);
    const result = compressRequestBody(body, text, 0.6);
    expect(result.compressed).toBe(false);
  });

  it("reports eligibility score > 0 for uniform array", () => {
    const body = { model: "gpt-4o", messages: UNIFORM_MESSAGES };
    const text = JSON.stringify(body);
    const result = compressRequestBody(body, text, 0.6);
    expect(result.eligibilityScore).toBeGreaterThan(0.6);
  });

  it("reports eligibility score 0 for string content", () => {
    const body = {
      model: "gpt-4o",
      messages: [{ role: "user", content: "hello" }],
    };
    const text = JSON.stringify(body);
    const result = compressRequestBody(body, text, 0.6);
    expect(result.eligibilityScore).toBe(0);
  });
});
