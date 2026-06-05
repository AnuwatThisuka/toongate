#!/usr/bin/env node
// ============================================================
// Caveman Mode Benchmark
//
// Measures token impact of semantic stripping and system prompt
// injection separately. Key insight:
//
//   Semantic stripping  → reduces INPUT tokens (removes filler)
//   System prompt       → adds INPUT tokens (~14 tokens fixed cost)
//   Net on input        → can be + or - depending on filler density
//   Real benefit        → SHORTER RESPONSES (output token savings)
//
// Usage:
//   # Offline only (no server needed)
//   node benchmark/caveman-benchmark.mjs
//
//   # Include live response-length comparison
//   PROXY_AUTH_KEY=xxx node benchmark/caveman-benchmark.mjs http://localhost:8787
//
// Requirements: Node.js 18+
// ============================================================

const TOONGATE_URL = process.argv[2] || null;
const PROXY_KEY = process.env.PROXY_AUTH_KEY || "";
const MODEL = "gpt-4o-mini";

// ── ANSI helpers ─────────────────────────────────────────────
const bold   = (s) => `\x1b[1m${s}\x1b[0m`;
const green  = (s) => `\x1b[32m${s}\x1b[0m`;
const red    = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan   = (s) => `\x1b[36m${s}\x1b[0m`;
const dim    = (s) => `\x1b[2m${s}\x1b[0m`;

function printHeader(title) {
  console.log(`\n${dim("─".repeat(68))}`);
  console.log(bold(`  ${title}`));
  console.log(`${dim("─".repeat(68))}\n`);
}

// ── Inline implementation (no build step needed) ─────────────

const estimateTokens = (text) => Math.ceil(text.length / 4);

const CAVEMAN_SYSTEM_PROMPT =
  "Reply in Caveman style: extremely short, concise, no polite fluff, answer directly, use minimal tokens.";

