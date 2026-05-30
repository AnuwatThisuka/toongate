type StringEnvKey = { [K in keyof Env]: Env[K] extends string ? K : never }[keyof Env];

const ROUTE_KEYS: Record<string, StringEnvKey> = {
  "/v1/messages": "TOON_THRESHOLD_MESSAGES",
  "/v1/chat/completions": "TOON_THRESHOLD_CHAT",
  "/v1/embeddings": "TOON_THRESHOLD_EMBEDDINGS",
};

export function resolveThreshold(env: Env, endpoint: string): number {
  const key = ROUTE_KEYS[endpoint];
  const raw = key ? env[key] : undefined;
  if (raw && raw !== "") return parseFloat(raw);
  return parseFloat(env.TOON_THRESHOLD);
}
