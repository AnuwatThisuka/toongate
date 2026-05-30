# toongate

> Active compression layer for LLM pipelines — sits in front of any LLM gateway and reduces token costs up to 40% before requests reach your provider.

Cut LLM token costs up to 40%. Works with any gateway.

```diff
- const openai = new OpenAI({
-   baseURL: "https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/openai",
- });
+ const openai = new OpenAI({
+   baseURL: "https://toongate.workers.dev/v1",  // toongate in front
+   // All existing gateway headers still pass through untouched:
+   // "Helicone-Auth": "Bearer sk-hel-...",
+   // "cf-aig-authorization": "Bearer ...",
+ });
```

One `baseURL` change. No new headers, no SDK changes. Every gateway feature you already rely on keeps working exactly as before.

---

## How it works

```
Your App
   │  OpenAI SDK (unchanged)
   ▼
toongate                  ← compresses JSON arrays in prompt to TOON (~40% fewer tokens)
   │  forwards all gateway headers untouched
   ▼
Any Gateway               ← CF AI Gateway / Helicone / LiteLLM / direct — your choice
   │
   ▼
OpenAI / Anthropic        ← receives smaller payload; bills you less
   │
   ▼ (response)
toongate                  ← passes response through, logs savings to D1
   │
   ▼
Your App                  ← sees normal JSON, no TOON awareness needed
```

toongate encodes only when it helps — uniform arrays of objects (RAG chunks, DB rows, product lists) compress well. Free-form text and deeply nested configs pass through unchanged.

---

## What gets compressed

