#!/usr/bin/env node
// ============================================================
// toongate Compression Diagnostic
//
// Tests compression behaviour in isolation — no real LLM call
// needed. Sends payloads directly to toongate and reads the
// X-Toongate-* headers to confirm what the eligibility scorer
// and TOON encoder actually see.
//
// Usage:
//   node toongate-compress-test.mjs [toongate-url] [proxy-key]
//
// Example:
//   PROXY_AUTH_KEY=xxx node toongate-compress-test.mjs https://toongate.slughook.com
// ============================================================

const TOONGATE_URL = process.argv[2] || "http://localhost:8787";
const PROXY_KEY = process.argv[3] || process.env.PROXY_AUTH_KEY || "";

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m",
};
const bold   = (s) => `${C.bold}${s}${C.reset}`;
const green  = (s) => `${C.green}${s}${C.reset}`;
const red    = (s) => `${C.red}${s}${C.reset}`;
const yellow = (s) => `${C.yellow}${s}${C.reset}`;
const cyan   = (s) => `${C.cyan}${s}${C.reset}`;
const dim    = (s) => `${C.dim}${s}${C.reset}`;

// ── Payloads ─────────────────────────────────────────────────
//
// Case A  content = string                 → scorer sees string → score 0.0 → no compression
// Case B  content = [{type,text}×2]        → deep compress detects JSON array inside .text ✓
//                                            (the common RAG pattern — works since deep-compress)
// Case C  content = [data objects]         → top-level compress, best savings ✓
// Case D  content = string (plain text)    → score 0.0, pass-through (correct)

const RAG_ROWS = [
  { id: 1, title: "TOON Format Intro",      score: 0.91, url: "https://toonformat.dev/intro",     snippet: "TOON encodes uniform arrays compactly, cutting tokens by up to 40%." },
  { id: 2, title: "Cloudflare Workers",      score: 0.87, url: "https://workers.cloudflare.com",   snippet: "Run code globally at the edge with sub-millisecond cold starts." },
  { id: 3, title: "LLM Cost Optimization",  score: 0.84, url: "https://example.com/llm",          snippet: "Structured data compression is one of the best strategies at scale." },
  { id: 4, title: "RAG Best Practices",     score: 0.79, url: "https://example.com/rag",          snippet: "Uniform, well-structured chunks are critical for good RAG performance." },
  { id: 5, title: "Hono Edge Framework",    score: 0.76, url: "https://hono.dev",                 snippet: "Lightweight framework built specifically for Cloudflare Workers." },
];

const DB_ROWS = Array.from({ length: 10 }, (_, i) => ({
  user_id: 1000 + i,
  name: `User ${i + 1}`,
  plan: ["free", "pro", "enterprise"][i % 3],
  requests_today: [842, 23, 5241, 312, 8, 1200, 3400, 56, 789, 2100][i],
  tokens_used:    [124500, 4200, 892000, 48900, 1100, 67000, 320000, 890, 145000, 89000][i],
  joined: `2024-0${(i % 9) + 1}-01`,
}));

const PRODUCT_ROWS = [
  { sku: "T001", name: "Claude API",          category: "AI",          price: 20.0, stock: 999, rating: 4.9 },
  { sku: "T002", name: "GitHub Copilot",      category: "AI",          price: 19.0, stock: 999, rating: 4.7 },
  { sku: "T003", name: "Vercel Pro",          category: "Hosting",     price: 20.0, stock: 999, rating: 4.8 },
  { sku: "T004", name: "PlanetScale",         category: "Database",    price: 29.0, stock: 999, rating: 4.6 },
  { sku: "T005", name: "Cloudflare Workers",  category: "Edge",        price:  5.0, stock: 999, rating: 4.9 },
  { sku: "T006", name: "Datadog",             category: "Observability",price: 15.0, stock: 999, rating: 4.5 },
];

