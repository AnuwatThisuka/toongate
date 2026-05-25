export interface Env {
  DB: D1Database;
  UPSTREAM_URL: string;
  OPENAI_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  TOON_THRESHOLD: string;
  TOON_LOG_SAVINGS: string;
}

export interface SavingsRow {
  ts: string;
  model: string;
  endpoint: string;
  tokens_before: number;
  tokens_after: number;
  tokens_saved: number;
  usd_saved: number;
  elapsed_ms: number;
}
