import { stripMessages } from "./semantic-strip";

export const CAVEMAN_SYSTEM_PROMPT =
  "Reply in Caveman style: extremely short, concise, no polite fluff, answer directly, use minimal tokens.";

export function isCavemanMode(headers: Headers): boolean {
  return (
    headers.get("x-toongate-mode") === "caveman" ||
    headers.get("x-compression-level") === "caveman"
  );
}

export interface CavemanResult {
  body: Record<string, unknown>;
  activated: boolean;
}

export function applyCavemanMode(body: Record<string, unknown>): CavemanResult {
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return { body, activated: false };
  }

  // Step 1: semantic stripping on all messages
  const stripped = stripMessages(messages);

  // Step 2: inject/overwrite system prompt
  const systemIdx = stripped.findIndex(
    (m) => (m as Record<string, unknown>).role === "system",
  );

  let newMessages: unknown[];
  if (systemIdx >= 0) {
    const existing = stripped[systemIdx] as Record<string, unknown>;
    const existingContent =
      typeof existing.content === "string" ? existing.content : "";
    newMessages = [...stripped];
    newMessages[systemIdx] = {
      ...existing,
      content: existingContent
        ? `${CAVEMAN_SYSTEM_PROMPT}\n${existingContent}`
        : CAVEMAN_SYSTEM_PROMPT,
    };
  } else {
    newMessages = [
      { role: "system", content: CAVEMAN_SYSTEM_PROMPT },
      ...stripped,
    ];
  }

  return { body: { ...body, messages: newMessages }, activated: true };
}
