import { compressRequestBody, type CompressResult } from "./compress";
import { scoreEligibility } from "./eligibility";
import { encodeToToon, estimateTokens } from "./encoder";
import { applyExcludeToArray } from "./exclude-fields";

export interface DeepCompressResult {
  body: unknown;
  bodyText: string;
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
  eligibilityScore: number;
  compressed: boolean;
  deepCompressed: boolean;
}

// Keep short — every token here costs money too
const TOON_SYSTEM_INJECTION =
  "[TOON] Fields use TOON encoding: {f1,f2}[N] header + pipe-delimited rows.";

function injectSystemMessage(
  messages: unknown[],
): unknown[] {
  const first = messages[0] as Record<string, unknown> | undefined;
  if (first?.role === "system") {
    const existing =
      typeof first.content === "string" ? first.content : "";
    return [
      { ...first, content: `${TOON_SYSTEM_INJECTION}\n${existing}` },
      ...messages.slice(1),
    ];
  }
  return [
    { role: "system", content: TOON_SYSTEM_INJECTION },
    ...messages,
  ];
}

function tryDeepCompressContent(
  content: unknown,
  threshold: number,
  excludeFields?: Set<string>,
): { content: unknown; modified: boolean } {
  // content must be an array of parts (e.g. [{type, text}])
  if (!Array.isArray(content)) return { content, modified: false };

  let modified = false;
  const processed = content.map((part: unknown) => {
    const p = part as Record<string, unknown>;
    const text = p.text;

    // Quick pre-check: must be a string starting with "["
    if (typeof text !== "string" || !text.trimStart().startsWith("[")) {
      return part;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return part;
    }

    if (
      !Array.isArray(parsed) ||
      parsed.length < 3 ||
      scoreEligibility(parsed) < threshold
    ) {
      return part;
    }

    try {
      const toEncode =
        excludeFields?.size
          ? applyExcludeToArray(parsed as unknown[], excludeFields)
          : parsed;
      const encoded = encodeToToon(toEncode);
      // Only use if it actually saves characters
      if (encoded.length >= text.length) return part;
      modified = true;
      return { ...p, text: encoded };
    } catch {
      return part;
    }
  });

  return { content: processed, modified };
}

export function deepCompressBody(
  body: unknown,
  threshold: number,
  excludeFields?: Set<string>,
): DeepCompressResult {
  const originalText = JSON.stringify(body);
  const tokensBefore = estimateTokens(originalText);

  const bodyRecord = body as Record<string, unknown>;

  // ── Step 1: try top-level compression first ──────────────────
  const topLevel: CompressResult = compressRequestBody(
    bodyRecord,
    originalText,
    threshold,
    excludeFields,
  );

  if (topLevel.compressed) {
    return {
      body: topLevel.body,
      bodyText: topLevel.bodyText,
      tokensBefore: topLevel.tokensBefore,
      tokensAfter: topLevel.tokensAfter,
      tokensSaved: Math.max(0, topLevel.tokensBefore - topLevel.tokensAfter),
      eligibilityScore: topLevel.eligibilityScore,
      compressed: true,
      deepCompressed: false,
    };
  }

  // ── Step 2: walk messages[].content[].text ───────────────────
  const messages = bodyRecord.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      body,
      bodyText: originalText,
      tokensBefore,
      tokensAfter: tokensBefore,
      tokensSaved: 0,
      eligibilityScore: topLevel.eligibilityScore,
      compressed: false,
      deepCompressed: false,
    };
  }

  let anyDeepModified = false;
  let maxScore = topLevel.eligibilityScore;

  const processedMessages = messages.map((msg: unknown) => {
    const m = msg as Record<string, unknown>;
    const { content, modified } = tryDeepCompressContent(m.content, threshold, excludeFields);
    if (modified) {
      anyDeepModified = true;
      // Update maxScore based on what was found
      if (maxScore < threshold) maxScore = threshold;
    }
    return modified ? { ...m, content } : m;
  });

  if (!anyDeepModified) {
    return {
      body,
      bodyText: originalText,
      tokensBefore,
      tokensAfter: tokensBefore,
      tokensSaved: 0,
      eligibilityScore: maxScore,
      compressed: false,
      deepCompressed: false,
    };
  }

  // ── Step 3: inject TOON context into system message ──────────
  const withSystem = injectSystemMessage(processedMessages);
  const compressedBody = { ...bodyRecord, messages: withSystem };
  const compressedText = JSON.stringify(compressedBody);
  const tokensAfter = estimateTokens(compressedText);

  // Fallback if deep compression didn't actually save tokens
  if (tokensAfter >= tokensBefore) {
    return {
      body,
      bodyText: originalText,
      tokensBefore,
      tokensAfter: tokensBefore,
      tokensSaved: 0,
      eligibilityScore: maxScore,
      compressed: false,
      deepCompressed: false,
    };
  }

  return {
    body: compressedBody,
    bodyText: compressedText,
    tokensBefore,
    tokensAfter,
    tokensSaved: Math.max(0, tokensBefore - tokensAfter),
    eligibilityScore: maxScore,
    compressed: true,
    deepCompressed: true,
  };
}
