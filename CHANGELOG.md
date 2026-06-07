# Changelog

All notable changes to ares-mcp will be documented in this file.

## [Unreleased]

### Added — tools
- `ares_export_for_invoicing` — adapter that transforms an ARES profile into a Czech invoice-system payload. Targets: `fakturoid` (JSON for `POST .../subjects.json`), `idoklad` (JSON for the Contacts endpoint), `pohoda` (XML-hint JSON with `adb:` namespaces). Pure transformation — no calls to the target system, so no extra license footprint.
- `ares_check_insolvenci` — fast red-flag check reading `seznamRegistraci.{stavZdrojeIr, stavZdrojeCeu}` from the ARES aggregate endpoint. Returns clear `isInsolvent` boolean plus the underlying state codes and human notes. Real fixture: Liberty Ostrava a.s. (IČO 45193258, `stavZdrojeIr = AKTIVNI`).
- `ares_full_due_diligence` — single-call macro that fetches the aggregate, VR and RŽP records in parallel and produces a structured report with a 🟢🟡🔴 risk flag, machine-readable sections, and a Markdown summary suitable for chat display. Conservative scoring: insolvency / dissolution flips to red, missing statutaries / VAT inconsistencies / terminated trade licenses flip to yellow, otherwise green.
- `ares_search_by_address` — find all entities at a given address via `sidlo.textovaAdresa` filter. Flags virtual offices and shell-address concentrations with a tiered warning (>50 = possible regus / virtual office, >500 = strong virtual-office signal).
- `ares_get_res_classification` — statistical classification from the RES sub-registry: headcount bracket (decoded into micro / small / medium / large per EC Recommendation 2003/361), ESA 2010 institutional sector, primary CZ-NACE, NUTS region, financial office.

### Added — flags
- `ares_cross_company_persons` now accepts `includeHistorical: boolean` (default `false`). When `true` the graph builder also visits members with `datumVymazu` set — useful for nominee detection and tracking director musical chairs. On the Agrofert holding fixture, history-mode surfaces 10 shared persons instead of 3, including Jaroslav Kurčík's 17 successive memberships across the group.

### Fixed
- `ares_search_companies` was sending `sidloPsc` and `sidloKodObce` at the top level of the request body; ARES silently ignored those keys. The handler now nests them into `sidlo.{psc, kodObce}` per `AdresaFiltr`.

### Added — UX
- `npm run config` prints ready-to-paste MCP-client configs for Claude Desktop, Cursor and Claude Code with the local absolute path of `dist/index.js` pre-filled. Plus a one-line command for the local HTTP transport.
- `npm run inspector` shortcut to `npx @modelcontextprotocol/inspector node dist/index.js`.

### Added — tests
- 18 new tests across `checkInsolvenci.test.ts`, `fullDueDiligence.test.ts`, `searchByAddress.test.ts`, `getResClassification.test.ts`, and the `includeHistorical` extension of `graph.test.ts`. Total now 69 tests across 6 files, all green. Tests use a `_helpers/mockClient.ts` against real ARES fixtures captured 2026-06-07.

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
