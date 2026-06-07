import { Hono } from "hono";
import { adminAuth } from "../middleware/admin-auth";
import { circuitStats } from "../lib/circuit-breaker";

const app = new Hono<{ Bindings: Env }>();

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escPromLabel(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

app.use("*", adminAuth);

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

  const rawLimit = parseInt(c.req.query("limit") ?? "50", 10);
  const rawOffset = parseInt(c.req.query("offset") ?? "0", 10);
  const limit = Math.min(isNaN(rawLimit) ? 50 : Math.max(rawLimit, 1), 500);
  const offset = isNaN(rawOffset) ? 0 : Math.max(rawOffset, 0);

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

interface ByModelRow {
  model: string;
  request_count: number;
  tokens_saved: number;
  usd_saved: number;
}

// GET /savings/by-model — savings totals grouped by model, sorted by tokens_saved desc
app.get("/savings/by-model", async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: "DB binding not configured" }, 503);

  const result = await db
    .prepare(
      `SELECT model,
              COUNT(*)                  AS request_count,
              SUM(tokens_saved)         AS tokens_saved,
              ROUND(SUM(usd_saved), 6)  AS usd_saved
       FROM savings
       GROUP BY model
       ORDER BY tokens_saved DESC`,
    )
    .all<ByModelRow>();

  return c.json({ rows: result.results });
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
      const label = escHtml(r.day.slice(5)); // MM-DD
      const loClass = pct < 10 ? " lo" : "";
      return `<div class="bar-row">
        <span class="bar-day">${label}</span>
        <div class="bar-track"><div class="bar-fill${loClass}" style="width:${pct}%"></div></div>
        <span class="bar-num">${fmt(r.tokens_saved)}</span>
      </div>`;
    })
    .join("\n");

  const modelRows = (byModel.results ?? [])
    .map(
      (m) => `<tr>
      <td><div class="model-name"><div class="model-dot"></div><span class="hi">${escHtml(m.model)}</span></div></td>
      <td class="r">${fmt(m.requests)}</td>
      <td class="r">${fmt(m.total_tokens_saved)}</td>
      <td class="r hi">$${m.total_usd_saved.toFixed(4)}</td>
    </tr>`,
    )
    .join("\n");

  const generatedAt = new Date().toUTCString();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Toongate · Savings</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  :root{
    --bg:#000;--surface:#0a0a0a;--surface2:#111;
    --border:#1a1a1a;--border2:#222;
    --fg:#ededed;--muted:#888;--dim:#333;
    --blue:#0070f3;--green:#50e3c2;--white:#fff;
  }
  body{background:var(--bg);color:var(--fg);font-family:'Geist',system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.5;min-height:100vh;padding:40px 24px}
  .wrap{max-width:760px;margin:0 auto}

  /* nav */
  nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:48px}
  .wordmark{font-size:15px;font-weight:600;color:var(--white);letter-spacing:-.3px;display:flex;align-items:center;gap:8px}
  .wordmark svg{opacity:.9}
  .nav-right{display:flex;align-items:center;gap:16px}
  .pill{font-size:11px;background:var(--surface2);border:1px solid var(--border2);color:var(--muted);border-radius:100px;padding:3px 10px}
  .ts-pill{font-size:11px;color:var(--dim)}

  /* page title */
  .page-head{margin-bottom:32px}
  .page-title{font-size:24px;font-weight:700;letter-spacing:-.6px;color:var(--white);margin-bottom:4px}
  .page-sub{font-size:13px;color:var(--muted)}

  /* stat cards */
  .cards{display:grid;grid-template-columns:repeat(2,1fr);gap:1px;background:var(--border);border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:24px}
  @media(min-width:500px){.cards{grid-template-columns:repeat(4,1fr)}}
  .card{background:var(--surface);padding:20px;position:relative}
  .card-label{font-size:11px;font-weight:500;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;margin-bottom:10px}
  .card-value{font-size:28px;font-weight:700;letter-spacing:-1.5px;color:var(--white);line-height:1}
  .card-value.accent{color:var(--blue)}
  .card-value.teal{color:var(--green)}

  /* section */
  .section{border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:16px}
  .section-header{background:var(--surface);border-bottom:1px solid var(--border);padding:12px 20px;display:flex;align-items:center;justify-content:space-between}
  .section-title{font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.5px}
  .section-hint{font-size:11px;color:var(--dim)}
  .section-body{background:var(--bg);padding:20px}

  /* bar chart */
  .bar-row{display:grid;grid-template-columns:42px 1fr 60px;align-items:center;gap:12px;margin-bottom:9px}
  .bar-row:last-child{margin-bottom:0}
  .bar-day{font-size:11px;color:var(--muted);text-align:right;font-variant-numeric:tabular-nums}
  .bar-track{background:var(--surface2);border-radius:2px;height:8px;overflow:hidden;position:relative}
  .bar-fill{position:absolute;left:0;top:0;height:100%;background:var(--white);border-radius:2px;opacity:.9}
  .bar-fill.lo{background:var(--dim);opacity:1}
  .bar-num{font-size:11px;color:var(--muted);text-align:right;font-variant-numeric:tabular-nums}

  /* table */
  table{width:100%;border-collapse:collapse;font-size:13px}
  .section-body.table-wrap{padding:0}
  th{font-size:11px;font-weight:500;color:var(--muted);text-align:left;padding:12px 20px;border-bottom:1px solid var(--border);text-transform:uppercase;letter-spacing:.4px}
  th.r{text-align:right}
  td{padding:13px 20px;border-bottom:1px solid var(--border);color:var(--fg);vertical-align:middle}
  tr:last-child td{border-bottom:none}
  tbody tr:hover td{background:var(--surface)}
  td.r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--muted)}
  td.hi{color:var(--white);font-weight:500}
  .model-name{display:flex;align-items:center;gap:10px}
  .model-dot{width:6px;height:6px;border-radius:50%;background:var(--blue);flex-shrink:0}

  /* footer */
  footer{margin-top:32px;display:flex;justify-content:space-between;align-items:center}
  .footer-left{font-size:11px;color:var(--dim)}
  .footer-right{display:flex;gap:16px}
  .footer-right a{font-size:11px;color:var(--dim);text-decoration:none;display:flex;align-items:center;gap:4px}
  .footer-right a:hover{color:var(--muted)}
  .arrow{font-size:10px}
