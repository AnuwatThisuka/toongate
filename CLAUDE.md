# CLAUDE.md

This file gives Claude Code project-specific context for `toongate`.

## Project summary
- `toongate` is a Cloudflare Workers proxy that compresses structured LLM payloads (JSON arrays) into TOON format before forwarding to upstream providers/gateways.
- Primary goals: reduce token usage and preserve transparent OpenAI-compatible behavior.
- Runtime stack:
  - Cloudflare Workers
  - Hono
  - D1 (savings logs)
  - Vitest + TypeScript

## Repository layout
- `src/index.ts` — app entrypoint and route mounting
- `src/routes/*` — provider and savings endpoints
- `src/lib/*` — compression, decoding, pricing, and persistence helpers
- `src/middleware/*` — admin/proxy auth middleware
- `migrations/` — D1 schema migrations
- `benchmark/` — load-test and benchmark scripts

## Common commands
- Install deps: `npm install`
- Local dev server: `npm run dev`
- Tests: `npm test`
- Watch tests: `npm run test:watch`
- Typecheck/lint: `npm run lint`
- Regenerate worker types: `npm run types`
- Local D1 migrations: `npm run db:migrate:local`
- Remote D1 migrations: `npm run db:migrate:remote`
- Deploy: `npm run deploy`

## Coding guidelines
- Keep proxy behavior transparent: preserve upstream-compatible request/response shapes.
- Prefer fail-safe behavior:
  - If a payload is not a clear compression candidate, pass through unchanged.
  - On decode/compression edge cases, avoid breaking the request pipeline.
- Maintain auth and security invariants:
  - `/savings/*` remains protected by `ADMIN_KEY`.
  - Proxy routes honor `PROXY_AUTH_KEY` behavior.
- Avoid introducing Node-only APIs in Worker runtime code.

## Validation checklist for changes
1. Run `npm run lint`.
2. Run `npm test`.
3. If route/env changes were made, verify related README/config snippets remain accurate.
4. If D1 behavior changed, validate migrations and query paths.
## Commit conventions
- Use Conventional Commits:
  - `feat:` new behavior or endpoint capability
  - `fix:` bug fixes and regressions
  - `refactor:` internal changes without external behavior changes
  - `test:` test additions/updates
  - `docs:` documentation-only changes
  - `chore:` tooling, dependencies, or maintenance updates
- Keep the subject line imperative and concise (prefer ≤ 72 chars).
- Include optional scope when helpful, e.g. `feat(routes): add Gemini embeddings pass-through`.
- For behavior changes, include a short body with:
  - what changed
  - why it changed
  - any migration or config impact
- Prefer small, single-purpose commits over mixed concerns.

## Release checklist
1. Ensure working tree is clean and branch is up to date.
2. Run quality gates:
   - `npm run lint`
   - `npm test`
3. If pricing logic changed, regenerate pricing data: `npm run generate:pricing`.
4. If schema/storage changed:
   - add/verify migration in `migrations/`
   - test local migration with `npm run db:migrate:local`
5. Review docs for drift:
   - `README.md` routes, env vars, and examples
   - `.dev.vars.example` / `wrangler.jsonc.example` when config surface changed
6. Smoke test locally with representative payloads.
7. Apply remote D1 migrations before deploy: `npm run db:migrate:remote`.
8. Deploy: `npm run deploy`.
9. Post-deploy checks:
   - hit a proxy endpoint and confirm normal pass-through response
   - verify `/savings/summary` works with admin key
   - verify auth behavior for protected routes
10. Tag release and publish release notes summarizing user-visible changes and any required config updates.

## Notes for future contributors
- Keep edits focused and minimal in scope.
- Update docs when changing commands, routes, or environment variables.
- Preserve existing naming and file organization unless there is a clear reason to refactor.
