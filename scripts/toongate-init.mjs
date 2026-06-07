#!/usr/bin/env node
// npx toongate init — scaffold wrangler.jsonc + .dev.vars in the current directory

import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const cwd = process.cwd();

function ask(rl, question) {
  return new Promise((res) => rl.question(question, res));
}

function green(s) { return `\x1b[32m${s}\x1b[0m`; }
function yellow(s) { return `\x1b[33m${s}\x1b[0m`; }
function bold(s) { return `\x1b[1m${s}\x1b[0m`; }

function writeFile(name, content) {
  const dest = resolve(cwd, name);
  if (existsSync(dest)) {
    console.log(yellow(`  skip  ${name}  (already exists — not overwritten)`));
    return;
  }
  writeFileSync(dest, content, "utf8");
  console.log(green(`  wrote ${name}`));
}

const WRANGLER_TEMPLATE = `{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "toongate",
  "main": "src/index.ts",
  "compatibility_date": "2025-01-01",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true, "head_sampling_rate": 1 },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "toongate-savings",
      // Replace with your D1 database_id from: wrangler d1 create toongate-savings
      "database_id": "<your-database-id>",
      "migrations_dir": "migrations"
    }
  ]
  // Optional rate limiting — uncomment to enable (60 req/min per IP):
  // "rate_limits": [
  //   {
  //     "binding": "RATE_LIMITER",
  //     "namespace_id": "1001",
  //     "simple": { "limit": 60, "period": 60 }
  //   }
  // ]
}
`;

function buildDevVars(opts) {
  const lines = [
    `# ─── OpenAI / OpenAI-compatible  (/v1/*) ────────────────────────────────────`,
    `UPSTREAM_URL=${opts.upstreamUrl}`,
    `OPENAI_API_KEY=${opts.openaiKey}`,
    ``,
    `# ─── Anthropic  (/v1/messages) ───────────────────────────────────────────────`,
    `ANTHROPIC_API_KEY=${opts.anthropicKey}`,
    ``,
    `# ─── Azure OpenAI  (/azure/v1/*) ─────────────────────────────────────────────`,
    `AZURE_OPENAI_API_KEY=`,
    `AZURE_OPENAI_ENDPOINT=https://{resource-name}.openai.azure.com`,
    ``,
    `# ─── Gemini  (/gemini/v1/*) ──────────────────────────────────────────────────`,
    `GEMINI_API_KEY=`,
    ``,
    `# ─── DeepSeek  (/deepseek/v1/*) ─────────────────────────────────────────────`,
    `DEEPSEEK_API_KEY=`,
    ``,
    `# ─── Auth ────────────────────────────────────────────────────────────────────`,
    `PROXY_AUTH_KEY=${opts.proxyAuthKey}`,
    `ADMIN_KEY=${opts.adminKey}`,
    ``,
    `# ─── Cloudflare AI Gateway ───────────────────────────────────────────────────`,
    `CF_AIG_TOKEN=`,
    ``,
    `# ─── Compression ─────────────────────────────────────────────────────────────`,
    `TOON_THRESHOLD=0.6`,
    `TOON_LOG_SAVINGS=true`,
    `# TOON_DRY_RUN=true`,
    ``,
    `# ─── Webhook (optional) ──────────────────────────────────────────────────────`,
    `# SAVINGS_WEBHOOK_URL=https://hooks.slack.com/services/...`,
  ];
  return lines.join("\n") + "\n";
}

async function main() {
  console.log(`\n${bold("toongate init")} — scaffold wrangler.jsonc + .dev.vars\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const upstreamUrl = await ask(
    rl,
    `Upstream URL (default: https://api.openai.com): `,
  );
  const openaiKey = await ask(rl, `OpenAI API key (leave blank to fill later): `);
  const anthropicKey = await ask(rl, `Anthropic API key (leave blank to fill later): `);
  const proxyAuthKey = await ask(
    rl,
    `PROXY_AUTH_KEY — protects proxy routes (leave blank to skip): `,
  );
  const adminKey = await ask(
    rl,
    `ADMIN_KEY — protects /savings/* routes (leave blank to skip): `,
  );

  rl.close();

  const opts = {
    upstreamUrl: upstreamUrl.trim() || "https://api.openai.com",
    openaiKey: openaiKey.trim(),
    anthropicKey: anthropicKey.trim(),
    proxyAuthKey: proxyAuthKey.trim(),
    adminKey: adminKey.trim(),
  };

  console.log("");
  writeFile("wrangler.jsonc", WRANGLER_TEMPLATE);
  writeFile(".dev.vars", buildDevVars(opts));

  console.log(`
${green("Done.")} Next steps:

  1. Replace ${yellow("<your-database-id>")} in wrangler.jsonc:
       ${bold("wrangler d1 create toongate-savings")}

  2. Apply D1 migrations locally:
       ${bold("wrangler d1 migrations apply toongate-savings --local")}

  3. Start the dev server:
       ${bold("wrangler dev")}

  4. Set production secrets:
       ${bold("wrangler secret put OPENAI_API_KEY")}
       ${bold("wrangler secret put PROXY_AUTH_KEY")}
       ${bold("wrangler secret put ADMIN_KEY")}

  5. Deploy:
       ${bold("wrangler deploy")}
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
