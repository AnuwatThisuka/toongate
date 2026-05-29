import { Hono } from "hono";

const app = new Hono<{ Bindings: Env }>();

// GET /savings/summary — aggregate totals grouped by model
app.get("/savings/summary", async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: "DB binding not configured" }, 503);

  const result = await db
    .prepare(
      `SELECT
         model,
         COUNT(*)          AS requests,
         SUM(tokens_before) AS total_tokens_before,
         SUM(tokens_after)  AS total_tokens_after,
         SUM(tokens_saved)  AS total_tokens_saved,
         ROUND(SUM(usd_saved), 6) AS total_usd_saved
       FROM savings
       GROUP BY model
       ORDER BY total_usd_saved DESC`,
    )
    .all();

  const overall = await db
    .prepare(
      `SELECT
         COUNT(*)          AS requests,
         SUM(tokens_before) AS total_tokens_before,
         SUM(tokens_after)  AS total_tokens_after,
         SUM(tokens_saved)  AS total_tokens_saved,
         ROUND(SUM(usd_saved), 6) AS total_usd_saved
       FROM savings`,
    )
    .first();

  return c.json({ overall, by_model: result.results });
});

// GET /savings/history — paginated raw log, newest first
// Query params: limit (default 50, max 500), offset (default 0)
app.get("/savings/history", async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: "DB binding not configured" }, 503);

  const limit = Math.min(Number(c.req.query("limit") ?? 50), 500);
  const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);

  const result = await db
    .prepare(
      `SELECT ts, model, endpoint, tokens_before, tokens_after, tokens_saved,
              usd_saved, elapsed_ms
       FROM savings
       ORDER BY ts DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(limit, offset)
    .all();

  const total = await db
    .prepare("SELECT COUNT(*) AS count FROM savings")
    .first<{ count: number }>();

  return c.json({
    total: total?.count ?? 0,
    limit,
    offset,
    rows: result.results,
  });
});

export default app;
