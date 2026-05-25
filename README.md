# toongate

> Active compression layer for LLM pipelines — sits in front of Helicone (or any gateway) and reduces token costs up to 40% before requests reach your provider.

Helicone tells you what you're spending. toongate actually reduces it.

```diff
- const openai = new OpenAI({
-   baseURL: "https://oai.helicone.ai/v1",
-   headers: { "Helicone-Auth": "Bearer sk-hel-..." }
- });
+ const openai = new OpenAI({
+   baseURL: "https://proxy.toongate.dev/v1",      // toongate in front
+   headers: {
+     "Helicone-Auth": "Bearer sk-hel-...",         // still works, untouched
+     "X-Toon-Key":    "sk-toon-..."                // one new header
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
toongate                  ← decodes TOON back to JSON, logs savings
   │
   ▼
Your App                  ← sees normal JSON, no TOON awareness needed
```

toongate encodes only when it helps — uniform arrays of objects (RAG chunks, DB rows, product lists) compress well. Free-form text and deeply nested configs pass through unchanged.

---

## Quickstart

### With Helicone (recommended)

1. Sign up at [toongate.dev](https://toongate.dev) and grab an API key.
2. Swap `baseURL` to `https://proxy.toongate.dev/v1` and add `X-Toon-Key`.
3. Keep all your existing `Helicone-*` headers — they forward automatically.
4. Watch your Helicone dashboard show lower token counts, and toongate's dashboard show the delta.

### Standalone (no Helicone)

Point directly at toongate without a downstream gateway:

```js
const openai = new OpenAI({
  baseURL: "https://proxy.toongate.dev/v1",
  headers: { "X-Toon-Key": "sk-toon-..." },
});
```

toongate forwards to OpenAI or Anthropic directly. You get compression and the savings dashboard — without Helicone's observability layer.

### Self-hosted

```bash
git clone https://github.com/anuwatthisuka/toongate
cd toongate
npm install
cp .env.example .env
npm start              # proxy on http://localhost:3000
```

Set `UPSTREAM_URL=https://oai.helicone.ai/v1` to chain with Helicone, or leave it pointing at OpenAI directly.

---

## What gets compressed

toongate uses the [TOON format](https://toonformat.dev) to encode structured data in prompt payloads. The sweet spot is uniform arrays of objects — where JSON repeats field names for every row:

| Payload type                   | Compression           | Example                                           |
| ------------------------------ | --------------------- | ------------------------------------------------- |
| Uniform array of objects       | **~40% fewer tokens** | RAG chunks, DB rows, product catalogs, event logs |
| Mixed structured data          | ~20–30%               | Prompts with both tables and nested objects       |
| Free-form text                 | 0% (pass-through)     | Plain Q&A, summaries, creative prompts            |
| Deeply nested non-uniform JSON | 0% (pass-through)     | Complex config objects                            |

Accuracy is slightly _higher_ with TOON — explicit `[N]` length markers and `{fields}` headers give models a clearer schema to follow (76.4% vs 75.0% on [official benchmarks](https://toonformat.dev/guide/benchmarks.html)).

---

## Savings dashboard

toongate tracks every request and surfaces:

- **Tokens saved** — before vs after compression, per request
- **USD saved** — calculated against live model pricing
- **Breakdown by endpoint and model** — find your highest-spend call sites
- **Prompt diff view** — compare two prompt versions and see projected monthly savings impact
- **Monthly export** — CSV for finance reporting

The dashboard is additive to Helicone's. You don't replace one with the other.

---

## Configuration

| Env var            | Default                      | Description                                                                                |
| ------------------ | ---------------------------- | ------------------------------------------------------------------------------------------ |
| `PORT`             | `3000`                       | Port the proxy listens on                                                                  |
| `UPSTREAM_URL`     | `https://oai.helicone.ai/v1` | Where to forward requests (Helicone, OpenAI, Anthropic, or any OpenAI-compatible endpoint) |
| `TOON_THRESHOLD`   | `0.6`                        | Min tabular eligibility (0–1) before encoding. Lower = more aggressive compression         |
| `TOON_LOG_SAVINGS` | `true`                       | Write per-request savings to stdout                                                        |

---

## Compatibility

toongate is a transparent proxy — it speaks the same OpenAI-compatible protocol as its upstream. Works with anything that supports a custom `baseURL`.

| Upstream                     | Status    |
| ---------------------------- | --------- |
| Helicone (`oai.helicone.ai`) | Supported |
| OpenAI direct                | Supported |
| Anthropic direct             | Supported |
| LiteLLM                      | Supported |
| Azure OpenAI                 | Planned   |
| Google Gemini                | Planned   |

---

## Self-hosted architecture

```
src/
├── index.ts          # Express app entry point
├── proxy.ts          # Request interception & upstream forwarding
├── encoder.ts        # JSON → TOON (with eligibility check)
├── decoder.ts        # TOON → JSON
├── eligibility.ts    # Tabular eligibility scoring
├── savings.ts        # Per-request savings logging
├── dashboard/        # Savings API + frontend
└── routes/
    ├── openai.ts     # /v1/chat/completions, /v1/embeddings
    └── anthropic.ts  # /v1/messages
```

---

## Contributing

Issues and PRs are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a PR.

Areas where help is most useful:

- Azure OpenAI and Gemini upstream support
- Streaming response support (chunked TOON decoding)
- Helicone webhook integration (pull savings context into Helicone's custom properties)
- Performance benchmarks at high request volume

---

## License

MIT — see [LICENSE](./LICENSE).

---

Built on top of the [TOON format](https://toonformat.dev) by [Johann Schopplich](https://johannschopplich.com).  
Not affiliated with Helicone.
