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
cp .env.example .env
npm run dev       # starts proxy on http://localhost:3000 with hot reload
npm test          # run test suite
```

Required: Node.js 18+

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
- Errors should be descriptive — the proxy sits in a critical path, so clear error messages matter.

---

## Questions

Open a [GitHub Discussion](https://github.com/anuwatthisuka/toongate/discussions) or drop into the issue tracker. We're happy to help.
