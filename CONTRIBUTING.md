# Contributing to toongate

Thanks for taking the time to contribute. toongate is an open-source project and we welcome all kinds of contributions — bug fixes, new features, docs improvements, and integration support.

---

## Before you start

- Check the [open issues](https://github.com/anuwatthisuka/toongate/issues) to see if your bug or idea is already being tracked.
- For significant changes, open an issue first to discuss the approach before writing code. This saves everyone time.
- Small fixes (typos, docs, minor bugs) can go straight to a PR.

---

## Development setup

```bash
git clone https://github.com/anuwatthisuka/toongate
cd toongate
npm install
cp .dev.vars.example .dev.vars   # add your API keys
npm run types                     # generate Env interface from wrangler.jsonc
npm run db:migrate:local          # setup local D1
npm run dev                       # starts proxy on http://localhost:8787
npm test                          # run test suite
```

Required: Node.js 18+, Wrangler CLI (`npm i -g wrangler`)

---

## PR workflow

1. **Fork** the repo and create a branch from `main`.

   ```bash
   git checkout -b feat/your-feature-name
   # or
   git checkout -b fix/issue-123
   ```

2. **Write your code.** Follow the existing style — we use TypeScript strict mode throughout.

3. **Add or update tests.** PRs that touch `encoder.ts`, `decoder.ts`, or `eligibility.ts` must include test coverage. We use Vitest.

   ```bash
   npm test              # run all tests
   npm run test:watch    # watch mode during development
   ```

4. **Run the linter** before pushing.

   ```bash
   npm run lint
   npm run lint:fix      # auto-fix where possible
   ```

5. **Update docs** if your change affects behaviour, configuration, or the public API. The README and any relevant `/docs` pages should stay in sync.

6. **Open a PR** against `main`. Fill in the PR template — describe what changed and why, link the related issue if there is one.

7. A maintainer will review within a few days. We may ask for changes or clarification before merging.

---

## Branch naming

| Type     | Pattern                      | Example                  |
| -------- | ---------------------------- | ------------------------ |
| Feature  | `feat/short-description`     | `feat/gemini-support`    |
| Bug fix  | `fix/issue-number`           | `fix/issue-42`           |
| Docs     | `docs/short-description`     | `docs/update-quickstart` |
| Refactor | `refactor/short-description` | `refactor/encoder-perf`  |

---

## Proxy core quality checklist

Before any PR that touches the proxy core is merged, the following must pass. This defines what "core ready" means for toongate.

### Correctness

- [ ] Encoder round-trip test passes for 10+ payload shapes (tabular, nested, mixed, empty array, single-item, primitives)
- [ ] Eligibility score is correct for pure tabular / mixed / plain-text payloads
- [ ] `encode` fail → fallback sends original payload — request never dropped
- [ ] All gateway headers pass through untouched — verified against at least one gateway (Cloudflare AI Gateway or Helicone)

### Reliability

- [ ] `stream: true` passes through without buffering the full body
- [ ] Upstream 4xx/5xx returns the correct error to the client — no hang
- [ ] D1 write failure does not affect the response returned to the client
- [ ] Worker stays within 128MB memory limit under sustained load

### Performance

- [ ] Encoding overhead < 1ms for payloads up to 50KB
- [ ] p95 latency increase vs direct call < 2ms (measured with wrk or similar)
- [ ] D1 savings write uses `ctx.waitUntil` — does not block response

### Observability

- [ ] Every request logs: `model`, `endpoint`, `tokens_before`, `tokens_after`, `tokens_saved`, `usd_saved`, `elapsed_ms`
- [ ] Encode/upstream/D1 errors are logged with distinct categories
- [ ] `GET /health` returns `{ ok: true, version: "x.x.x" }` with status 200

---

## What we're looking for

High-priority contributions:

- **Azure OpenAI upstream support** — header translation and auth flow
- **Google Gemini upstream support** — maps to OpenAI-compatible format
- **Streaming support** — chunked TOON decoding for `stream: true` responses
- **Helicone webhook integration** — push toongate savings data into Helicone custom properties
- **Performance benchmarks** — request throughput and latency under load

If you're unsure whether something is in scope, open an issue and ask first.

---

## Commit style

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add Gemini upstream support
fix: handle empty arrays in eligibility check
docs: update self-hosted quickstart
refactor: extract token counting into separate module
test: add encoder round-trip tests for nested objects
```

This keeps the changelog automatable and the git history readable.

---

## Code style

- TypeScript strict mode — no `any` without a comment explaining why.
- Functions over classes where possible.
- Each file does one thing. If a file is getting long, split it.
- All D1 queries use prepared statements with `.bind()` — never string interpolation.
- Errors should be descriptive — the proxy sits in a critical path, so clear error messages matter.

---

## Questions

Open a [GitHub Discussion](https://github.com/anuwatthisuka/toongate/discussions) or drop into the issue tracker. We're happy to help.