</style>
</head>
<body>
<div class="wrap">

  <nav>
    <div class="wordmark">
      toongate
    </div>
    <div class="nav-right">
      <span class="pill">savings</span>
      <span class="ts-pill">${generatedAt}</span>
    </div>
  </nav>

  <div class="page-head">
    <div class="page-title">Savings Overview</div>
    <div class="page-sub">Token compression savings across all requests</div>
  </div>

  <div class="cards">
    <div class="card">
      <div class="card-label">Tokens Saved</div>
      <div class="card-value">${fmt(totalTokens)}</div>
    </div>
    <div class="card">
      <div class="card-label">USD Saved</div>
      <div class="card-value teal">$${totalUsd.toFixed(4)}</div>
    </div>
    <div class="card">
      <div class="card-label">Requests</div>
      <div class="card-value accent">${fmt(totalReqs)}</div>
    </div>
    <div class="card">
      <div class="card-label">Compression</div>
      <div class="card-value">${compressionRate}%</div>
    </div>
  </div>

  <div class="section">
    <div class="section-header">
      <span class="section-title">Tokens Saved</span>
      <span class="section-hint">Last 14 days</span>
    </div>
    <div class="section-body">
      ${barRows || '<span style="font-size:13px;color:var(--dim)">No data yet.</span>'}
    </div>
  </div>

  <div class="section">
    <div class="section-header">
      <span class="section-title">By Model</span>
    </div>
    <div class="section-body table-wrap">
      <table>
        <thead><tr><th>Model</th><th class="r">Requests</th><th class="r">Tokens Saved</th><th class="r">USD Saved</th></tr></thead>
        <tbody>${modelRows || '<tr><td colspan="4" style="color:var(--dim);text-align:center;padding:20px">No data yet.</td></tr>'}</tbody>
      </table>
    </div>
  </div>

  <footer>
    <span class="footer-left">toongate · savings dashboard</span>
    <div class="footer-right">
      <a href="/savings/summary">JSON API <span class="arrow">↗</span></a>
      <a href="/savings/history">History <span class="arrow">↗</span></a>
    </div>
  </footer>

