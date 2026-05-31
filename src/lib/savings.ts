import type { SavingsRow } from "../types";

interface WaitContext {
  waitUntil(promise: Promise<unknown>): void;
}

export function writeSavings(
  db: D1Database,
  row: SavingsRow,
  ctx: WaitContext,
): void {
  const promise = db
    .prepare(
      `INSERT INTO savings
         (ts, model, endpoint, tokens_before, tokens_after, tokens_saved, usd_saved, elapsed_ms, deep_compressed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.ts,
      row.model,
      row.endpoint,
      row.tokens_before,
      row.tokens_after,
      row.tokens_saved,
      row.usd_saved,
      row.elapsed_ms,
      row.deep_compressed ?? 0,
    )
    .run();

  ctx.waitUntil(promise);
}
