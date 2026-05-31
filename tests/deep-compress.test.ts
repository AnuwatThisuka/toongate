import { describe, expect, it } from "vitest";
import { deepCompressBody } from "../src/lib/deep-compress";

const makeRows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    title: `Result ${String.fromCharCode(65 + i)}`,
    score: +(0.91 - i * 0.05).toFixed(2),
    url: `https://example.com/${i + 1}`,
  }));

const RAG_ROWS = [
  { id: 1, title: "Result A", score: 0.91, url: "https://a.com" },
  { id: 2, title: "Result B", score: 0.87, url: "https://b.com" },
  { id: 3, title: "Result C", score: 0.84, url: "https://c.com" },
  { id: 4, title: "Result D", score: 0.79, url: "https://d.com" },
  { id: 5, title: "Result E", score: 0.76, url: "https://e.com" },
];

describe("deepCompressBody", () => {
  it("compresses JSON array embedded in text field", () => {
    const body = {
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: JSON.stringify(RAG_ROWS) }],
        },
      ],
    };
    const result = deepCompressBody(body, 0.6);
    expect(result.deepCompressed).toBe(true);
    expect(result.tokensSaved).toBeGreaterThan(0);
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
  });

  it("injects system message when deep compressed", () => {
    const body = {
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: JSON.stringify(makeRows(5)) },
          ],
        },
      ],
    };
    const result = deepCompressBody(body, 0.6);
    const messages = (result.body as { messages: { role: string; content: string }[] }).messages;
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("TOON");
  });

  it("prepends to existing system message without replacing it", () => {
    const body = {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        {
          role: "user",
          content: [{ type: "text", text: JSON.stringify(makeRows(5)) }],
        },
      ],
    };
    const result = deepCompressBody(body, 0.6);
    const messages = (result.body as { messages: { role: string; content: string }[] }).messages;
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("TOON");
    expect(messages[0].content).toContain("You are a helpful assistant.");
  });

  it("does NOT compress 2-item arrays (not worth it)", () => {
    const body = {
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: JSON.stringify([
                { type: "text", text: "a" },
                { type: "text", text: "b" },
              ]),
            },
          ],
        },
      ],
    };
    const result = deepCompressBody(body, 0.6);
    expect(result.deepCompressed).toBe(false);
  });

  it("does NOT compress plain text string content", () => {
    const body = {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "What is the capital of Thailand?" }],
    };
    const result = deepCompressBody(body, 0.6);
    expect(result.compressed).toBe(false);
    expect(result.deepCompressed).toBe(false);
  });

  it("does NOT compress non-array JSON strings", () => {
    const body = {
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: JSON.stringify({ key: "value", nested: { a: 1 } }),
            },
          ],
        },
      ],
    };
    const result = deepCompressBody(body, 0.6);
    expect(result.deepCompressed).toBe(false);
  });

  it("does NOT compress strings that don't start with '['", () => {
    const body = {
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Just a plain sentence." }],
        },
      ],
    };
    const result = deepCompressBody(body, 0.6);
    expect(result.deepCompressed).toBe(false);
  });

  it("tokensSaved is never negative", () => {
    const body = {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "short" }],
    };
    const result = deepCompressBody(body, 0.6);
    expect(result.tokensSaved).toBeGreaterThanOrEqual(0);
  });

  it("tokensSaved is never negative even when top-level fallback fires", () => {
    // 2-item array: top-level compress fires but falls back; deep also skips
    const body = {
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [{ id: 1, val: "x" }, { id: 2, val: "y" }],
        },
      ],
    };
    const result = deepCompressBody(body, 0.6);
    expect(result.tokensSaved).toBeGreaterThanOrEqual(0);
  });

  it("falls back silently when JSON.parse throws", () => {
    const body = {
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "[invalid json{{" }],
        },
      ],
    };
    expect(() => deepCompressBody(body, 0.6)).not.toThrow();
    const result = deepCompressBody(body, 0.6);
    expect(result.deepCompressed).toBe(false);
  });

  it("compresses multiple text parts with embedded arrays", () => {
    const body = {
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Context A:" },
            { type: "text", text: JSON.stringify(makeRows(5)) },
            { type: "text", text: "Context B:" },
            { type: "text", text: JSON.stringify(makeRows(5)) },
          ],
        },
      ],
    };
    const result = deepCompressBody(body, 0.6);
    expect(result.deepCompressed).toBe(true);
    expect(result.tokensSaved).toBeGreaterThan(0);
  });
});
