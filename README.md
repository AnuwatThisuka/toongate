# toongate

> Active compression layer for LLM pipelines — sits in front of Helicone (or any gateway) and reduces token costs up to 40% before requests reach your provider.

Helicone tells you what you're spending. toongate actually reduces it.

```diff
- const openai = new OpenAI({
-   baseURL: "https://oai.helicone.ai/v1",
-   headers: { "Helicone-Auth": "Bearer sk-hel-..." }
- });
+ const openai = new OpenAI({
+   baseURL: "https://toongate.workers.dev/v1",   // toongate in front
+   headers: {
+     "Helicone-Auth": "Bearer sk-hel-...",           // still works, untouched
+   }
+ });
```

Every Helicone feature you rely on — logging, sessions, cost tracking, caching — keeps working exactly as before. You just spend less on the underlying tokens.

---

## How it works

```
Your App
   │  OpenAI SDK (unchanged)
   ▼
toongate                  ← compresses JSON arrays in prompt to TOON (~40% fewer tokens)
   │  forwards all Helicone-* headers untouched
   ▼
Helicone                  ← logs the already-compressed request; sees lower token counts
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


| Payload type                   | Compression           | Example                                           |
| ------------------------------ | --------------------- | ------------------------------------------------- |
| Uniform array of objects       | **~40% fewer tokens** | RAG chunks, DB rows, product catalogs, event logs |
| Mixed structured data          | ~20–30%               | Prompts with both tables and nested objects       |
| Free-form text                 | 0% (pass-through)     | Plain Q&A, summaries, creative prompts            |
| Deeply nested non-uniform JSON | 0% (pass-through)     | Complex config objects                            |


Accuracy is slightly *higher* with TOON — explicit `[N]` length markers and `{fields}` headers give models a clearer schema to follow (76.4% vs 75.0% on [official benchmarks](https://toonformat.dev/guide/benchmarks.html)).

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
// wrangler.jsonc
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

Point your SDK at the deployed worker URL instead of the upstream directly.

---

## Configuration

All configuration is via environment variables. In production, set secrets with `wrangler secret put <NAME>`.


| Variable            | Example                      | Description                                                                               |
| ------------------- | ---------------------------- | ----------------------------------------------------------------------------------------- |
| `UPSTREAM_URL`      | `https://oai.helicone.ai/v1` | Upstream base URL — must end in `/v1`. Used for all forwarded requests.                   |
| `OPENAI_API_KEY`    | `sk-...`                     | Injected as `Authorization: Bearer` on OpenAI routes.                                     |
| `ANTHROPIC_API_KEY` | `sk-ant-...`                 | Injected as `x-api-key` on Anthropic routes.                                              |
| `TOON_THRESHOLD`    | `0.6`                        | Min tabular eligibility score (0–1) before encoding. Lower = more aggressive compression. |
| `TOON_LOG_SAVINGS`  | `true`                       | Write per-request savings rows to D1.                                                     |


**Note on `UPSTREAM_URL`:** toongate strips the `/v1` prefix from incoming paths before appending to `UPSTREAM_URL`. So `UPSTREAM_URL=https://oai.helicone.ai/v1` routes `/v1/chat/completions` to `https://oai.helicone.ai/v1/chat/completions`. For Anthropic, set `UPSTREAM_URL=https://anthropic.helicone.ai/v1` or `https://api.anthropic.com`.

---

## Savings log

Every request writes a row to D1 with before/after token counts, USD saved, model, endpoint, and latency. Query it directly with Wrangler:

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


| Upstream                                     | Status    |
| -------------------------------------------- | --------- |
| Helicone (`oai.helicone.ai`)                 | Supported |
| OpenAI direct                                | Supported |
| Anthropic direct                             | Supported |
| Helicone Anthropic (`anthropic.helicone.ai`) | Supported |
| Azure OpenAI                                 | Planned   |
| Google Gemini                                | Planned   |


---

## Architecture

```
src/
├── index.ts              # Hono app — mounts routes, exports default for Workers
├── types.ts              # Env interface + SavingsRow type
├── routes/
│   ├── openai.ts         # POST /v1/chat/completions, /v1/embeddings
│   └── anthropic.ts      # POST /v1/messages
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
npm test          # vitest unit tests (encoder round-trips, decoder fallbacks, eligibility scoring)
npm run test:watch
npm run types     # regenerate wrangler type bindings → src/worker.d.ts
```

---

## Contributing

Issues and PRs are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a PR.

Areas where help is most useful:

- Azure OpenAI and Gemini upstream support
- Streaming response TOON decoding (chunked SSE)
- Helicone webhook integration (push savings delta into Helicone custom properties)
- Performance benchmarks at high request volume

---

## License

MIT — see [LICENSE](./LICENSE).

---

Built on top of the [TOON format](https://toonformat.dev) by [Johann Schopplich](https://johannschopplich.com).  
Not affiliated with Helicone or Cloudflare.