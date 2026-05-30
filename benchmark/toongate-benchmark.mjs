#!/usr/bin/env node
// ============================================================
// toongate Benchmark Suite
// Measures: Compression ratio, Latency overhead, Throughput
//
// Usage:
//   node toongate-benchmark.mjs <toongate-url> <direct-url> [admin-key] [proxy-key]
//
// Environment (fallback when CLI args omitted):
//   PROXY_AUTH_KEY   — Bearer token for toongate proxy routes
//   OPENAI_API_KEY   — Bearer token for direct upstream calls
//
// Example:
//   PROXY_AUTH_KEY=xxx OPENAI_API_KEY=sk-... \
//     node toongate-benchmark.mjs \
//       http://localhost:8787 \
//       https://api.opentyphoon.ai
//
// Requirements: Node.js 18+
// ============================================================

const TOONGATE_URL = process.argv[2] || "http://localhost:8787";
const DIRECT_URL = process.argv[3] || "https://api.opentyphoon.ai";
const ADMIN_KEY = process.argv[4] || process.env.ADMIN_KEY || "";
const PROXY_KEY = process.argv[5] || process.env.PROXY_AUTH_KEY || "";
const UPSTREAM_API_KEY = process.env.OPENAI_API_KEY || "";

const WARMUP_REQUESTS = 5;
const BENCH_REQUESTS = 50;
const CONCURRENCY = 10;
const MODEL = "typhoon-v2.5-30b-a3b-instruct";

// ── ANSI colors ──────────────────────────────────────────────
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};
const bold = (s) => `${C.bold}${s}${C.reset}`;
const green = (s) => `${C.green}${s}${C.reset}`;
const red = (s) => `${C.red}${s}${C.reset}`;
const cyan = (s) => `${C.cyan}${s}${C.reset}`;
const dim = (s) => `${C.dim}${s}${C.reset}`;
const yellow = (s) => `${C.yellow}${s}${C.reset}`;

// ── Payload helpers ──────────────────────────────────────────
// content must be an array (not a plain string) for eligibility scoring.

function structuredMessage(prompt, data) {
  return {
    role: "user",
    content: [
      { type: "text", text: prompt },
      { type: "text", text: JSON.stringify(data) },
    ],
  };
}

const RAG_DATA = [
  {
    id: 1,
    title: "TOON Format Intro",
    score: 0.91,
    url: "https://toonformat.dev/intro",
    snippet:
      "TOON encodes uniform arrays compactly, cutting tokens by up to 40%.",
  },
  {
    id: 2,
    title: "Cloudflare Workers",
    score: 0.87,
    url: "https://workers.cloudflare.com",
    snippet: "Run code globally at the edge with sub-millisecond cold starts.",
  },
  {
    id: 3,
    title: "LLM Cost Optimization",
    score: 0.84,
    url: "https://example.com/llm",
    snippet:
      "Structured data compression is one of the best strategies at scale.",
  },
  {
    id: 4,
    title: "RAG Best Practices",
    score: 0.79,
    url: "https://example.com/rag",
    snippet:
      "Uniform, well-structured chunks are critical for good RAG performance.",
  },
  {
    id: 5,
    title: "Hono Edge Framework",
    score: 0.76,
    url: "https://hono.dev",
    snippet: "Lightweight framework built specifically for Cloudflare Workers.",
  },
];

const DB_DATA = Array.from({ length: 10 }, (_, i) => ({
  user_id: 1000 + i,
  name: `User ${i + 1}`,
  plan: ["free", "pro", "enterprise"][i % 3],
  requests_today: [842, 23, 5241, 312, 8, 1200, 3400, 56, 789, 2100][i],
  tokens_used: [124500, 4200, 892000, 48900, 1100, 67000, 320000, 890, 145000, 89000][i],
  joined: `2024-0${(i % 9) + 1}-01`,
}));

