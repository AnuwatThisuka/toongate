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
