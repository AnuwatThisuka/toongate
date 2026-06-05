import { describe, it, expect } from "vitest";
import {
  isCavemanMode,
  applyCavemanMode,
  CAVEMAN_SYSTEM_PROMPT,
} from "../src/lib/caveman";

// ── isCavemanMode ───────────────────────────────────────────────────────────

describe("isCavemanMode", () => {
  it("returns true for x-toongate-mode: caveman", () => {
    const headers = new Headers({ "x-toongate-mode": "caveman" });
    expect(isCavemanMode(headers)).toBe(true);
  });

  it("returns true for x-compression-level: caveman", () => {
    const headers = new Headers({ "x-compression-level": "caveman" });
    expect(isCavemanMode(headers)).toBe(true);
  });

  it("returns false for x-toongate-mode with other value", () => {
    const headers = new Headers({ "x-toongate-mode": "normal" });
    expect(isCavemanMode(headers)).toBe(false);
  });

  it("returns false for x-compression-level with other value", () => {
    const headers = new Headers({ "x-compression-level": "high" });
    expect(isCavemanMode(headers)).toBe(false);
  });

  it("returns false when neither header is present", () => {
    expect(isCavemanMode(new Headers())).toBe(false);
  });

  it("is case-sensitive — 'Caveman' (capital C) does not activate", () => {
    const headers = new Headers({ "x-toongate-mode": "Caveman" });
    expect(isCavemanMode(headers)).toBe(false);
  });
});

// ── applyCavemanMode ────────────────────────────────────────────────────────

describe("applyCavemanMode — activation guard", () => {
  it("does NOT activate when body has no messages field", () => {
    const body = { model: "gpt-4o", prompt: "hello" };
    const result = applyCavemanMode(body);
    expect(result.activated).toBe(false);
    expect(result.body).toBe(body);
  });

  it("does NOT activate when messages array is empty", () => {
    const body = { model: "gpt-4o", messages: [] };
    const result = applyCavemanMode(body);
    expect(result.activated).toBe(false);
  });

  it("activates when messages array has at least one item", () => {
    const body = {
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello" }],
    };
    expect(applyCavemanMode(body).activated).toBe(true);
  });
});

describe("applyCavemanMode — system prompt injection", () => {
  it("prepends a new system message when none exists", () => {
    const body = {
      model: "gpt-4o",
      messages: [{ role: "user", content: "What is TypeScript?" }],
    };
    const { body: out } = applyCavemanMode(body);
    const messages = (out as { messages: Array<{ role: string; content: string }> }).messages;

    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toBe(CAVEMAN_SYSTEM_PROMPT);
  });

  it("original user message is shifted to index 1", () => {
    const body = {
      model: "gpt-4o",
      messages: [{ role: "user", content: "Explain React hooks." }],
    };
    const { body: out } = applyCavemanMode(body);
    const messages = (out as { messages: Array<{ role: string; content: string }> }).messages;

    expect(messages[1].role).toBe("user");
    expect(messages[1].content).not.toMatch(/please/i);
  });

  it("prepends caveman prompt to existing system message", () => {
    const existing = "You are a code review assistant.";
    const body = {
      model: "gpt-4o",
      messages: [
        { role: "system", content: existing },
        { role: "user", content: "Review my code." },
      ],
    };
    const { body: out } = applyCavemanMode(body);
    const messages = (out as { messages: Array<{ role: string; content: string }> }).messages;

    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain(CAVEMAN_SYSTEM_PROMPT);
    expect(messages[0].content).toContain(existing);
    expect(messages[0].content.indexOf(CAVEMAN_SYSTEM_PROMPT)).toBeLessThan(
      messages[0].content.indexOf(existing),
    );
  });

  it("does not duplicate system messages", () => {
    const body = {
      model: "gpt-4o",
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Hello." },
      ],
    };
    const { body: out } = applyCavemanMode(body);
    const messages = (out as { messages: Array<{ role: string; content: unknown }> }).messages;
    const systemCount = messages.filter((m) => m.role === "system").length;
    expect(systemCount).toBe(1);
  });

  it("uses the exact CAVEMAN_SYSTEM_PROMPT constant", () => {
    const body = {
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hi." }],
    };
    const { body: out } = applyCavemanMode(body);
    const first = (out as { messages: Array<{ role: string; content: string }> }).messages[0];
    expect(first.content).toContain(
      "Reply in Caveman style: extremely short, concise, no polite fluff, answer directly, use minimal tokens.",
    );
  });

  it("preserves message count: prepend adds exactly 1 when no system exists", () => {
    const body = {
      model: "gpt-4o",
      messages: [
        { role: "user", content: "msg1" },
        { role: "assistant", content: "msg2" },
        { role: "user", content: "msg3" },
      ],
    };
    const { body: out } = applyCavemanMode(body);
    const messages = (out as { messages: unknown[] }).messages;
    expect(messages.length).toBe(4);
  });

  it("preserves message count: overwrite keeps same count when system exists", () => {
    const body = {
      model: "gpt-4o",
      messages: [
        { role: "system", content: "Be helpful." },
        { role: "user", content: "msg1" },
        { role: "user", content: "msg2" },
      ],
    };
    const { body: out } = applyCavemanMode(body);
    const messages = (out as { messages: unknown[] }).messages;
    expect(messages.length).toBe(3);
  });
});

