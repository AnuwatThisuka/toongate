# Changelog

All notable changes to toongate will be documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

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
