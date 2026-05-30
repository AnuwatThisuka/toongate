import { scoreEligibility } from "./eligibility";
import { encodeToToon, estimateTokens } from "./encoder";

export interface CompressResult {
  body: Record<string, unknown>;
  bodyText: string;
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
  eligibilityScore: number;
  compressed: boolean;
}

export function compressRequestBody(
  body: Record<string, unknown>,
  originalText: string,
  threshold: number,
): CompressResult {
  const tokensBefore = estimateTokens(originalText);
  const messages = body.messages;

  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      body,
      bodyText: originalText,
      tokensBefore,
      tokensAfter: tokensBefore,
      tokensSaved: 0,
      eligibilityScore: 0,
      compressed: false,
    };
  }

  let maxScore = 0;
  let anyModified = false;

  const processedMessages = messages.map((msg: unknown) => {
    const m = msg as Record<string, unknown>;
    const score = scoreEligibility(m.content);
    if (score > maxScore) maxScore = score;
    if (score >= threshold) {
      anyModified = true;
      return { ...m, content: encodeToToon(m.content) };
    }
    return m;
  });

  if (!anyModified) {
    return {
      body,
      bodyText: originalText,
      tokensBefore,
      tokensAfter: tokensBefore,
      tokensSaved: 0,
      eligibilityScore: maxScore,
      compressed: false,
    };
  }

  const compressedBody = { ...body, messages: processedMessages };
  const compressedText = JSON.stringify(compressedBody);
  const tokensAfter = estimateTokens(compressedText);

  // If TOON encoding made the payload larger (can happen for small arrays),
  // fall back to the original — never send a bigger payload than we received.
  if (tokensAfter >= tokensBefore) {
    return {
      body,
      bodyText: originalText,
      tokensBefore,
      tokensAfter: tokensBefore,
      tokensSaved: 0,
      eligibilityScore: maxScore,
      compressed: false,
    };
  }

  return {
    body: compressedBody,
    bodyText: compressedText,
    tokensBefore,
    tokensAfter,
    tokensSaved: tokensBefore - tokensAfter,
    eligibilityScore: maxScore,
    compressed: true,
  };
}
