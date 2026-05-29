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

interface DailyRow {
  day: string;
  requests: number;
  tokens_saved: number;
  usd_saved: number;
}

interface OverallRow {
  requests: number;
  total_tokens_before: number;
  total_tokens_after: number;
  total_tokens_saved: number;
  total_usd_saved: number;
}

interface ModelRow {
  model: string;
  requests: number;
  total_tokens_saved: number;
  total_usd_saved: number;
}

// GET /savings/dashboard — HTML dashboard for screenshots
app.get("/savings/dashboard", async (c) => {
  const db = c.env.DB;
  if (!db) return c.text("DB binding not configured", 503);

  const [overall, byModel, daily] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS requests,
                SUM(tokens_before) AS total_tokens_before,
                SUM(tokens_after)  AS total_tokens_after,
                SUM(tokens_saved)  AS total_tokens_saved,
                ROUND(SUM(usd_saved), 6) AS total_usd_saved
         FROM savings`,
      )
      .first<OverallRow>(),
    db
      .prepare(
        `SELECT model,
                COUNT(*) AS requests,
                SUM(tokens_saved) AS total_tokens_saved,
                ROUND(SUM(usd_saved), 6) AS total_usd_saved
         FROM savings
         GROUP BY model
         ORDER BY total_usd_saved DESC
         LIMIT 8`,
      )
      .all<ModelRow>(),
    db
      .prepare(
        `SELECT DATE(ts) AS day,
                COUNT(*) AS requests,
                SUM(tokens_saved) AS tokens_saved,
                ROUND(SUM(usd_saved), 6) AS usd_saved
         FROM savings
         GROUP BY day
         ORDER BY day DESC
         LIMIT 14`,
      )
      .all<DailyRow>(),
  ]);

  const totalTokens = overall?.total_tokens_saved ?? 0;
  const totalUsd = overall?.total_usd_saved ?? 0;
  const totalReqs = overall?.requests ?? 0;
  const compressionRate =
    overall && overall.total_tokens_before > 0
      ? (
          (1 - overall.total_tokens_after / overall.total_tokens_before) *
          100
        ).toFixed(1)
      : "0.0";

  const dailyRows = (daily.results ?? []).slice().reverse();
  const maxTokens = Math.max(...dailyRows.map((r) => r.tokens_saved), 1);

  const fmt = (n: number) =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(2)}M`
      : n >= 1_000
        ? `${(n / 1_000).toFixed(1)}k`
        : String(n);

  const barRows = dailyRows
    .map((r) => {
      const pct = Math.round((r.tokens_saved / maxTokens) * 100);
      const label = r.day.slice(5); // MM-DD
      return `<div class="bar-row">
        <span class="bar-label">${label}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
        <span class="bar-val">${fmt(r.tokens_saved)}</span>
      </div>`;
    })
    .join("\n");

  const modelRows = (byModel.results ?? [])
    .map(
      (m) => `<tr>
      <td>${m.model}</td>
      <td class="num">${fmt(m.requests)}</td>
      <td class="num">${fmt(m.total_tokens_saved)}</td>
      <td class="num green">$${m.total_usd_saved.toFixed(4)}</td>
    </tr>`,
    )
    .join("\n");

  const generatedAt = new Date().toUTCString();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Toongate · Savings Dashboard</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0d0d0d;color:#e8e8e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;padding:32px 24px}
  .wrap{max-width:720px;margin:0 auto}
  header{display:flex;align-items:center;gap:12px;margin-bottom:32px}
  .logo{font-size:22px;font-weight:700;letter-spacing:-0.5px}
  .logo span{color:#a78bfa}
  .badge{font-size:11px;background:#1e1e2e;color:#7c7c9a;border:1px solid #2a2a3e;border-radius:6px;padding:2px 8px}
  .cards{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:28px}
  @media(min-width:500px){.cards{grid-template-columns:repeat(4,1fr)}}
  .card{background:#141420;border:1px solid #1e1e2e;border-radius:12px;padding:16px}
  .card-label{font-size:11px;color:#7c7c9a;text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px}
  .card-value{font-size:26px;font-weight:700;line-height:1}
  .card-value.green{color:#4ade80}
  .card-value.purple{color:#a78bfa}
  .card-value.blue{color:#60a5fa}
  .card-value.amber{color:#fbbf24}
  section{background:#141420;border:1px solid #1e1e2e;border-radius:12px;padding:20px;margin-bottom:16px}
  h2{font-size:13px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px;margin-bottom:16px}
  .bar-row{display:flex;align-items:center;gap:10px;margin-bottom:8px;font-size:12px}
  .bar-label{width:40px;color:#6b7280;text-align:right;flex-shrink:0}
  .bar-track{flex:1;background:#1e1e2e;border-radius:4px;height:10px;overflow:hidden}
  .bar-fill{height:100%;background:linear-gradient(90deg,#7c3aed,#a78bfa);border-radius:4px;transition:width .3s}
  .bar-val{width:52px;color:#d1d5db;text-align:right;flex-shrink:0}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;color:#6b7280;font-weight:500;padding:0 8px 10px 0;border-bottom:1px solid #1e1e2e}
  td{padding:9px 8px 9px 0;border-bottom:1px solid #111120;color:#d1d5db;word-break:break-all}
  td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  td.green{color:#4ade80}
  footer{margin-top:24px;font-size:11px;color:#3f3f5a;text-align:center}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="logo">toon<span>gate</span></div>
    <div class="badge">savings dashboard</div>
  </header>

  <div class="cards">
    <div class="card">
      <div class="card-label">Tokens saved</div>
      <div class="card-value purple">${fmt(totalTokens)}</div>
    </div>
    <div class="card">
      <div class="card-label">USD saved</div>
      <div class="card-value green">$${totalUsd.toFixed(4)}</div>
    </div>
    <div class="card">
      <div class="card-label">Requests</div>
      <div class="card-value blue">${fmt(totalReqs)}</div>
    </div>
    <div class="card">
      <div class="card-label">Compression</div>
      <div class="card-value amber">${compressionRate}%</div>
    </div>
  </div>

  <section>
    <h2>Tokens saved · last 14 days</h2>
    ${barRows || '<p style="color:#3f3f5a;font-size:13px">No data yet.</p>'}
  </section>

  <section>
    <h2>By model</h2>
    <table>
      <thead><tr><th>Model</th><th style="text-align:right">Reqs</th><th style="text-align:right">Tokens saved</th><th style="text-align:right">USD saved</th></tr></thead>
      <tbody>${modelRows || '<tr><td colspan="4" style="color:#3f3f5a">No data yet.</td></tr>'}</tbody>
    </table>
  </section>

  <footer>generated ${generatedAt} · <a href="/savings/summary" style="color:#3f3f5a">JSON API</a></footer>
</div>
</body>
</html>`;

  return new Response(html, {
    headers: { "content-type": "text/html;charset=utf-8" },
  });
});

export default app;
