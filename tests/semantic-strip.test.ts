import { describe, it, expect } from "vitest";
import { semanticStrip, stripMessages } from "../src/lib/semantic-strip";

describe("semanticStrip", () => {
  it("strips 'Please carefully analyze'", () => {
    const result = semanticStrip("Please carefully analyze this code.");
    expect(result).toBe("this code.");
    expect(result).not.toMatch(/please/i);
  });

  it("strips 'Can you help me to'", () => {
    const result = semanticStrip("Can you help me to write a function.");
    expect(result).not.toMatch(/can you help me to/i);
    expect(result).toContain("write a function");
  });

  it("strips 'Can you please'", () => {
    const result = semanticStrip("Can you please summarize this.");
    expect(result).not.toMatch(/can you please/i);
    expect(result).toContain("summarize this");
  });

  it("strips 'Could you please'", () => {
    const result = semanticStrip("Could you please explain this concept.");
    expect(result).not.toMatch(/could you please/i);
    expect(result).toContain("explain this concept");
  });

  it("strips 'Would you please'", () => {
    const result = semanticStrip("Would you please review the PR.");
    expect(result).not.toMatch(/would you please/i);
    expect(result).toContain("review the PR");
  });

  it("strips 'I would like you to'", () => {
    const result = semanticStrip("I would like you to refactor this.");
    expect(result).not.toMatch(/i would like you to/i);
    expect(result).toContain("refactor this");
  });

  it("strips \"I'd like you to\"", () => {
    const result = semanticStrip("I'd like you to list all endpoints.");
    expect(result).not.toMatch(/i'd like you to/i);
    expect(result).toContain("list all endpoints");
  });

  it("strips 'I need you to'", () => {
    const result = semanticStrip("I need you to debug this error.");
    expect(result).not.toMatch(/i need you to/i);
    expect(result).toContain("debug this error");
  });

  it("strips 'step-by-step'", () => {
    const result = semanticStrip("Explain step-by-step how JWT works.");
    expect(result).not.toMatch(/step-by-step/i);
    expect(result).toContain("how JWT works");
  });

  it("strips 'step by step' (spaces)", () => {
    const result = semanticStrip("Explain step by step how it works.");
    expect(result).not.toMatch(/step by step/i);
    expect(result).toContain("how it works");
  });

  it("strips 'very carefully'", () => {
    const result = semanticStrip("Read very carefully the docs.");
    expect(result).not.toMatch(/very carefully/i);
    expect(result).toContain("the docs");
  });

  it("strips 'thoroughly'", () => {
    const result = semanticStrip("thoroughly check the logic.");
    expect(result).not.toMatch(/thoroughly/i);
    expect(result).toContain("check the logic");
  });

  it("strips 'in detail'", () => {
    const result = semanticStrip("Explain in detail how this works.");
    expect(result).not.toMatch(/in detail/i);
    expect(result).toContain("how this works");
  });

  it("strips 'thank you'", () => {
    const result = semanticStrip("Fix this bug. Thank you.");
    expect(result).not.toMatch(/thank you/i);
    expect(result).toContain("Fix this bug");
  });

  it("strips 'thanks'", () => {
    const result = semanticStrip("Fix this bug. Thanks.");
    expect(result).not.toMatch(/\bthanks\b/i);
    expect(result).toContain("Fix this bug");
  });

  it("does not modify clean, direct text", () => {
    const clean = "What is the time complexity of quicksort?";
    expect(semanticStrip(clean)).toBe(clean);
  });

  it("does not modify empty string", () => {
    expect(semanticStrip("")).toBe("");
  });

  it("collapses multiple spaces after stripping", () => {
    const result = semanticStrip("Can you please  help  me?");
    expect(result).not.toMatch(/\s{2,}/);
  });

  it("handles multiple fillers in one sentence", () => {
    const result = semanticStrip(
      "Could you please very carefully analyze this in detail. Thanks.",
    );
    expect(result).not.toMatch(/could you please/i);
    expect(result).not.toMatch(/very carefully/i);
    expect(result).not.toMatch(/in detail/i);
    expect(result).not.toMatch(/thanks/i);
  });

  it("strips 'Please review'", () => {
    const result = semanticStrip("Please review this PR for me.");
    expect(result).not.toMatch(/please review/i);
    expect(result).toContain("this PR for me");
  });

  it("strips 'Please provide'", () => {
    const result = semanticStrip("Please provide a list of options.");
    expect(result).not.toMatch(/please provide/i);
    expect(result).toContain("a list of options");
  });

  it("is case-insensitive", () => {
    expect(semanticStrip("PLEASE CAREFULLY ANALYZE this.")).not.toMatch(
      /PLEASE CAREFULLY ANALYZE/i,
    );
    expect(semanticStrip("COULD YOU PLEASE fix this.")).not.toMatch(
      /COULD YOU PLEASE/i,
    );
  });
});

describe("stripMessages", () => {
  it("strips fillers from string content messages", () => {
    const messages = [
      { role: "user", content: "Can you please explain how async/await works." },
    ];
    const result = stripMessages(messages) as typeof messages;
    expect(result[0].content).not.toMatch(/can you please/i);
    expect(result[0].content).toContain("explain how async/await works");
  });

  it("returns original message reference when content is unchanged", () => {
    const msg = { role: "user", content: "What is a closure?" };
    const result = stripMessages([msg]) as Array<{ role: string; content: string }>;
    expect(result[0]).toBe(msg);
  });

  it("returns new object when content changes", () => {
    const msg = { role: "user", content: "Can you please explain closures." };
    const result = stripMessages([msg]) as Array<{ role: string; content: string }>;
    expect(result[0]).not.toBe(msg);
    expect(result[0].role).toBe("user");
  });

  it("does not modify messages with non-string content", () => {
    const msg = {
      role: "user",
      content: [{ type: "text", text: "Can you please help." }],
    };
    const result = stripMessages([msg]) as Array<typeof msg>;
    expect(result[0]).toBe(msg);
    expect(result[0].content).toEqual(msg.content);
  });

  it("strips across multiple messages", () => {
    const messages = [
      { role: "system", content: "You are helpful. Thank you." },
      { role: "user", content: "Could you please write a sort function." },
    ];
    const result = stripMessages(messages) as typeof messages;
    expect(result[0].content).not.toMatch(/thank you/i);
    expect(result[1].content).not.toMatch(/could you please/i);
    expect(result[1].content).toContain("write a sort function");
  });

  it("preserves role and other fields", () => {
    const msg = {
      role: "user",
      content: "Please provide a summary.",
      name: "alice",
    };
    const result = stripMessages([msg]) as Array<typeof msg>;
    expect(result[0].role).toBe("user");
    expect(result[0].name).toBe("alice");
  });

  it("returns empty array for empty input", () => {
    expect(stripMessages([])).toEqual([]);
  });
});

