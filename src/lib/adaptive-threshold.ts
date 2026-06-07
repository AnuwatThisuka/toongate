// In-memory cache per Worker isolate — refreshed from D1 every 5 min.
let cache: { threshold: number; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MIN_ROWS = 20;

async function computeFromHistory(db: D1Database, fallback: number): Promise<number> {
  const rows = await db
    .prepare(
      `SELECT tokens_before, tokens_saved
       FROM savings
       WHERE tokens_before > 0
       ORDER BY id DESC
       LIMIT 200`,
    )
    .all<{ tokens_before: number; tokens_saved: number }>();

  if (!rows.results || rows.results.length < MIN_ROWS) return fallback;

  const avg =
    rows.results.reduce((sum, r) => sum + r.tokens_saved / r.tokens_before, 0) /
    rows.results.length;

  // Map observed compression ratio → suggested threshold
  if (avg > 0.4) return 0.4;
  if (avg > 0.25) return 0.5;
  if (avg > 0.1) return 0.6;
  return 0.7;
}

export async function getAdaptiveThreshold(
  db: D1Database,
  fallback: number,
): Promise<number> {
  const now = Date.now();
  if (cache && now < cache.expiresAt) return cache.threshold;

  const threshold = await computeFromHistory(db, fallback).catch(() => fallback);
  cache = { threshold, expiresAt: now + CACHE_TTL_MS };
  return threshold;
}
