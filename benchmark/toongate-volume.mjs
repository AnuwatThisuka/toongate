#!/usr/bin/env node
// toongate volume benchmark — req/s + latency p50/p95/p99
//
// Usage:
//   node benchmark/toongate-volume.mjs [url] [concurrency] [total]
//
// Defaults:
//   url         http://localhost:8787/v1/chat/completions
//   concurrency 20
//   total       200

import { performance } from "node:perf_hooks";

const BASE_URL   = process.argv[2] ?? "http://localhost:8787/v1/chat/completions";
const CONCURRENCY = parseInt(process.argv[3] ?? "20", 10);
const TOTAL       = parseInt(process.argv[4] ?? "200", 10);
const AUTH        = process.env.PROXY_AUTH_KEY ?? "";

const PAYLOAD = JSON.stringify({
  model: "gpt-4o",
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "Summarize:" },
        {
          type: "text",
          text: JSON.stringify(
            Array.from({ length: 20 }, (_, i) => ({
              id: i + 1,
              title: `Result ${i + 1}`,
              url: `https://example.com/${i + 1}`,
              snippet: `Snippet for result ${i + 1} with some text content.`,
            }))
          ),
        },
      ],
    },
  ],
});

async function singleRequest() {
  const t0 = performance.now();
  try {
    const res = await fetch(BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(AUTH ? { Authorization: `Bearer ${AUTH}` } : {}),
      },
      body: PAYLOAD,
    });
    const elapsed = performance.now() - t0;
    return { ok: res.ok, status: res.status, ms: elapsed };
  } catch (err) {
    return { ok: false, status: 0, ms: performance.now() - t0, err: String(err) };
  }
}

function percentile(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function run() {
  console.log(`\ntoongate volume benchmark`);
  console.log(`  url         ${BASE_URL}`);
  console.log(`  concurrency ${CONCURRENCY}`);
  console.log(`  total       ${TOTAL}\n`);

  const results = [];
  let completed = 0;
  let errors = 0;

  const wallStart = performance.now();

  // Dispatch in batches of CONCURRENCY
  for (let i = 0; i < TOTAL; i += CONCURRENCY) {
    const batch = Math.min(CONCURRENCY, TOTAL - i);
    const batchResults = await Promise.all(
      Array.from({ length: batch }, () => singleRequest()),
    );
    for (const r of batchResults) {
      results.push(r.ms);
      completed++;
      if (!r.ok) errors++;
    }
    process.stdout.write(`\r  progress  ${completed}/${TOTAL} (${errors} errors)`);
  }

  const wallMs = performance.now() - wallStart;
  process.stdout.write("\n\n");

  const sorted = results.slice().sort((a, b) => a - b);
  const avg    = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  const rps    = (TOTAL / (wallMs / 1000)).toFixed(1);

  console.log(`  results`);
  console.log(`  ─────────────────────────────`);
  console.log(`  total requests  ${TOTAL}`);
  console.log(`  errors          ${errors} (${((errors / TOTAL) * 100).toFixed(1)}%)`);
  console.log(`  wall time       ${(wallMs / 1000).toFixed(2)} s`);
  console.log(`  req/s           ${rps}`);
  console.log(`  ─────────────────────────────`);
  console.log(`  latency (ms)`);
  console.log(`    min    ${sorted[0].toFixed(1)}`);
  console.log(`    avg    ${avg.toFixed(1)}`);
  console.log(`    p50    ${percentile(sorted, 50).toFixed(1)}`);
  console.log(`    p95    ${percentile(sorted, 95).toFixed(1)}`);
  console.log(`    p99    ${percentile(sorted, 99).toFixed(1)}`);
  console.log(`    max    ${sorted[sorted.length - 1].toFixed(1)}`);
  console.log();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