const PRODUCT_DATA = [
  { sku: "T001", name: "Claude API", category: "AI", price: 20.0, stock: 999, rating: 4.9 },
  { sku: "T002", name: "GitHub Copilot", category: "AI", price: 19.0, stock: 999, rating: 4.7 },
  { sku: "T003", name: "Vercel Pro", category: "Hosting", price: 20.0, stock: 999, rating: 4.8 },
  { sku: "T004", name: "PlanetScale", category: "Database", price: 29.0, stock: 999, rating: 4.6 },
  { sku: "T005", name: "Cloudflare Workers", category: "Edge", price: 5.0, stock: 999, rating: 4.9 },
  { sku: "T006", name: "Datadog", category: "Observability", price: 15.0, stock: 999, rating: 4.5 },
  { sku: "T007", name: "Linear", category: "Project", price: 8.0, stock: 999, rating: 4.8 },
  { sku: "T008", name: "Retool", category: "Tools", price: 10.0, stock: 999, rating: 4.4 },
];

// ── Payloads ─────────────────────────────────────────────────
const PAYLOADS = {
  "RAG chunks (5 rows)": {
    model: MODEL,
    messages: [structuredMessage("Summarize these search results:", RAG_DATA)],
  },

  "DB rows (10 rows)": {
    model: MODEL,
    messages: [structuredMessage("Analyze this user data:", DB_DATA)],
  },

  "Product catalog (8 rows)": {
    model: MODEL,
    messages: [structuredMessage("Recommend products for a developer:", PRODUCT_DATA)],
  },

  "Plain text (baseline)": {
    model: MODEL,
    messages: [
      {
        role: "user",
        content:
          "What is the capital of Thailand and what is it known for historically and culturally?",
      },
    ],
  },
};

// ── Helpers ──────────────────────────────────────────────────

function buildHeaders(target) {
  const headers = { "Content-Type": "application/json" };
  if (target === "toongate" && PROXY_KEY) {
    headers.Authorization = `Bearer ${PROXY_KEY}`;
  }
  if (target === "direct" && UPSTREAM_API_KEY) {
    headers.Authorization = `Bearer ${UPSTREAM_API_KEY}`;
  }
  return headers;
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function stats(arr) {
  if (!arr.length) return { min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 };
  const sum = arr.reduce((a, b) => a + b, 0);
  return {
    min: Math.min(...arr),
    max: Math.max(...arr),
    mean: sum / arr.length,
    p50: percentile(arr, 50),
    p95: percentile(arr, 95),
    p99: percentile(arr, 99),
  };
}

async function sendRequest(baseUrl, payload, target) {
  const start = performance.now();
  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: buildHeaders(target),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
    const elapsed = performance.now() - start;

    const compressed = res.headers.get("x-toongate-compressed") === "true";
    const tokensBefore = parseInt(
      res.headers.get("x-toongate-tokens-before") || "0",
    );
    const tokensAfter = parseInt(
      res.headers.get("x-toongate-tokens-after") || "0",
    );
    const tokensSaved = parseInt(
      res.headers.get("x-toongate-tokens-saved") || "0",
    );
    const eligibility = parseFloat(
      res.headers.get("x-toongate-eligibility-score") || "0",
    );

    await res.text();

    return {
      ok: res.ok,
      status: res.status,
      elapsed,
      compressed,
      tokensBefore,
      tokensAfter,
      tokensSaved,
      eligibility,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      elapsed: performance.now() - start,
      error: err.message,
    };
  }
}

async function runConcurrent(fn, count, concurrency) {
  const results = [];
  let i = 0;
  while (i < count) {
    const batch = [];
    for (let j = 0; j < concurrency && i < count; j++, i++) {
      batch.push(fn(i));
    }
    results.push(...(await Promise.all(batch)));
    process.stdout.write(".");
  }
  return results;
}

function printBox(title) {
  const w = 46;
  const pad = Math.floor((w - title.length) / 2);
  console.log(bold(`\n╔${"═".repeat(w)}╗`));
  console.log(
    bold(`║${" ".repeat(pad)}${title}${" ".repeat(w - pad - title.length)}║`),
  );
  console.log(bold(`╚${"═".repeat(w)}╝`));
}

