export interface SavingsRow {
  ts: string;
  model: string;
  endpoint: string;
  tokens_before: number;
  tokens_after: number;
  tokens_saved: number;
  usd_saved: number;
  elapsed_ms: number;
  deep_compressed?: number; // 1 = true, 0 = false
  caveman_mode?: number;    // 1 = true, 0 = false
}
