// Strips common polite preambles and filler phrases before forwarding to upstream.
// ORDER MATTERS: longer compound phrases must appear before their sub-patterns,
// otherwise "please" gets stripped mid-phrase and the verb is lost.
const FILLER_PATTERNS: RegExp[] = [
  // Compound openers first — strip the full opener, preserve the action verb
  /\bcan\s+you\s+(?:please\s+)?(?:help\s+me\s+(?:to\s+)?)?/gi,
  /\bcould\s+you\s+(?:please\s+)?/gi,
  /\bwould\s+you\s+(?:please\s+)?/gi,
  /\bi(?:\s+would|'d)\s+like\s+you\s+to\s+/gi,
  /\bi\s+need\s+you\s+to\s+/gi,
  // Standalone please + verb (after compound openers so the verb isn't swallowed)
  /\bplease\s+(?:carefully\s+)?(?:analyze|review|consider|look\s+at|examine|explain|summarize|describe|write|list|provide|give|tell\s+me|help\s+me|assist)\b/gi,
  // Other filler words/phrases
  /\bstep[\s-]by[\s-]step\b/gi,
  /\bvery\s+carefully\b/gi,
  /\bthoroughly\s+/gi,
  /\bin\s+(?:great\s+)?detail\b/gi,
  /\bif\s+you\s+(?:don't\s+)?mind\b/gi,
  /\bthank(?:s|\s+you)(?:\s+(?:so\s+)?much)?\b/gi,
];

export function semanticStrip(text: string): string {
  let result = text;
  for (const pattern of FILLER_PATTERNS) {
    result = result.replace(pattern, "");
  }
  return result.replace(/\s{2,}/g, " ").trim();
}

export function stripMessages(messages: unknown[]): unknown[] {
  return messages.map((msg) => {
    const m = msg as Record<string, unknown>;
    if (typeof m.content !== "string") return msg;
    const stripped = semanticStrip(m.content);
    return stripped === m.content ? msg : { ...m, content: stripped };
  });
}
