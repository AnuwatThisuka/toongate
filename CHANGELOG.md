# Changelog

All notable changes to toongate will be documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [0.1.0] - 2026-05-30

### Added
- TOON compression for uniform arrays of objects (~40% token savings)
- OpenAI routes: `/v1/chat/completions`, `/v1/embeddings`
- Anthropic route: `/v1/messages`
- Streaming SSE pass-through
- D1 savings log with fire-and-forget writes
- Savings REST API: `/savings/summary`, `/savings/history`, `/savings/by-model`
- Debug response headers: `X-Toongate-Compressed`, `X-Toongate-Tokens-Saved`, etc.
- Dry-run mode (`TOON_DRY_RUN=true`)
- Health endpoint (`GET /health`)
- Eligibility scorer with configurable threshold
- Per-route threshold config (`TOON_THRESHOLD_CHAT`, etc.)
- Gateway support: OpenAI direct, Anthropic direct, CF AI Gateway, Helicone, LiteLLM
- Cloudflare Workers + D1 deployment
- Mintlify docs

### Added
- Initial proxy core — request interception, TOON encoding, upstream forwarding
- Helicone header passthrough — all `Helicone-*` headers forwarded untouched
- Standalone mode — forward directly to OpenAI or Anthropic without a downstream gateway
- Tabular eligibility scoring — only encode payloads that benefit from TOON compression
- Per-request savings logger — records `tokens_before`, `tokens_after`, `usd_saved` per request
- Savings dashboard API — query savings by day, month, endpoint, and model
- `UPSTREAM_URL` env var — point toongate at Helicone, OpenAI, Anthropic, LiteLLM, or any OpenAI-compatible endpoint
- `TOON_THRESHOLD` env var — tune compression aggressiveness (default `0.6`)

---

<!-- 
When releasing, move items from [Unreleased] to a versioned section like:

## [0.2.0] - 2025-07-01

### Added
- Gemini upstream support

### Fixed
- Handle empty arrays in eligibility check (#42)

### Changed
- Rename PROXY_KEY to X-Toon-Key for consistency

[0.2.0]: https://github.com/anuwatthisuka/toongate/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/anuwatthisuka/toongate/releases/tag/v0.1.0
-->
