type StringEnvKey = { [K in keyof Env]: Env[K] extends string ? K : never }[keyof Env];

const ROUTE_KEYS: Record<string, StringEnvKey> = {
  "/v1/messages": "TOON_THRESHOLD_MESSAGES",
  "/v1/chat/completions": "TOON_THRESHOLD_CHAT",
  "/v1/embeddings": "TOON_THRESHOLD_EMBEDDINGS",
  // Azure OpenAI — reuse same threshold knobs as OpenAI
  "/azure/v1/chat/completions": "TOON_THRESHOLD_CHAT",
  "/azure/v1/embeddings": "TOON_THRESHOLD_EMBEDDINGS",
  // Gemini — reuse same threshold knobs as OpenAI
  "/gemini/v1/chat/completions": "TOON_THRESHOLD_CHAT",
  "/gemini/v1/embeddings": "TOON_THRESHOLD_EMBEDDINGS",
};

export function resolveThreshold(env: Env, endpoint: string, adaptiveBase?: number): number {
  const key = ROUTE_KEYS[endpoint];
  const raw = key ? env[key] : undefined;
  if (raw && raw !== "") return parseFloat(raw);
  if (adaptiveBase !== undefined) return adaptiveBase;
  return parseFloat(env.TOON_THRESHOLD);
}