toongate uses the [TOON format](https://toonformat.dev) to encode structured data in prompt payloads. The sweet spot is uniform arrays of objects — where JSON repeats field names for every row:

| Payload type | Compression | Example |
| --- | --- | --- |
| Uniform array of objects | **~40% fewer tokens** | RAG chunks, DB rows, product catalogs, event logs |
| Mixed structured data | ~20–30% | Prompts with both tables and nested objects |
| Free-form text | 0% (pass-through) | Plain Q&A, summaries, creative prompts |
| Deeply nested non-uniform JSON | 0% (pass-through) | Complex config objects |

Accuracy is slightly _higher_ with TOON — explicit `[N]` length markers and `{fields}` headers give models a clearer schema to follow (76.4% vs 75.0% on [official benchmarks](https://toonformat.dev/guide/benchmarks.html)).

---

## Self-hosted on Cloudflare Workers

toongate runs on [Cloudflare Workers](https://workers.cloudflare.com) with [D1](https://developers.cloudflare.com/d1/) as the savings store. No servers to manage, deploys globally in seconds.

### Prerequisites

- Node.js 18+
- A Cloudflare account (free tier works)
- Wrangler CLI (`npm install -g wrangler` or use the local devDependency)

### Setup

```bash
git clone https://github.com/anuwatthisuka/toongate
cd toongate
npm install
```

Create the D1 database and copy the `database_id` from the output:

```bash
npx wrangler d1 create toongate-savings
```

Paste the returned ID into `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "toongate-savings",
    "database_id": "<paste-id-here>",   // ← replace this
    "migrations_dir": "migrations"
  }
]
```

Copy the secrets template and fill in your keys:

```bash
cp .dev.vars.example .dev.vars
```

Apply the D1 schema and start the dev server:

```bash
npm run db:migrate:local
npm run dev               # proxy on http://localhost:8787
```

### Deploy

```bash
npm run db:migrate:remote
npm run deploy
```

Point your SDK at the deployed worker URL instead of your gateway directly.

---

## Configuration

All configuration is via environment variables. In production, set secrets with `wrangler secret put <NAME>`.

| Variable | Example | Description |
| --- | --- | --- |
| `UPSTREAM_URL` | `https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/openai` | Upstream base URL. See `.dev.vars.example` for all gateway options. |
| `OPENAI_API_KEY` | `sk-...` | Injected as `Authorization: Bearer` on OpenAI routes. |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Injected as `x-api-key` on Anthropic routes. |
| `CF_AIG_TOKEN` | `vck_...` | Cloudflare AI Gateway auth token. Accepts bare token or `Bearer token` — normalized automatically. Leave empty if gateway auth is disabled. |
| `TOON_THRESHOLD` | `0.6` | Min tabular eligibility score (0–1) before encoding. Lower = more aggressive. |
| `TOON_LOG_SAVINGS` | `true` | Write per-request savings rows to D1. |
| `ADMIN_KEY` | _(random string)_ | Protects all `/savings/*` routes. When unset, those routes return `404`. Set with `wrangler secret put ADMIN_KEY`. |
| `PROXY_AUTH_KEY` | _(random string)_ | **Optional.** When set, all `/v1/*` proxy routes require `Authorization: Bearer <value>`. Leave unset for open access. |

**Note on `UPSTREAM_URL`:** toongate strips the `/v1` prefix from incoming paths before appending to `UPSTREAM_URL`, so `UPSTREAM_URL` should end in `/v1` (or the equivalent base for your gateway). For Anthropic direct, set `UPSTREAM_URL=https://api.anthropic.com`.

---

## Savings log

Every request writes a row to D1 with before/after token counts, USD saved, model, endpoint, and latency.

### HTTP API

Query savings data directly over HTTP — no wrangler CLI required.

All `/savings/*` routes require the `X-Toongate-Admin-Key` header (set via `ADMIN_KEY`). If `ADMIN_KEY` is not configured, the routes return `404`.

```bash
# Aggregate totals overall and by model
curl https://toongate.workers.dev/savings/summary \
  -H "X-Toongate-Admin-Key: your-admin-key"
```

```json
{
  "overall": { "requests": 120, "total_tokens_saved": 45000, "total_usd_saved": 0.135 },
  "by_model": [
    { "model": "gpt-4o", "requests": 80, "total_tokens_saved": 32000, "total_usd_saved": 0.096 }
  ]
}
```

```bash
# Paginated raw log, newest first (limit max 500)
curl "https://toongate.workers.dev/savings/history?limit=50&offset=0" \
  -H "X-Toongate-Admin-Key: your-admin-key"
```

```json
{
  "total": 120,
  "limit": 50,
  "offset": 0,
  "rows": [{ "ts": "2025-01-01T00:00:00Z", "model": "gpt-4o", ... }]
}
```

### Wrangler CLI

Query it directly with Wrangler:

```bash
# Local
npx wrangler d1 execute toongate-savings --local \
  --command "SELECT model, endpoint, SUM(tokens_saved), SUM(usd_saved) FROM savings GROUP BY model, endpoint"

# Remote
npx wrangler d1 execute toongate-savings --remote \
  --command "SELECT * FROM savings ORDER BY ts DESC LIMIT 20"
```

Schema:

```sql
savings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT,     -- ISO-8601
  model         TEXT,     -- e.g. "gpt-4o"
  endpoint      TEXT,     -- e.g. "/v1/chat/completions"
  tokens_before INTEGER,
  tokens_after  INTEGER,
  tokens_saved  INTEGER,
  usd_saved     REAL,
  elapsed_ms    INTEGER
)
```

---

## Compatibility

toongate is a transparent proxy — it speaks the same OpenAI-compatible protocol as its upstream. Works with anything that supports a custom `baseURL`.

| Gateway | Status |
| --- | --- |
| Cloudflare AI Gateway | Supported |
| OpenAI direct | Supported |
| Anthropic direct | Supported |
| Helicone | Supported |
| LiteLLM | Supported |
| Azure OpenAI | Planned |
| Google Gemini | Planned |

---

## Architecture

```
src/
├── index.ts              # Hono app — mounts routes, exports default for Workers
├── types.ts              # SavingsRow type (Env is generated by wrangler types)
├── middleware/
│   ├── admin-auth.ts     # X-Toongate-Admin-Key guard for /savings/* routes
│   └── proxy-auth.ts     # Optional Authorization: Bearer guard for /v1/* routes
├── routes/
│   ├── openai.ts         # POST /v1/chat/completions, /v1/embeddings
│   ├── anthropic.ts      # POST /v1/messages
│   └── savings.ts        # GET /savings/summary, /savings/history, /savings/dashboard
└── lib/
    ├── encoder.ts        # JSON → TOON via @toon-format/toon
    ├── decoder.ts        # TOON → JSON, falls back gracefully on error
    ├── eligibility.ts    # Tabular eligibility scoring (0–1)
    ├── savings.ts        # D1 prepared-statement insert, fire-and-forget
    └── pricing.ts        # Token → USD cost per model
migrations/
└── 0001_init.sql         # savings table
```

**Runtime:** Cloudflare Workers (no Node.js, no servers)  
**Framework:** [Hono](https://hono.dev)  
**Database:** Cloudflare D1 (SQLite at the edge)  
**Encoder:** [@toon-format/toon](https://toonformat.dev)

---

## Development

```bash
npm test                  # vitest unit tests (encoder, decoder, eligibility, auth middleware)
npm run test:watch
npm run lint              # tsc --noEmit typecheck
npm run types             # regenerate wrangler type bindings → src/worker.d.ts
npm run generate:pricing  # fetch latest model prices from LiteLLM → src/lib/pricing.ts
```

---

## Contributing

Issues and PRs are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a PR.

Areas where help is most useful:

- Azure OpenAI and Gemini upstream support
- Streaming response TOON decoding (chunked SSE)
- Gateway webhook integration (push savings delta into gateway custom properties)
- Performance benchmarks at high request volume

---

## License

MIT — see [LICENSE](./LICENSE).

---

Built on top of the [TOON format](https://toonformat.dev) by [Johann Schopplich](https://johannschopplich.com).  
Not affiliated with Helicone or Cloudflare.
