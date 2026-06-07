# Changelog

All notable changes to ares-mcp will be documented in this file.

## [Unreleased]

### Added
- `ares_check_insolvenci` — fast red-flag check reading `seznamRegistraci.{stavZdrojeIr, stavZdrojeCeu}` from the ARES aggregate endpoint. Returns clear `isInsolvent` boolean plus the underlying state codes and human notes. Real fixture: Liberty Ostrava a.s. (IČO 45193258, `stavZdrojeIr = AKTIVNI`).
- `ares_full_due_diligence` — single-call macro that fetches the aggregate, VR and RŽP records in parallel and produces a structured report with a 🟢🟡🔴 risk flag, machine-readable sections, and a Markdown summary suitable for chat display. Conservative scoring: insolvency / dissolution flips to red, missing statutaries / VAT inconsistencies / terminated trade licenses flip to yellow, otherwise green.

### Changed
- Project marked `"private": true` in package.json; npm distribution removed (use locally cloned repo).
- Build no longer emits source maps (`tsup` config `sourcemap: false`) to avoid leaking TypeScript source via `dist/*.js.map`.

## [0.1.0] — 2026-06-07

Initial release.

### Tools

- `ares_validate_ico` — Mod-11 checksum validation (pure, no network call).
- `ares_lookup_company` — Aggregated company profile by IČO.
- `ares_search_companies` — Structured search by name, postcode, NACE, legal form.
- `ares_get_statutory_bodies` — Current statutory body members from the Public Register (VR).
- `ares_get_trade_licenses` — Trade licenses (RŽP).
- `ares_check_vat_payer` — VAT-payer status with optional DIČ cross-check.
- `ares_standardize_address` — RÚIAN address canonicalization.
- `ares_lookup_cz_nace` — CZ-NACE classification lookup.
- `ares_cross_company_persons` — Person/legal-entity overlap across a known set of 2–50 IČOs, with Mermaid graph output.

### Infrastructure

- Stdio MCP transport (entry: `ares-mcp` / `dist/index.js`).
- Streamable HTTP transport (entry: `ares-mcp-http` / `dist/http.js`), with per-IP rate limiting (token bucket), session management, body-size guard, optional CORS allow-origin.
- ARES HTTP client with 5 req/s default budget (under the MFČR 500 req/min ceiling), `Retry-After`-aware exponential backoff, structured error mapping.
- CC BY 4.0 attribution block and affiliation disclaimer embedded in every tool result.
- 51 unit tests covering IČO Mod-11 (incl. the `remainder == 1` edge case missed by naive implementations) and the cross-company graph builder against real Agrofert holding fixtures.

### Known limitations

- ARES public REST v3 does not support search by natural person — the `AngazovanaOsobaFiltr` schema is defined but unused. Cross-company graph operates over user-supplied IČO sets only.
- VAT-payer status from ARES has up to 24h delay; the authoritative source is the MFČR VAT registry at adisspr.mfcr.cz.