describe("applyCavemanMode — semantic stripping", () => {
  it("strips fillers from user messages", () => {
    const body = {
      model: "gpt-4o",
      messages: [
        { role: "user", content: "Can you please explain closures step-by-step." },
      ],
    };
    const { body: out } = applyCavemanMode(body);
    const messages = (out as { messages: Array<{ role: string; content: string }> }).messages;
    const user = messages.find((m) => m.role === "user")!;
    expect(user.content).not.toMatch(/can you please/i);
    expect(user.content).not.toMatch(/step-by-step/i);
    expect(user.content).toContain("explain closures");
  });

  it("strips fillers from existing system message before injecting caveman prompt", () => {
    const body = {
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "Please carefully provide thorough responses. Thank you.",
        },
        { role: "user", content: "Hello." },
      ],
    };
    const { body: out } = applyCavemanMode(body);
    const messages = (out as { messages: Array<{ role: string; content: string }> }).messages;
    expect(messages[0].content).not.toMatch(/please carefully/i);
    expect(messages[0].content).not.toMatch(/thank you/i);
    expect(messages[0].content).toContain(CAVEMAN_SYSTEM_PROMPT);
  });

  it("does not modify non-string content parts", () => {
    const arrayContent = [{ type: "text", text: "Can you please help." }];
    const body = {
      model: "gpt-4o",
      messages: [{ role: "user", content: arrayContent }],
    };
    const { body: out } = applyCavemanMode(body);
    const messages = (out as { messages: Array<{ role: string; content: unknown }> }).messages;
    const user = messages.find((m) => m.role === "user")!;
    // non-string content is passed through unchanged
    expect(user.content).toEqual(arrayContent);
  });
});

describe("applyCavemanMode — immutability", () => {
  it("does not mutate the original body", () => {
    const original = {
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello." }],
    };
    const snapshot = JSON.stringify(original);
    applyCavemanMode(original);
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("does not mutate the original messages array", () => {
    const msgs = [{ role: "user", content: "Hello." }];
    const body = { model: "gpt-4o", messages: msgs };
    applyCavemanMode(body);
    expect(msgs.length).toBe(1);
    expect(msgs[0].role).toBe("user");
  });

  it("preserves unrelated body fields", () => {
    const body = {
      model: "gpt-4o-mini",
      temperature: 0.7,
      max_tokens: 256,
      stream: true,
      messages: [{ role: "user", content: "Hi." }],
    };
    const { body: out } = applyCavemanMode(body);
    const o = out as typeof body;
    expect(o.model).toBe("gpt-4o-mini");
    expect(o.temperature).toBe(0.7);
    expect(o.max_tokens).toBe(256);
    expect(o.stream).toBe(true);
  });
});