</div>
</body>
</html>`;

  return new Response(html, {
    headers: { "content-type": "text/html;charset=utf-8" },
  });
});

interface MetricsRow {
  model: string;
  endpoint: string;
  requests: number;
  tokens_saved: number;
  usd_saved: number;
}

// GET /metrics — Prometheus text format, ADMIN_KEY protected
app.get("/metrics", async (c) => {
  const db = c.env.DB;
  if (!db) return c.text("# DB binding not configured\n", 503);

  const rows = await db
    .prepare(
      `SELECT model, endpoint,
              COUNT(*)                  AS requests,
              SUM(tokens_saved)         AS tokens_saved,
              ROUND(SUM(usd_saved), 6)  AS usd_saved
       FROM savings
       GROUP BY model, endpoint
       ORDER BY tokens_saved DESC`,
    )
    .all<MetricsRow>();

  const overall = await db
    .prepare(
      `SELECT COUNT(*) AS requests,
              SUM(tokens_saved) AS tokens_saved,
              COUNT(CASE WHEN tokens_saved > 0 THEN 1 END) AS compressed_requests
       FROM savings`,
    )
    .first<{ requests: number; tokens_saved: number; compressed_requests: number }>();

  const cb = circuitStats();
  const lines: string[] = [];

  lines.push("# HELP toongate_requests_total Total number of requests processed by toongate");
  lines.push("# TYPE toongate_requests_total counter");
  for (const r of rows.results ?? []) {
    lines.push(`toongate_requests_total{model="${escPromLabel(r.model)}",endpoint="${escPromLabel(r.endpoint)}"} ${r.requests}`);
  }

  lines.push("# HELP toongate_tokens_saved_total Total tokens saved by TOON compression");
  lines.push("# TYPE toongate_tokens_saved_total counter");
  for (const r of rows.results ?? []) {
    lines.push(`toongate_tokens_saved_total{model="${escPromLabel(r.model)}",endpoint="${escPromLabel(r.endpoint)}"} ${r.tokens_saved}`);
  }

  lines.push("# HELP toongate_usd_saved_total Estimated USD saved by TOON compression");
  lines.push("# TYPE toongate_usd_saved_total counter");
  for (const r of rows.results ?? []) {
    lines.push(`toongate_usd_saved_total{model="${escPromLabel(r.model)}",endpoint="${escPromLabel(r.endpoint)}"} ${r.usd_saved}`);
  }

  lines.push("# HELP toongate_requests_compressed_total Total number of requests where compression was applied");
  lines.push("# TYPE toongate_requests_compressed_total counter");
  lines.push(`toongate_requests_compressed_total ${overall?.compressed_requests ?? 0}`);

  lines.push("# HELP toongate_requests_all_total Total requests across all models and endpoints");
  lines.push("# TYPE toongate_requests_all_total counter");
  lines.push(`toongate_requests_all_total ${overall?.requests ?? 0}`);

  lines.push("# HELP toongate_circuit_breaker_tripped Whether the circuit breaker is currently open (1=open 0=closed)");
  lines.push("# TYPE toongate_circuit_breaker_tripped gauge");
  lines.push(`toongate_circuit_breaker_tripped ${cb.tripped ? 1 : 0}`);

  lines.push("# HELP toongate_circuit_breaker_errors_in_window Error count in the current sliding window");
  lines.push("# TYPE toongate_circuit_breaker_errors_in_window gauge");
  lines.push(`toongate_circuit_breaker_errors_in_window ${cb.errors}`);

  return new Response(lines.join("\n") + "\n", {
    headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8" },
  });
});

export default app;