const CASES = [
  {
    label: "A — content: string (data embedded as JSON string)",
    note:  "scorer sees string → score 0.0 → no compression",
    payload: {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: `Summarize:\n${JSON.stringify(RAG_ROWS)}` }],
    },
  },
  {
    label: "B — content: [{type,text}×2] (text-part array, embedded JSON)",
    note:  "deep compress detects JSON array inside .text → compresses ✓ (real-world RAG pattern)",
    payload: {
      model: "gpt-4o-mini",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Summarize:" },
          { type: "text", text: JSON.stringify(RAG_ROWS) },
        ],
      }],
    },
  },
  {
    label: "C — content: [data objects] — RAG rows (5 rows)",
    note:  "scorer sees 5-item uniform array → score 1.0, TOON shrinks reliably ✓",
    payload: {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: RAG_ROWS }],
    },
  },
  {
    label: "C — content: [data objects] — DB rows (10 rows)",
    note:  "scorer sees 10-item uniform array → score 1.0 ✓",
    payload: {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: DB_ROWS }],
    },
  },
  {
    label: "C — content: [data objects] — Product catalog (6 rows)",
    note:  "scorer sees 6-item uniform array → score 1.0 ✓",
    payload: {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: PRODUCT_ROWS }],
    },
  },
  {
    label: "D — content: string (plain text baseline)",
    note:  "scorer sees string → score 0.0 → pass-through (correct)",
    payload: {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "What is the capital of Thailand?" }],
    },
  },
];

// ── Runner ───────────────────────────────────────────────────

async function probe(payload) {
  const body = JSON.stringify(payload);
  const headers = { "Content-Type": "application/json" };
  if (PROXY_KEY) headers["Authorization"] = `Bearer ${PROXY_KEY}`;

  const res = await fetch(`${TOONGATE_URL}/v1/chat/completions`, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(15000),
  }).catch((err) => ({ ok: false, _err: err.message }));

  if (res._err) return { error: res._err };

  await res.text().catch(() => {});

  return {
    status:     res.status,
    compressed: res.headers.get("x-toongate-compressed"),
    deep:       res.headers.get("x-toongate-deep-compressed"),
    score:      res.headers.get("x-toongate-eligibility-score"),
    before:     res.headers.get("x-toongate-tokens-before"),
    after:      res.headers.get("x-toongate-tokens-after"),
    saved:      res.headers.get("x-toongate-tokens-saved"),
    bodyBytes:  body.length,
  };
}

// ── Main ─────────────────────────────────────────────────────

console.log(`
${bold("╔══════════════════════════════════════════════╗")}
${bold("║     toongate Compression Diagnostic          ║")}
${bold("╚══════════════════════════════════════════════╝")}

  ${bold("Target")}  : ${cyan(TOONGATE_URL)}
  ${bold("Auth")}    : ${PROXY_KEY ? green("PROXY_AUTH_KEY set ✓") : yellow("PROXY_AUTH_KEY not set ⚠")}
`);

for (const { label, note, payload } of CASES) {
  process.stdout.write(`  ${bold(label)}\n  ${dim(note)}\n`);

  const r = await probe(payload);

  if (r.error) {
    console.log(`  ${red("Error:")} ${r.error}\n`);
    continue;
  }

  const compressed = r.compressed === "true";
  const pct = r.before && r.after && r.before !== "0"
    ? (((r.before - r.after) / r.before) * 100).toFixed(1)
    : "0.0";

  console.log(
    `  ${dim("├─")} HTTP status       : ${r.status === 200 ? green(r.status) : yellow(r.status)} ${dim("(upstream errors are expected without a real API key)")}`
  );
  console.log(`  ${dim("├─")} Eligibility score : ${r.score ?? dim("n/a")}`);
  const deepCompressed = r.deep === "true";
  console.log(`  ${dim("├─")} Compressed        : ${compressed ? green("true ✓") : red("false ✗")}${deepCompressed ? dim(" (deep)") : ""}`);
  console.log(`  ${dim("├─")} Tokens before     : ${r.before ?? dim("n/a")}`);
  console.log(`  ${dim("├─")} Tokens after      : ${r.after  ?? dim("n/a")}`);
  console.log(`  ${dim("├─")} Tokens saved      : ${compressed ? green(r.saved) : dim("0")}`);
  console.log(`  ${dim("└─")} Saving %          : ${compressed ? green(pct + "%") : dim("0%")}`);
  console.log();
}

console.log(`${dim("─".repeat(48))}

  ${bold("Key takeaways")}

  ${green("✓")} Case B (text-parts + embedded JSON) — deep compression detects the JSON
      array inside content[].text and compresses it. This is the real-world RAG pattern.

  ${green("✓")} Case C (native data array) — top-level compression, best savings.

  ${red("✗")} Case A (plain string content) — no compression. Plain strings score 0.0
      even when they contain JSON. Wrap content in an array to enable compression.

  ${red("✗")} Case D (plain text) — correct, nothing to compress.

  ${bold("Compression path summary:")}
  content[].text contains JSON array  →  deep compress  →  X-Toongate-Deep-Compressed: true
  content is a native data array      →  top-level      →  X-Toongate-Compressed: true
  content is a plain string           →  pass-through   →  no savings

${dim("─".repeat(48))}
`);
