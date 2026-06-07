# Example prompts

Once `ares-mcp` is configured in your MCP client (Claude Desktop, Claude Code, Cursor, …), the model can call the tools directly. These prompts have been tested against real ARES data.

## Validation (no network call)

> "Validate the Czech IČO 27074358 and tell me whether it's structurally correct."

The model should call `ares_validate_ico` and report `valid: true`, normalized form `27074358`.

> "Is `CZ27074358 ` a valid IČO?"

Should normalize and validate.

## Company profile

> "Look up the company with IČO 27074358. Where is it based and what's its legal form?"

The model calls `ares_lookup_company` and reports legal form `121` (akciová společnost), registered address in Prague 4, active VAT payer, DIČ `CZ27074358`.

## VAT-payer check

> "Is the company with IČO 26168685 currently registered for VAT?"

The model calls `ares_check_vat_payer` and reports the status with the standard disclaimer about ARES being a non-authoritative source for VAT (the authoritative one is adisspr.mfcr.cz).

## Search

> "Find Czech IT companies (CZ-NACE 620) based in Prague."

The model calls `ares_search_companies` with `czNace: ["620"]` and `sidloKodObce` for Prague. If the result set is large, it reports the warning and asks whether to narrow the filter.

## Due diligence

> "Who are the statutory directors of IČO 49240901 (ČEZ a.s.)? When were they appointed and when does each term end?"

The model calls `ares_get_statutory_bodies` and lists the board with appointment and termination dates.

## Trade licenses

> "What trade licenses does IČO 27074358 hold? Which are still active?"

The model calls `ares_get_trade_licenses`.

## Address standardization

> "Normalize this address against RÚIAN: 'Budějovická 778/3a, Praha 4'."

The model calls `ares_standardize_address` and returns canonical form with RÚIAN address-point code.

## CZ-NACE lookup

> "What's the CZ-NACE code for software development?"

The model calls `ares_lookup_cz_nace` with `query: "software"` and returns the relevant entries.

## Combined workflow

> "I'm about to sign a contract with the company at IČO 60193336. Pull their profile, list their statutory directors, and confirm they're an active VAT payer."

The model orchestrates `ares_lookup_company`, `ares_get_statutory_bodies`, and `ares_check_vat_payer` in sequence.