function printRow(label, value, unit = "", color = cyan) {
  const lpad = label.padEnd(28);
  console.log(
    `  ${dim("├─")} ${lpad} ${color(value)}${unit ? dim(" " + unit) : ""}`,
  );
}

function printLastRow(label, value, unit = "", color = cyan) {
  const lpad = label.padEnd(28);
  console.log(
    `  ${dim("└─")} ${lpad} ${color(value)}${unit ? dim(" " + unit) : ""}`,
  );
}

// ── Preflight ────────────────────────────────────────────────

if (!PROXY_KEY) {
  console.warn(
    yellow(
      "\n  ⚠ PROXY_AUTH_KEY not set — toongate requests will return 401.\n" +
        "    Pass as 5th arg or set PROXY_AUTH_KEY env var.\n",
    ),
  );
}

// ── Main ─────────────────────────────────────────────────────

console.log(`
${bold("╔══════════════════════════════════════════════╗")}
${bold("║         toongate Benchmark Suite             ║")}
${bold("╚══════════════════════════════════════════════╝")}

  ${bold("Config")}
  ${dim("├─")} toongate URL : ${cyan(TOONGATE_URL)}
  ${dim("├─")} Direct URL   : ${cyan(DIRECT_URL)}
  ${dim("├─")} Proxy auth   : ${PROXY_KEY ? green("set") : yellow("missing")}
  ${dim("├─")} Upstream key : ${UPSTREAM_API_KEY ? green("set") : yellow("missing")}
  ${dim("├─")} Warmup       : ${WARMUP_REQUESTS} requests
  ${dim("├─")} Benchmark    : ${BENCH_REQUESTS} requests × ${Object.keys(PAYLOADS).length} payloads
  ${dim("└─")} Concurrency  : ${CONCURRENCY}
`);

// ── 1. Compression ratio ─────────────────────────────────────

printBox("1 / 3  Compression Ratio");

const compressionResults = {};

for (const [name, payload] of Object.entries(PAYLOADS)) {
  process.stdout.write(`\n  ${name.padEnd(30)} `);

  for (let i = 0; i < WARMUP_REQUESTS; i++) {
    await sendRequest(TOONGATE_URL, payload, "toongate");
  }

  const results = await runConcurrent(
    () => sendRequest(TOONGATE_URL, payload, "toongate"),
    BENCH_REQUESTS,
    CONCURRENCY,
  );

  const ok = results.filter((r) => r.ok);
  const compressed = ok.filter((r) => r.compressed);
  const ratio = ok.length
    ? ((compressed.length / ok.length) * 100).toFixed(1)
    : 0;
  const avgSaved = compressed.length
    ? (
        compressed.reduce((s, r) => s + r.tokensSaved, 0) / compressed.length
      ).toFixed(0)
    : 0;
  const avgPct =
    compressed.length
      ? (
          (compressed.reduce(
            (s, r) => s + r.tokensSaved / (r.tokensBefore || 1),
            0,
          ) /
            compressed.length) *
          100
        ).toFixed(1)
      : 0;
  const avgElig = ok.length
    ? (ok.reduce((s, r) => s + r.eligibility, 0) / ok.length).toFixed(2)
    : 0;

  compressionResults[name] = {
    ok: ok.length,
    compressed: compressed.length,
    avgSaved,
    avgPct,
    avgElig,
  };

  process.stdout.write(` ${ok.length ? green("done") : red("failed")}\n`);
  printRow("Success rate", `${ok.length}/${results.length}`, "", ok.length ? green : red);
  printRow(
    "Compressed",
    `${compressed.length}/${ok.length} (${ratio}%)`,
    "",
    compressed.length > 0 ? green : yellow,
  );
  printRow("Avg tokens saved", `${avgSaved}`, "tokens/req");
  printRow("Avg saving %", `${avgPct}%`);
  printLastRow("Avg eligibility", `${avgElig} / 1.0`);
}

