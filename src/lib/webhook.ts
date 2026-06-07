import type { SavingsRow } from "../types";

interface WaitContext {
  waitUntil(promise: Promise<unknown>): void;
}

export function pushWebhook(
  url: string,
  row: SavingsRow,
  ctx: WaitContext,
): void {
  const payload = {
    ts: row.ts,
    model: row.model,
    endpoint: row.endpoint,
    tokens_before: row.tokens_before,
    tokens_after: row.tokens_after,
    tokens_saved: row.tokens_saved,
    usd_saved: row.usd_saved,
    elapsed_ms: row.elapsed_ms,
    deep_compressed: row.deep_compressed === 1,
    caveman_mode: row.caveman_mode === 1,
  };

  ctx.waitUntil(
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {}),
  );
}
