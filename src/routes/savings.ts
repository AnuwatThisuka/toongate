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
      const dimClass = pct < 10 ? " dim" : "";
      return `<div class="bar-row">
        <span class="bar-day">${label}</span>
        <div class="bar-track"><div class="bar-fill${dimClass}" style="width:${pct}%"></div></div>
        <span class="bar-num">${fmt(r.tokens_saved)}</span>
      </div>`;
    })
    .join("\n");

  const modelRows = (byModel.results ?? [])
    .map(
      (m) => `<tr>
      <td><span class="dot"></span>${m.model}</td>
      <td class="r">${fmt(m.requests)}</td>
      <td class="r">${fmt(m.total_tokens_saved)}</td>
      <td class="r green">$${m.total_usd_saved.toFixed(4)}</td>
    </tr>`,
    )
    .join("\n");

  const generatedAt = new Date().toUTCString();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>toongate ~ savings</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  :root{
    --bg:#080b0f;--surface:#0e1117;--border:#1a2030;--border2:#222c3c;
    --fg:#c9d1d9;--muted:#4a5568;--dim:#2d3748;
    --green:#39d353;--cyan:#58a6ff;--yellow:#e3b341;--red:#f85149;--purple:#bc8cff;
  }
  body{background:var(--bg);color:var(--fg);font-family:'JetBrains Mono',ui-monospace,'Cascadia Code',monospace;font-size:13px;min-height:100vh;padding:28px 20px}
  .wrap{max-width:740px;margin:0 auto}

  /* header */
  .header{display:flex;align-items:baseline;gap:0;margin-bottom:28px;padding-bottom:16px;border-bottom:1px solid var(--border)}
  .prompt{color:var(--green);margin-right:6px}
  .cmd{color:var(--fg);font-weight:700;font-size:15px}
  .cmd .arg{color:var(--cyan)}
  .ts{margin-left:auto;color:var(--muted);font-size:11px}

  /* stat grid */
  .stats{display:grid;grid-template-columns:repeat(2,1fr);gap:1px;background:var(--border);border:1px solid var(--border);margin-bottom:20px}
  @media(min-width:480px){.stats{grid-template-columns:repeat(4,1fr)}}
  .stat{background:var(--surface);padding:14px 16px}
  .stat-key{color:var(--muted);font-size:10px;letter-spacing:.5px;margin-bottom:6px}
  .stat-key::before{content:'# ';color:var(--dim)}
  .stat-val{font-size:22px;font-weight:700;line-height:1;letter-spacing:-1px}
  .g{color:var(--green)}.c{color:var(--cyan)}.y{color:var(--yellow)}.p{color:var(--purple)}

  /* section */
  .block{border:1px solid var(--border);margin-bottom:16px;background:var(--surface)}
  .block-title{background:var(--border);color:var(--muted);font-size:10px;letter-spacing:.8px;padding:5px 12px;display:flex;justify-content:space-between;align-items:center}
  .block-title .hint{color:var(--dim)}
  .block-body{padding:16px}

  /* bar chart */
  .bar-row{display:grid;grid-template-columns:44px 1fr 56px;align-items:center;gap:10px;margin-bottom:7px}
  .bar-day{color:var(--muted);text-align:right;font-size:11px}
  .bar-track{background:var(--dim);height:9px;position:relative;overflow:hidden}
  .bar-fill{height:100%;background:var(--green);position:absolute;left:0;top:0}
  .bar-fill.dim{background:#1a3a2a}
  .bar-num{color:var(--fg);text-align:right;font-size:11px;font-variant-numeric:tabular-nums}

  /* table */
  table{width:100%;border-collapse:collapse;font-size:12px}
  thead td{color:var(--muted);padding:0 12px 8px 0;font-size:10px;letter-spacing:.5px;border-bottom:1px solid var(--border2)}
  thead td::before{content:'// ';color:var(--dim)}
  tbody tr:hover{background:#0d1520}
  td{padding:8px 12px 8px 0;border-bottom:1px solid var(--border);color:var(--fg);word-break:break-all;vertical-align:middle}
  td.r{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
  td.green{color:var(--green)}
  .dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--green);margin-right:8px;vertical-align:middle}

  /* footer */
  .footer{margin-top:20px;color:var(--dim);font-size:10px;display:flex;justify-content:space-between}
  a{color:var(--muted);text-decoration:none}
  a:hover{color:var(--cyan)}
</style>
</head>
<body>
<div class="wrap">

  <div class="header">
    <span class="prompt">❯</span>
    <span class="cmd">toongate <span class="arg">savings</span> --dashboard</span>
    <span class="ts">${generatedAt}</span>
  </div>

  <div class="stats">
    <div class="stat"><div class="stat-key">tokens_saved</div><div class="stat-val p">${fmt(totalTokens)}</div></div>
    <div class="stat"><div class="stat-key">usd_saved</div><div class="stat-val g">$${totalUsd.toFixed(4)}</div></div>
    <div class="stat"><div class="stat-key">requests</div><div class="stat-val c">${fmt(totalReqs)}</div></div>
    <div class="stat"><div class="stat-key">compression</div><div class="stat-val y">${compressionRate}%</div></div>
  </div>

  <div class="block">
    <div class="block-title">TOKENS SAVED <span class="hint">last 14 days</span></div>
    <div class="block-body">
      ${
        barRows ||
        '<span style="color:var(--dim)">// no data yet</span>'
      }
    </div>
  </div>

  <div class="block">
    <div class="block-title">BY MODEL</div>
    <div class="block-body" style="padding:0 16px">
      <table>
        <thead><tr><td>model</td><td class="r">reqs</td><td class="r">tokens_saved</td><td class="r">usd_saved</td></tr></thead>
        <tbody>${modelRows || '<tr><td colspan="4" style="color:var(--dim);padding:12px 0">// no data yet</td></tr>'}</tbody>
      </table>
    </div>
  </div>

  <div class="footer">
    <span>toongate/savings-dashboard</span>
    <span><a href="/savings/summary">GET /savings/summary</a> · <a href="/savings/history">GET /savings/history</a></span>
  </div>

</div>
</body>
</html>`;

  return new Response(html, {
    headers: { "content-type": "text/html;charset=utf-8" },
  });
});

export default app;