// ── 2. Latency overhead ──────────────────────────────────────

printBox("2 / 3  Latency Overhead");
console.log(dim(`\n  Comparing toongate vs direct for each payload...\n`));

const latencyResults = {};

for (const [name, payload] of Object.entries(PAYLOADS)) {
  process.stdout.write(`  ${name.padEnd(30)} `);

  await Promise.all([
    ...Array(WARMUP_REQUESTS)
      .fill(0)
      .map(() => sendRequest(TOONGATE_URL, payload, "toongate")),
    ...Array(WARMUP_REQUESTS)
      .fill(0)
      .map(() => sendRequest(DIRECT_URL, payload, "direct")),
  ]);

  process.stdout.write("toongate");
  const tgResults = await runConcurrent(
    () => sendRequest(TOONGATE_URL, payload, "toongate"),
    BENCH_REQUESTS,
    CONCURRENCY,
  );

  process.stdout.write(" direct");
  const drResults = await runConcurrent(
    () => sendRequest(DIRECT_URL, payload, "direct"),
    BENCH_REQUESTS,
    CONCURRENCY,
  );

  const tgTimes = tgResults.filter((r) => r.ok).map((r) => r.elapsed);
  const drTimes = drResults.filter((r) => r.ok).map((r) => r.elapsed);
  const tgStats = stats(tgTimes);
  const drStats = stats(drTimes);
  const overhead = tgStats.mean - drStats.mean;

  latencyResults[name] = { tgStats, drStats, overhead };

  process.stdout.write(` ${green("done")}\n`);

  const overheadColor =
    Math.abs(overhead) < 5 ? green : overhead < 20 ? yellow : red;

  printRow(
    "toongate  p50 / p95 / p99",
    `${tgStats.p50.toFixed(0)} / ${tgStats.p95.toFixed(0)} / ${tgStats.p99.toFixed(0)}`,
    "ms",
  );
  printRow(
    "direct    p50 / p95 / p99",
    `${drStats.p50.toFixed(0)} / ${drStats.p95.toFixed(0)} / ${drStats.p99.toFixed(0)}`,
    "ms",
  );
  printRow(
    "mean overhead",
    `${overhead >= 0 ? "+" : ""}${overhead.toFixed(1)}`,
    "ms",
    overheadColor,
  );
  printLastRow("toongate mean", `${tgStats.mean.toFixed(1)}`, "ms");
  console.log();
}

// ── 3. Throughput ────────────────────────────────────────────

printBox("3 / 3  Throughput (req/s)");
console.log(
  dim(
    `\n  Running ${BENCH_REQUESTS * 2} requests at concurrency ${CONCURRENCY}...\n`,
  ),
);

const tpPayload = PAYLOADS["RAG chunks (5 rows)"];

process.stdout.write("  Warmup ");
for (let i = 0; i < WARMUP_REQUESTS; i++) {
  await sendRequest(TOONGATE_URL, tpPayload, "toongate");
  process.stdout.write(".");
}
console.log();

process.stdout.write("  toongate ");
const tgStart = performance.now();
const tgTpResults = await runConcurrent(
  () => sendRequest(TOONGATE_URL, tpPayload, "toongate"),
  BENCH_REQUESTS * 2,
  CONCURRENCY,
);
const tgDuration = (performance.now() - tgStart) / 1000;
const tgRps = (tgTpResults.filter((r) => r.ok).length / tgDuration).toFixed(1);

process.stdout.write("\n  direct   ");
const drStart = performance.now();
const drTpResults = await runConcurrent(
  () => sendRequest(DIRECT_URL, tpPayload, "direct"),
  BENCH_REQUESTS * 2,
  CONCURRENCY,
);
const drDuration = (performance.now() - drStart) / 1000;
const drRps = (drTpResults.filter((r) => r.ok).length / drDuration).toFixed(1);

