# Security Policy

## Supported versions

Security fixes are applied to the latest release on the `main` branch. Self-hosted deployments should track `main` or the most recent tagged release.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |
| < 0.1   | No        |

---

## Reporting a vulnerability

If you believe you have found a security issue in toongate, please report it responsibly.

**Do not** open a public GitHub issue for security vulnerabilities.

Instead, use one of these channels:

1. **Email:** [security@toongate.dev](mailto:security@toongate.dev)
2. **GitHub Security Advisories:** [Report privately](https://github.com/anuwatthisuka/toongate/security/advisories/new) on the repository

Include as much detail as you can:

- Description of the issue and its impact
- Steps to reproduce (proof-of-concept if available)
- Affected routes, configuration, or deployment setup
- Your suggested fix or mitigation, if any

### What we commit to

- Acknowledge your report within **3 business days**
- Provide a status update within **7 business days**
- Work on a fix and coordinate disclosure timing with you
- Credit reporters in the release notes when they wish to be credited

### Out of scope

The following are generally **not** considered toongate vulnerabilities:

- Issues in upstream LLM providers (OpenAI, Anthropic, Azure, etc.)
- Misconfiguration by operators (e.g. leaving `PROXY_AUTH_KEY` unset, weak keys, exposed `.dev.vars`)
- Denial-of-service against a public Worker URL without a specific flaw in toongate itself
- Social engineering or physical attacks

---

## Security model

toongate is a **transparent LLM proxy** deployed on Cloudflare Workers. It sits between your application and upstream providers, optionally compressing structured payloads before forwarding them.

### Trust boundaries

```
Your app  ──(PROXY_AUTH_KEY)──►  toongate Worker  ──(provider API keys)──►  Upstream LLM
                                      │
                                      ▼
                                 D1 savings log
                                 (metadata only)
```

- **Clients** authenticate to toongate with `PROXY_AUTH_KEY`.
- **toongate** authenticates to upstream providers using secrets stored in the Worker environment.
- **Operators** access savings/observability APIs with `ADMIN_KEY`.

Provider API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `AZURE_OPENAI_API_KEY`, etc.) are **never** returned to clients. Incoming `Authorization` headers from clients are replaced with the configured upstream credential before the request is forwarded.

---

## Authentication

### Proxy routes (`/v1/*`, `/azure/*`, `/gemini/*`, `/deepseek/*`, `/bedrock/*`, `/vertex/*`)

| Setting | Behavior |
| ------- | -------- |
| `PROXY_AUTH_KEY` **unset** | All proxy routes return `401 Unauthorized` (fail-closed) |
| `PROXY_AUTH_KEY` **set** | Clients must send `Authorization: Bearer <PROXY_AUTH_KEY>` |

Key comparison uses constant-time `safeCompare()` to reduce timing-oracle risk.

### Admin routes (`/savings/*`, `/metrics`)

| Setting | Behavior |
| ------- | -------- |
| `ADMIN_KEY` **unset** | Routes return `404 Not Found` (hidden) |
| `ADMIN_KEY` **set** | Clients must send `X-Toongate-Admin-Key: <ADMIN_KEY>` |

Invalid keys return `401 Unauthorized`.

### Public routes

- `GET /health` — returns `{ ok: true, version: "…" }` with no sensitive data.

---

## Secrets and configuration

### Production

Store all sensitive values as Cloudflare Worker secrets:

```bash
wrangler secret put PROXY_AUTH_KEY
wrangler secret put ADMIN_KEY
wrangler secret put OPENAI_API_KEY
# … other provider keys as needed
```

Never commit secrets to version control. The following files are gitignored and must stay local:

- `.dev.vars`
- `wrangler.jsonc` (may contain your D1 `database_id`)

### Key hygiene

- Generate `PROXY_AUTH_KEY` and `ADMIN_KEY` with a cryptographically secure random source (at least 32 bytes).
- Use **different** values for `PROXY_AUTH_KEY` and `ADMIN_KEY`.
- Rotate keys if you suspect exposure; update both the Worker secret and all clients.
- Restrict who can run `wrangler secret` and deploy to your Cloudflare account.

### Internal header stripping

Before forwarding to upstream, toongate removes internal headers such as `X-Toongate-Admin-Key`, `X-Toongate-Mode`, and `X-Compression-Level` so they cannot leak to providers.

---

## Rate limiting

When the `RATE_LIMITER` binding is configured in `wrangler.jsonc`, proxy routes are rate-limited **per client IP** (`cf-connecting-ip`) **after** authentication succeeds.

Default example: 60 requests per 60 seconds. Adjust to your traffic profile. Rate limiting is optional — if the binding is absent, requests proceed without IP throttling.

For additional protection, use Cloudflare dashboard controls (WAF rules, IP allowlists, Bot Fight Mode, etc.) in front of your Worker.

---

## Data handling and privacy

### What toongate stores

The D1 `savings` table records **telemetry metadata only**:

- Timestamp, model name, endpoint path
- Token counts (before/after/saved) and estimated USD saved
- Request latency and compression flags

**Prompt content, completions, embeddings, and API keys are not persisted** by toongate.

### Webhooks

If `SAVINGS_WEBHOOK_URL` is set, toongate POSTs the same metadata fields after each request. Use HTTPS endpoints and treat webhook URLs as sensitive configuration (they can reveal usage patterns).

### Response debug headers

Authenticated proxy responses may include `X-Toongate-*` headers (compression status, token estimates, eligibility score). These expose operational metrics, not request/response bodies. Strip them at your application boundary if your clients must not see compression details.

---

## Self-hosting checklist

Before exposing a toongate Worker to the internet:

1. Set `PROXY_AUTH_KEY` to a strong random value.
2. Set `ADMIN_KEY` if you need `/savings/*`; otherwise leave it unset so those routes stay hidden.
3. Store all provider API keys as Wrangler secrets, not plain-text vars in `wrangler.jsonc`.
4. Enable rate limiting via the `rate_limits` binding or Cloudflare WAF.
5. Restrict Cloudflare account access (least privilege for deploy tokens).
6. Review D1 access: anyone with `ADMIN_KEY` can read aggregate and per-request savings history.
7. Keep dependencies updated (`npm audit`, regular `npm update`).

---

## Dependency security

toongate has a small runtime dependency surface (`hono`, `@toon-format/toon`). We monitor dependency advisories and address critical issues in patch releases.

To audit locally:

```bash
npm audit
```

Report supply-chain concerns affecting toongate through the channels above.

---

## Compression and fail-safe behavior

toongate is designed not to break the request pipeline on compression errors:

- Ineligible or malformed payloads pass through unchanged.
- Encode/decode failures fall back to the original content.
- D1 and webhook failures are swallowed so responses are never blocked.

This fail-safe design reduces availability risk but means compression is **best-effort**, not a security boundary. Do not rely on toongate for input sanitization or output filtering — treat upstream providers as the authority for content policy.

---

## Contact

| Purpose | Contact |
| ------- | ------- |
| Security vulnerabilities | [security@toongate.dev](mailto:security@toongate.dev) |
| Code of conduct | [conduct@toongate.dev](mailto:conduct@toongate.dev) |
| General questions | [GitHub Discussions](https://github.com/anuwatthisuka/toongate/discussions) |