const FILLER_PATTERNS = [
  /\bcan\s+you\s+(?:please\s+)?(?:help\s+me\s+(?:to\s+)?)?/gi,
  /\bcould\s+you\s+(?:please\s+)?/gi,
  /\bwould\s+you\s+(?:please\s+)?/gi,
  /\bi(?:\s+would|'d)\s+like\s+you\s+to\s+/gi,
  /\bi\s+need\s+you\s+to\s+/gi,
  /\bplease\s+(?:carefully\s+)?(?:analyze|review|consider|look\s+at|examine|explain|summarize|describe|write|list|provide|give|tell\s+me|help\s+me|assist)\b/gi,
  /\bstep[\s-]by[\s-]step\b/gi,
  /\bvery\s+carefully\b/gi,
  /\bthoroughly\s+/gi,
  /\bin\s+(?:great\s+)?detail\b/gi,
  /\bif\s+you\s+(?:don't\s+)?mind\b/gi,
  /\bthank(?:s|\s+you)(?:\s+(?:so\s+)?much)?\b/gi,
];

function semanticStrip(text) {
  let r = text;
  for (const p of FILLER_PATTERNS) r = r.replace(p, "");
  return r.replace(/\s{2,}/g, " ").trim();
}

function stripMessages(messages) {
  return messages.map((m) =>
    typeof m.content !== "string" ? m : { ...m, content: semanticStrip(m.content) },
  );
}

function applyCavemanMode(body) {
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0)
    return { body, activated: false };

  const stripped = stripMessages(messages);
  const sysIdx = stripped.findIndex((m) => m.role === "system");

  let newMessages;
  if (sysIdx >= 0) {
    const ex = stripped[sysIdx];
    const existing = typeof ex.content === "string" ? ex.content : "";
    newMessages = [...stripped];
    newMessages[sysIdx] = {
      ...ex,
      content: existing ? `${CAVEMAN_SYSTEM_PROMPT}\n${existing}` : CAVEMAN_SYSTEM_PROMPT,
    };
  } else {
    newMessages = [{ role: "system", content: CAVEMAN_SYSTEM_PROMPT }, ...stripped];
  }
  return { body: { ...body, messages: newMessages }, activated: true };
}

const tokensOf = (body) => estimateTokens(JSON.stringify(body));
const SYSTEM_PROMPT_TOKENS = estimateTokens(JSON.stringify({ role: "system", content: CAVEMAN_SYSTEM_PROMPT }));

// ── Test fixtures ────────────────────────────────────────────

const FIXTURES = [
  {
    name: "Clean prompt (no filler)",
    messages: [{ role: "user", content: "What is a closure in JavaScript?" }],
  },
  {
    name: "Light filler",
    messages: [{ role: "user", content: "Please explain what a closure is in JavaScript. Thank you." }],
  },
  {
    name: "Moderate filler",
    messages: [{ role: "user", content: "Could you please explain step-by-step how closures work in JavaScript." }],
  },
  {
    name: "Heavy filler",
    messages: [{ role: "user", content: "I would like you to very carefully and thoroughly explain in great detail, step-by-step, how closures work in JavaScript. Could you please provide a comprehensive answer. Thank you so much." }],
  },
  {
    name: "System + user (no filler in sys)",
    messages: [
      { role: "system", content: "You are a helpful coding assistant." },
      { role: "user", content: "Could you please explain step-by-step how TCP handshake works." },
    ],
  },
  {
    name: "System + user (filler in sys)",
    messages: [
      { role: "system", content: "You are a helpful assistant. Please provide thorough and detailed responses. Thank you." },
      { role: "user", content: "Could you please explain step-by-step how TCP handshake works." },
    ],
  },
  {
    name: "Multi-turn (verbose)",
    messages: [
      { role: "user", content: "Can you please help me to understand React hooks." },
      { role: "assistant", content: "React hooks let you use state and other React features in function components." },
      { role: "user", content: "Could you please very carefully explain useEffect in detail. Thank you." },
    ],
  },
  {
    name: "Agent-style (heavy sys + user)",
    messages: [
      { role: "system", content: "You are an expert code reviewer. Please carefully analyze the code and provide thorough, detailed feedback. Be very careful to catch all issues." },
      { role: "user", content: "I would like you to please carefully review this function and provide very detailed feedback. Could you also please suggest improvements. Thank you so much." },
    ],
  },
];

// ── Phase 1: Input token impact ──────────────────────────────

function runInputAnalysis() {
  printHeader("Phase 1 — Input Token Impact");

  console.log(dim(
    `  ${"Fixture".padEnd(35)} ${"Orig".padStart(5)} ${"Strip".padStart(6)} ${"+Sys".padStart(5)} ${"Net".padStart(6)} ${"Strip saves"}`
  ));
  console.log(dim(`  ${"─".repeat(75)}`));

  const rows = [];

  for (const fixture of FIXTURES) {
    const body = { model: MODEL, messages: fixture.messages };
    const origTokens = tokensOf(body);

    // Semantic strip only
    const strippedMessages = stripMessages(fixture.messages);
    const stripTokens = tokensOf({ model: MODEL, messages: strippedMessages });
    const stripSaved = origTokens - stripTokens;

    // Full caveman (strip + system injection)
    const { body: cavemanBody } = applyCavemanMode(body);
    const cavemanTokens = tokensOf(cavemanBody);
    const netChange = cavemanTokens - origTokens; // usually positive (more tokens)

    // How many extra system prompt tokens were added vs existing
    const hasSystem = fixture.messages.some((m) => m.role === "system");
    const sysNote = hasSystem ? dim("(overwrites)") : dim("(prepends)");

    const netStr = netChange > 0
      ? red(`+${netChange}`)
      : netChange < 0
      ? green(`${netChange}`)
      : dim("0");

    const stripStr = stripSaved > 0
      ? green(`−${stripSaved} tokens`)
      : dim("0 tokens");

    console.log(
      `  ${fixture.name.padEnd(35)} ${String(origTokens).padStart(5)} ${String(stripTokens).padStart(6)} ${String("+" + SYSTEM_PROMPT_TOKENS).padStart(5)} ${netStr.padStart(6)}   ${stripStr} ${sysNote}`
    );

    rows.push({ name: fixture.name, origTokens, stripTokens, cavemanTokens, stripSaved, netChange, hasSystem });
  }

  const totalStrip = rows.reduce((s, r) => s + r.stripSaved, 0);
  const totalNet = rows.reduce((s, r) => s + r.netChange, 0);

  console.log(dim(`\n  ${"─".repeat(75)}`));
  console.log(`  ${"TOTAL".padEnd(35)} ${dim("".padStart(5))} ${dim("".padStart(6))} ${dim("".padStart(5))} ${totalNet > 0 ? red("+" + totalNet) : green(String(totalNet))}   Strip removed: ${green(totalStrip + " tokens")}`);

  console.log(`
  ${bold("What this means:")}
  ${dim("├─")} Semantic stripping removes   ${green(totalStrip + " tokens")} of filler across all fixtures
  ${dim("├─")} System prompt injection adds  ${red("+" + SYSTEM_PROMPT_TOKENS + " tokens")} per request (fixed cost)
  ${dim("├─")} Net on INPUT tokens           ${totalNet > 0 ? red("+" + totalNet + " tokens total") : green(totalNet + " tokens total")} across ${rows.length} fixtures
  ${dim("└─")} Real benefit of caveman mode  ${cyan("SHORTER RESPONSES")} (output token savings)
`);

  return rows;
}

// ── Phase 2: Stripping detail ────────────────────────────────

function runStrippingDetail() {
  printHeader("Phase 2 — Semantic Stripping Examples");

  const examples = [
    "Could you please explain step-by-step how the TCP handshake works. Thank you.",
    "I would like you to very carefully and thoroughly analyze this code in great detail.",
    "Can you help me to write a function that sorts an array. Thanks so much.",
    "Please carefully review this PR and provide detailed feedback.",
    "What is the time complexity of quicksort?",
    "Explain how React hooks work.",
    "I need you to step-by-step debug this function and explain in detail what's wrong.",
    "You are a helpful assistant. Please provide thorough responses. Thank you.",
  ];

  for (const original of examples) {
    const stripped = semanticStrip(original);
    const saved = estimateTokens(original) - estimateTokens(stripped);
    const unchanged = stripped === original;

    console.log(`  ${dim("IN :")} ${original}`);
    if (unchanged) {
      console.log(`  ${dim("OUT:")} ${dim("(unchanged — no filler found)")}`);
    } else {
      console.log(`  ${dim("OUT:")} ${cyan(stripped)}`);
      console.log(`  ${dim("    ")} ${green("−" + saved + " tokens removed")}`);
    }
    console.log();
  }
}

// ── Phase 3: Response length (live) ─────────────────────────

async function runLiveBenchmark() {
  if (!TOONGATE_URL) {
    console.log(`${dim("─".repeat(68))}`);
    console.log(dim(
      "\n  Phase 3 skipped — no TOONGATE_URL provided.\n" +
      "  To measure output token savings, run:\n\n" +
      "    PROXY_AUTH_KEY=xxx node benchmark/caveman-benchmark.mjs http://localhost:8787\n"
    ));
    return;
  }

  printHeader(`Phase 3 — Response Length Comparison (${TOONGATE_URL})`);

  if (!PROXY_KEY) console.log(yellow("  ⚠ PROXY_AUTH_KEY not set — requests may return 401\n"));

  const liveFixtures = [
    {
      name: "Heavy filler prompt",
      messages: [{ role: "user", content: "I would like you to very carefully and thoroughly explain in great detail, step-by-step, how closures work in JavaScript. Could you please provide a comprehensive answer." }],
    },
    {
      name: "Agent-style prompt",
      messages: [
        { role: "system", content: "You are an expert code reviewer. Please carefully analyze the code and give thorough detailed feedback." },
        { role: "user", content: "Please carefully review this code snippet and provide very detailed feedback: `const x = () => { return 1 + 1; }`" },
      ],
    },
  ];

  console.log(dim(`  ${"Fixture".padEnd(30)} ${"Mode".padEnd(12)} ${"inp_tok".padStart(8)} ${"out_tok".padStart(8)} ${"resp chars".padStart(11)}`));
  console.log(dim(`  ${"─".repeat(72)}`));

  for (const fixture of liveFixtures) {
    const body = JSON.stringify({ model: MODEL, messages: fixture.messages, max_tokens: 512 });

    for (const [label, extraHeaders] of [
      ["normal  ", {}],
      ["caveman ", { "x-toongate-mode": "caveman" }],
    ]) {
      try {
        const res = await fetch(`${TOONGATE_URL}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${PROXY_KEY}`,
            ...extraHeaders,
          },
          body,
        });

        const h = Object.fromEntries(res.headers.entries());
        const json = await res.json().catch(() => null);
        const respText = json?.choices?.[0]?.message?.content ?? "";
        const respChars = respText.length;
        const outTokens = json?.usage?.completion_tokens ?? dim("n/a");
        const inpTokens = h["x-toongate-tokens-before"] ?? dim("n/a");
        const isCaveman = h["x-toongate-caveman-mode"] === "true";

        const charsColor = isCaveman ? green : (s) => s;
        const outColor   = isCaveman ? green : (s) => s;

        console.log(
          `  ${fixture.name.padEnd(30)} ${label.padEnd(12)} ${String(inpTokens).padStart(8)} ${outColor(String(outTokens).padStart(8))} ${charsColor(String(respChars).padStart(11))}`
        );
      } catch (e) {
        console.log(`  ${fixture.name.padEnd(30)} ${label.padEnd(12)} ${red("error: " + e.message)}`);
      }
    }
    console.log();
  }

  console.log(dim(
    "  Green = caveman mode. Lower out_tok and resp chars = LLM responded more concisely.\n"
  ));
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log(`\n${bold("  ⚒  Caveman Mode Benchmark")}`);
  console.log(dim(`  System prompt fixed cost: ${SYSTEM_PROMPT_TOKENS} tokens  |  "${CAVEMAN_SYSTEM_PROMPT.slice(0, 50)}..."\n`));

  runInputAnalysis();
  runStrippingDetail();
  await runLiveBenchmark();

  printHeader("Summary");
  console.log(`  ${bold("Two separate effects to understand:")}\n`);
  console.log(`  ${green("1. Semantic Stripping")}  — reduces INPUT tokens by removing filler phrases`);
  console.log(`     Best for: verbose user prompts, agent system prompts`);
  console.log(`     Worst for: already concise prompts (no filler to remove)\n`);
  console.log(`  ${cyan("2. System Prompt Injection")}  — costs ~${SYSTEM_PROMPT_TOKENS} INPUT tokens, but steers LLM`);
  console.log(`     to produce shorter OUTPUTS. Net savings depend on response length.`);
  console.log(`     Rule of thumb: if avg response > ~200 tokens, injection pays for itself.\n`);
  console.log(`  ${yellow("Combined ROI:")}  Caveman Mode is most effective on:`);
  console.log(`    • High-volume agent pipelines with verbose prompts`);
  console.log(`    • Workflows where response brevity is acceptable`);
  console.log(`    • Prompts with >10 tokens of filler (break-even on input cost)\n`);
}

main().catch((err) => {
  console.error(red("\n  Error: " + err.message));
  process.exit(1);
});