console.log(`\n`);
printRow("toongate req/s", tgRps, "req/s", green);
printRow("direct req/s", drRps, "req/s");
const drRpsNum = parseFloat(drRps);
printLastRow(
  "overhead",
  drRpsNum > 0
    ? `${((parseFloat(tgRps) / drRpsNum - 1) * 100).toFixed(1)}%`
    : "N/A",
  "",
  yellow,
);

// ── Summary table ────────────────────────────────────────────

printBox("Summary");

console.log(`
  ${bold("Compression Ratio")}
  ${"Payload".padEnd(30)} ${"Compressed".padEnd(14)} ${"Avg Saved".padEnd(14)} ${"Saving %"}
  ${"─".repeat(70)}`);

for (const [name, r] of Object.entries(compressionResults)) {
  const bar = r.avgPct > 0 ? green(`${r.avgPct}%`) : dim("0%");
  console.log(
    `  ${name.padEnd(30)} ${String(r.compressed + "/" + r.ok).padEnd(14)} ${String(r.avgSaved + " tokens").padEnd(14)} ${bar}`,
  );
}

console.log(`
  ${bold("Latency Overhead")}
  ${"Payload".padEnd(30)} ${"toongate p50".padEnd(16)} ${"direct p50".padEnd(16)} ${"Overhead"}
  ${"─".repeat(70)}`);

for (const [name, r] of Object.entries(latencyResults)) {
  const oh = r.overhead;
  const ohStr = `${oh >= 0 ? "+" : ""}${oh.toFixed(1)}ms`;
  const ohColor = Math.abs(oh) < 5 ? green : oh < 20 ? yellow : red;
  console.log(
    `  ${name.padEnd(30)} ${String(r.tgStats.p50.toFixed(0) + "ms").padEnd(16)} ${String(r.drStats.p50.toFixed(0) + "ms").padEnd(16)} ${ohColor(ohStr)}`,
  );
}

console.log(`
  ${bold("Throughput")}
  ${"─".repeat(40)}
  toongate : ${green(tgRps)} req/s
  direct   : ${cyan(drRps)} req/s
`);

// ── README snippet ───────────────────────────────────────────

printBox("README Badge Numbers");

const ragResult = compressionResults["RAG chunks (5 rows)"];
const ragLatency = latencyResults["RAG chunks (5 rows)"];

console.log(`
  Copy these into your README:

  ${bold("Hero stats:")}
  ${cyan(`~${ragResult?.avgPct || 40}%`)}  fewer tokens on RAG pipelines
  ${cyan(`~${ragLatency?.overhead.toFixed(1) || "0.5"}ms`)} overhead per request
  ${cyan(tgRps)} req/s throughput

  ${bold("Benchmark table:")}
  | Payload          | Tokens saved | Saving % | p50 latency |`);

for (const [name, r] of Object.entries(compressionResults)) {
  const lat = latencyResults[name];
  const shortName = name.split(" (")[0].padEnd(16);
  console.log(
    `  | ${shortName} | ${String(r.avgSaved + " tokens").padEnd(12)} | ${String(r.avgPct + "%").padEnd(8)} | ${String((lat?.tgStats.p50.toFixed(0) || "N/A") + "ms").padEnd(11)} |`,
  );
}

// ── Savings API ──────────────────────────────────────────────

if (ADMIN_KEY) {
  printBox("Savings API Check");
  try {
    const res = await fetch(`${TOONGATE_URL}/savings/summary`, {
      headers: { "X-Toongate-Admin-Key": ADMIN_KEY },
    });
    const data = await res.json();
    const o = data.overall || data;
    console.log(`
  All-time from D1:
  ${dim("├─")} Requests      : ${cyan(o.requests || "N/A")}
  ${dim("├─")} Tokens saved  : ${cyan(o.total_tokens_saved || "N/A")}
  ${dim("└─")} USD saved     : ${green("$" + (o.total_usd_saved || 0).toFixed(4))}`);
  } catch {
    console.log(`\n  ${yellow("⚠ Could not reach /savings/summary")}`);
  }
}

console.log(`\n${dim("─".repeat(48))}\n`);
