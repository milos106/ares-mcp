# MCP server pro ARES — specifikace

## 1. Účel a cílová skupina

**Co stavíme:** MCP (Model Context Protocol) server, který zpřístupňuje data z ARES (Administrativní registr ekonomických subjektů, ČR) jako sadu tools volatelných z Claude Desktop, Claude Code, Cursor a dalších MCP klientů.

**Proč:** ARES je veřejná, zdarma dostupná, autoritativní zdrojová databáze českých ekonomických subjektů. Nemá MCP integraci, ačkoli use cases (validace IČO/DIČ, due diligence, lead enrichment, compliance, fakturace, KYC, prevence podvodu) jsou frekventované u developerů, účetních, advokátů, sales operations a auditů.

**Cílová skupina:**
- Vývojáři používající AI coding agenty (Claude Code, Cursor) v českých dodavatelských projektech
- Účetní a daňoví poradci využívající AI workflows
- Sales/BD týmy dělající enrichment leadů z ČR
- Compliance a KYC týmy ve fintech / regtech
- Solo OSVČ a freelancers (fakturace, validace klientů)

**Použitelnost:** Tento projekt je primárně **portfolio piece + brand builder** pro ekosystém vertikálních MCP serverů zaměřených na český fiskální/účetní/registr stack. Plánovaná licence: MIT.

---

## 2. Analýza ARES API (cílový stav)

**Base URL:** `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/`
**OpenAPI spec:** `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/v3/api-docs`
**Swagger UI:** `https://ares.gov.cz/swagger-ui/`
**Autentizace:** žádná (veřejné API)
**Rate limity:** existují, nejsou v API specifikaci uvedeny explicitně; provozovatel uvádí „limity pro množství dotazů". Implementace musí počítat s 429 a respektovat `Retry-After`.

**Relevantní endpointy pro MCP:**

| Endpoint | Metoda | Účel |
|---|---|---|
| `/ekonomicke-subjekty/{ico}` | GET | Agregovaný detail subjektu (kombinuje VR, RES, RŽP) |
| `/ekonomicke-subjekty/vyhledat` | POST | Strukturované vyhledání podle filtru |
| `/ekonomicke-subjekty-vr/{ico}` | GET | Detail z Veřejného rejstříku (justice — statutární orgány, společníci, basic capital, předmět činnosti) |
| `/ekonomicke-subjekty-vr/vyhledat` | POST | Search ve VR |
| `/ekonomicke-subjekty-res/{ico}` | GET | Detail z RES (živé/zaniklé, klasifikace CZ-NACE, velikostní kategorie, institucionální sektor) |
| `/ekonomicke-subjekty-rzp/{ico}` | GET | Detail z RŽP (živnostenská oprávnění, předměty podnikání) |
| `/ekonomicke-subjekty-rzp/vyhledat` | POST | Search v RŽP |
| `/standardizovane-adresy/vyhledat` | POST | Standardizace a vyhledávání adres (RÚIAN) |
| `/ciselniky-nazevniky/vyhledat` | POST | Číselníky (CZ-NACE, právní formy, kódy obcí) |
| `/ekonomicke-subjekty-notifikace/vyhledat` | POST | Změnové dávky — sledování změn v subjektu (pro premium feature) |
| `/ekonomicke-subjekty-notifikace/datovy-zdroj/{datovyZdroj}/cislo-davky/{cisloDavky}` | GET | Konkrétní změnová dávka |

**Specializované registry** (volitelně v pozdější fázi): NRPZS (nestátní zdravotnická zařízení), RPSH (politické strany), RCNS (církve), SZR (státní zdravotní registr), RŠ (registr škol), ROS (registr osob), CEÚ (centrální evidence úpadců).

**Klíčové schémata:** `EkonomickySubjekt` (kořen), `EkonomickeSubjektySeznam` (paginovaný seznam), `Adresa` (hierarchická, s kódy RÚIAN), `SeznamRegistraci` (status v jednotlivých registrech), `Chyba` (error response).

---

## 3. MCP tool specifikace

Server bude exponovat **8 stabilních tools v MVP** + **4 tools v Premium tieru**.

### 3.1 MVP tools (Free, MIT)

#### `ares_lookup_company`
Plnohodnotný lookup subjektu podle IČO. Vrátí agregovaný profil ze všech relevantních registrů.

**Parametry:**
- `ico` (string, required) — 8místné IČO (i s úvodními nulami). Validace přes Mod-11 checksum.

**Návratová struktura (JSON):**
```json
{
  "ico": "27074358",
  "obchodniJmeno": "Stormware s.r.o.",
  "pravniForma": { "kod": "112", "nazev": "Společnost s ručením omezeným" },
  "datumVzniku": "2003-06-19",
  "datumZaniku": null,
  "stavSubjektu": "AKTIVNI",
  "icDph": "CZ27074358",
  "plátceDph": true,
  "sidlo": {
    "ulice": "Za Prachárnou",
    "cisloDomovni": "4962",
    "cisloOrientacni": "45",
    "obec": "Jihlava",
    "psc": "58601",
    "kodObce": 586846,
    "kodCastiObce": 586846,
    "okres": "Jihlava",
    "kraj": "Vysočina",
    "ruianAdresniMisto": 21841491
  },
  "czNace": [
    { "kod": "620", "nazev": "Činnosti v oblasti informačních technologií" }
  ],
  "registraceUradu": {
    "vr": true,
    "res": true,
    "rzp": true
  },
  "_zdroje": ["ares", "vr", "res"]
}
```

**Chování:**
- Tool nejprve volá `/ekonomicke-subjekty/{ico}` (agregát).
- Pokud subjekt existuje pouze v RŽP, tool to detekuje a vrátí omezený profil.
- Při 404 vrátí strukturovanou chybu `{ error: "NOT_FOUND", ico, message: "Subjekt s IČO X nebyl nalezen." }`.
- Při 429 retry s exponential backoff (max 3 pokusy, max delay 30s) a respektem k `Retry-After`.

**Příklad agentického použití:**
> „Validuj IČO 27074358 a řekni mi, jestli je plátce DPH a v jakém kraji sídlí."

---

#### `ares_search_companies`
Strukturované vyhledávání podle více kritérií.

**Parametry:**
- `obchodniJmeno` (string, optional) — full-text v názvu
- `sidloObec` (string, optional) — obec sídla
- `sidloPsc` (string, optional) — PSČ sídla
- `pravniForma` (string, optional) — kód právní formy (z číselníku)
- `czNace` (string, optional) — kód CZ-NACE (např. „620" pro IT)
- `stavSubjektu` (enum, optional) — `AKTIVNI` | `ZANIKLY` | `VSE` (default `AKTIVNI`)
- `limit` (int, optional, max 100, default 25) — počet výsledků
- `offset` (int, optional, default 0) — pagination

**Návratová struktura:**
```json
{
  "celkemNalezeno": 142,
  "vraceno": 25,
  "offset": 0,
  "vysledky": [ { /* zkrácený EkonomickySubjekt */ } ]
}
```

**Chování:**
- Validuje, že alespoň jeden filter parametr je uveden (jinak vrátí chybu — zabrání náhodnému stažení celého RES).
- Pokud `celkemNalezeno > 1000`, tool vrátí varování v response a doporučí zúžit dotaz.

---

#### `ares_get_statutory_bodies`
Seznam statutárních orgánů (jednatelé, představenstvo, dozorčí rada) z Veřejného rejstříku.

**Parametry:**
- `ico` (string, required)

**Návratová struktura:**
```json
{
  "ico": "27074358",
  "statutarniOrgany": [
    {
      "funkce": "Jednatel",
      "jmeno": "Jan Novák",
      "datumNarozeni": "1975-04-12",
      "adresa": { /* Adresa */ },
      "datumVzniku": "2020-01-15",
      "datumZaniku": null
    }
  ],
  "spolecnici": [ /* … */ ],
  "zakladniKapital": { "castka": 1000000, "mena": "CZK" }
}
```

**Použití:** Due diligence, KYC, lead enrichment, anti-fraud, ověření oprávnění podepisovat smlouvy.

---

#### `ares_get_trade_licenses`
Seznam živnostenských oprávnění (RŽP).

**Parametry:**
- `ico` (string, required)

**Návratová struktura:**
```json
{
  "ico": "27074358",
  "zivnostenskaOpravneni": [
    {
      "predmetPodnikani": "Výroba, obchod a služby neuvedené v přílohách 1 až 3 živnostenského zákona",
      "druh": "Volná",
      "datumVzniku": "2003-07-01",
      "datumZaniku": null,
      "stav": "PLATNE",
      "oboryCinnosti": ["Velkoobchod a maloobchod", "Poskytování software, poradenství v oblasti informačních technologií"]
    }
  ]
}
```

---

#### `ares_validate_ico`
Pure-function checksum validace bez network volání.

**Parametry:**
- `ico` (string, required)

**Návratová struktura:**
```json
{
  "ico": "27074358",
  "valid": true,
  "normalized": "27074358"
}
```

**Chování:**
- Implementace algoritmu modulo-11 ČSÚ pro IČO.
- Normalizuje vstupy „270 743 58", „CZ27074358", „27074358 " → kanonické „27074358".
- Nevolá ARES API — okamžitá odpověď.

---

#### `ares_check_vat_payer`
Ověření statusu DPH plátce přes ARES (vrací `icDph` a `plátceDph` z agregátu).

**Parametry:**
- `ico` (string, required) — IČO subjektu
- `nebo_dic` (string, optional) — DIČ k validaci proti odpovědi

**Návratová struktura:**
```json
{
  "ico": "27074358",
  "icDph": "CZ27074358",
  "platceDph": true,
  "datumRegistrace": "2003-07-01",
  "datumZruseni": null,
  "_overeno": "2026-06-06T12:00:00Z"
}
```

**Důležitá poznámka:** ARES je sekundární zdroj pro DPH; **autoritativní zdroj je registr plátců DPH na MFČR** (`adisspr.mfcr.cz`). V Premium tieru bude `ares_check_vat_payer_authoritative`, který volá MFČR; v MVP varujeme v response, že data jsou z ARES s denním zpožděním.

---

#### `ares_standardize_address`
Standardizace volně psané adresy přes RÚIAN.

**Parametry:**
- `adresa` (string, required) — volný text adresy
- `limit` (int, optional, default 5)

**Návratová struktura:**
```json
{
  "vstup": "Za prachárnou 4962/45, Jihlava",
  "navrhy": [
    {
      "kanonickaAdresa": "Za Prachárnou 4962/45, 58601 Jihlava",
      "ruianAdresniMisto": 21841491,
      "skore": 0.98,
      "komponenty": { /* Adresa */ }
    }
  ]
}
```

---

#### `ares_lookup_czNace`
Lookup CZ-NACE kódu / názvu (číselník).

**Parametry:**
- `query` (string, required) — kód („620") nebo část názvu („informačn")

**Návratová struktura:**
```json
{
  "vysledky": [
    { "kod": "62010", "nazev": "Programování", "uroven": 5 },
    { "kod": "62020", "nazev": "Poradenství v oblasti informačních technologií", "uroven": 5 }
  ]
}
```

### 3.2 Premium tier tools (Hosted SaaS, paid)

#### `ares_subscribe_changes`
Nastaví sledování změn u IČO (notifikační dávky). Při změně subjektu pošle webhook nebo agenta upozorní při příštím volání.

**Stav:** v MVP nepostaveno; backend ARES `/ekonomicke-subjekty-notifikace` existuje, ale vyžaduje vlastní polling infrastrukturu + storage. Patří do Premium tieru.

#### `ares_bulk_lookup`
Batch lookup až 1000 IČO najednou s konkurencí + rate-limit-aware queueing.

**Stav:** v MVP omezeno na 5 sekvenčních volání; Premium tier zvyšuje limit na 1000 + paralelismus + caching.

#### `ares_due_diligence_report`
Generuje strukturovaný Markdown report o subjektu — agregát všech tools + LLM summary.

**Stav:** Premium, vyžaduje LLM dependency (vlastní API klíč nebo bring-your-own).

#### `ares_export_to_invoice_systems`
Bridge formátování pro Pohoda XML, Fakturoid API, iDoklad. Premium.

---

## 4. Technický stack

**Volba:** **TypeScript + `@modelcontextprotocol/sdk`**

**Důvody:**
- TS je nejlépe podporovaný MCP SDK (TS-first ekosystem, validace přes Zod).
- Distribuce přes npm + Smithery + Claude Desktop config je nativní cesta pro MCP.
- Vývoj end-to-end: `bun` nebo `node`, build přes `tsup`, lint přes `biome`.

**Závislosti:**
- `@modelcontextprotocol/sdk` — MCP runtime
- `zod` — schema validace tool parametrů
- `undici` — HTTP klient (lepší než node-fetch pro rate-limit handling)
- `p-retry` — exponential backoff s `Retry-After` respekten
- `keyv` + `@keyv/sqlite` — embedded cache (volitelné, pro lokální caching ARES odpovědí)

**Bez:** TypeORM, Prisma, Express, NestJS — overkill. MCP server je stdio-based proces, ne HTTP server (i když Streamable HTTP varianta je v plánu pro v2).

---

## 5. Struktura projektu

```
ares-mcp/
├── package.json
├── tsconfig.json
├── biome.json
├── README.md
├── LICENSE                  # MIT
├── src/
│   ├── index.ts             # MCP server entrypoint (stdio transport)
│   ├── ares/
│   │   ├── client.ts        # HTTP klient s retry + rate limit
│   │   ├── types.ts         # TS types odvozené z OpenAPI
│   │   └── normalize.ts     # Normalizace IČO/DIČ/adres
│   ├── tools/
│   │   ├── lookupCompany.ts
│   │   ├── searchCompanies.ts
│   │   ├── getStatutoryBodies.ts
│   │   ├── getTradeLicenses.ts
│   │   ├── validateIco.ts
│   │   ├── checkVatPayer.ts
│   │   ├── standardizeAddress.ts
│   │   └── lookupCzNace.ts
│   ├── cache/
│   │   └── sqliteCache.ts   # Volitelný caching layer
│   └── errors.ts            # Strukturované error mapping
├── tests/
│   ├── tools.test.ts        # Unit testy tools (s mock klientem)
│   ├── client.test.ts       # Integrace s ARES (skip in CI bez sítě)
│   └── fixtures/            # Sample ARES odpovědi
└── examples/
    ├── claude-desktop.json  # Sample MCP config
    └── usage.md             # Příklady promptů
```

---

## 6. Klíčové implementační detaily

### 6.1 IČO Mod-11 checksum
```
Pravidla:
1. IČO má 8 číslic (případně doplnit na 8 vodícími nulami).
2. Vah pro pozice 1-7 = [8, 7, 6, 5, 4, 3, 2].
3. Součet × váhy mod 11 → c.
4. Kontrolní číslice = (11 - c) mod 10, s výjimkou c=1 → neplatné.
```
Implementace pure-function, plně testovaná.

### 6.2 Rate-limit handling
- Default budget: max 10 req/s na ARES.
- Token bucket (in-memory).
- Při 429 čti `Retry-After`, čekej, retry až 3× s exp backoff (base 1s, max 30s).
- Po 3 neúspěšných retry → strukturovaná chyba `RATE_LIMITED`.

### 6.3 Caching strategie
- Default off (privacy first — uživatel data neukládá lokálně).
- Volitelné `--cache` flag → SQLite cache s TTL 24h pro `lookup_company`, `get_statutory_bodies`, `get_trade_licenses`. Pro `search_*` TTL 1h. Pro `validate_ico` nikdy necachuj (je to pure function).
- Cache klíč: hash celého request payloadu (cesta + body).

### 6.4 Error mapping
ARES vrací `Chyba` schema; mapování:

| ARES kód | MCP error code | Hlášení uživateli |
|---|---|---|
| 404 | `NOT_FOUND` | „Subjekt s IČO X nebyl nalezen." |
| 400 | `INVALID_INPUT` | „Neplatný formát IČO/parametru." |
| 429 | `RATE_LIMITED` | „ARES limit dotazů překročen, počkej a zkus znovu." |
| 500/503 | `UPSTREAM_ERROR` | „ARES je dočasně nedostupný." |
| network | `NETWORK_ERROR` | „Nelze se připojit k ARES." |

### 6.5 Logging
- Default: pouze chyby na stderr (MCP stdio mode vyžaduje čistý stdout).
- `DEBUG=ares-mcp:*` zapne verbose logging.

---

## 7. Distribuce a instalace

### 7.1 npm package
```
npm install -g ares-mcp
# nebo
npx ares-mcp
```

### 7.2 Claude Desktop config
Sample `~/.config/Claude/claude_desktop_config.json` (Linux) / `%APPDATA%/Claude/claude_desktop_config.json` (Win):
```json
{
  "mcpServers": {
    "ares": {
      "command": "npx",
      "args": ["-y", "ares-mcp"]
    }
  }
}
```

### 7.3 Claude Code
```
claude mcp add ares -- npx -y ares-mcp
```

### 7.4 Smithery
Publish do `smithery.ai` pro one-click instalaci.

### 7.5 Anthropic plugin directory
Zabalit jako Claude Code plugin (`plugin.json` + manifest) a publikovat do Anthropic marketplace.

---

## 8. Milestones

| Týden | Cíl | Deliverable |
|---|---|---|
| **1** | Boilerplate + ARES klient | `client.ts` + IČO validace + první tool `validate_ico` |
| **2** | Core lookup tools | `lookup_company`, `check_vat_payer`, `lookup_czNace` |
| **3** | Search + adresy | `search_companies`, `standardize_address` |
| **4** | Statutární orgány + živnosti | `get_statutory_bodies`, `get_trade_licenses` |
| **5** | Testy + dokumentace | 80% coverage, README s příklady, CHANGELOG |
| **6** | Distribuce | npm publish, Smithery, blog post „MCP for Czech business data" |
| **7** | Plugin directory | Claude Code plugin packaging, Anthropic marketplace submission |
| **8** | Buffer / feedback iterace | Reaguj na první issues |

---

## 9. Testovací strategie

### 9.1 Unit testy
- IČO validace: 50+ test vektorů (validní + nevalidní + edge cases).
- Error mapping: každý ARES error code → očekávaný MCP error.
- Schema validace: zod schemata pro vstup/výstup každého toolu.

### 9.2 Integrace
- 1 test per tool proti reálnému ARES (run nightly nebo manuálně, ne v CI).
- Fixture-based testy v CI: `nock` nebo `msw-node` mockuje HTTP.

### 9.3 Smoke test MCP protokolu
- `@modelcontextprotocol/inspector` proti běžícímu serveru.
- Ověř, že každý tool se discovery objeví a invocation vrátí očekávaný shape.

### 9.4 Manuální QA s Claude Desktop
- 10 reálných promptů („Validuj IČO X", „Najdi firmy s NACE 620 v Praze", „Kdo je jednatel u IČO Y", …) — ověř, že Claude správně tooly volá a interpretuje odpovědi.

---

## 10. Distribuční / marketing plán

### 10.1 Globální (anglicky)
- README v angličtině s motivem „Czech business registry MCP server".
- HN Show HN post: „Show HN: ARES MCP — Czech business registry for Claude/Cursor".
- Tweet/X thread o use cases.
- Awesome-MCP listy PR.
- Reddit r/ClaudeAI, r/cursor.

### 10.2 České komunity
- Czech blog post na vlastním webu / dev.to: „Jak napojit ARES na Claude — MCP server pro českou účetní praxi".
- Sdílení na root.cz, zdrojak.cz, lupa.cz (developer sekce).
- Reddit r/czech, r/programovani.
- LinkedIn článek cílený na CFO/účetní.
- Facebook skupiny: „Účetní a daňoví poradci", „Programátoři ČR".

### 10.3 Konference (volitelně)
- Czech Dev Conf, WebExpo, OpenAlt — lightning talk „MCP servery pro český byznys stack".

---

## 11. Monetizační roadmap

**Fáze 1 (MVP, měsíce 1-3):** 100 % open source MIT. Cíl je adopce + brand. **Žádná monetizace.**

**Fáze 2 (měsíce 4-6):** Spuštění **ARES MCP Cloud** — hostovaná varianta s premium tools:
- `bulk_lookup` až 1000 IČO
- `subscribe_changes` (notifikace na změny)
- `due_diligence_report` (LLM summary)
- Pricing: zdarma do 100 lookups/měsíc, 290 Kč/měs do 1000, 990 Kč/měs do 10 000, enterprise na vyžádání.

**Fáze 3 (měsíce 7-12):** Bundle s dalšími českými MCP servery (Pohoda, Fio Banka, datovky) → **Czech Business MCP Suite** za 1 490 Kč/měs.

**Fáze 4 (rok 2):** Consulting / implementation services pro firmy, které chtějí custom MCP integrace nad vlastními ERP / datovými zdroji.

---

## 12. Rizika a mitigace

| Riziko | Pravděpodobnost | Dopad | Mitigace |
|---|---|---|---|
| MFČR / ARES zavře API nebo přidá auth | Nízká | Vysoký | Sleduj changelog, udržuj contact channel s vyvojar@mfcr.cz |
| Anthropic změní MCP spec | Střední | Střední | Pin SDK, sleduj spec updates, modulární architecture |
| Konkurence (oficiální Anthropic / Stormware MCP) | Střední | Střední | Buduj brand a komunitu rychle, focus na české specifika konkurence neopepere |
| Rate-limit ARES bude restriktivnější | Střední | Střední | Implementuj caching, dokumentuj limity, edukuj users |
| Falešné údaje uživatelů (špatné rozhodnutí na základě dat) | Nízká | Vysoký | Disclaimer v každé tool response: „Data z ARES jsou veřejná, ne autoritativní pro právní účely. Pro účely soudních sporů použijte ověřený výpis z veřejného rejstříku." |
| GDPR (zpracování osobních údajů jednatelů) | Nízká | Střední | ARES data jsou veřejně dostupná → GDPR výjimka pro veřejnou listinu (čl. 6(1)(e) GDPR). Žádné ukládání bez explicitního opt-in. |

---

## 13. Out of scope (pro MVP)

- Sledování změn (notifikace) — odložit do Premium tieru.
- LLM-summarized due diligence — odložit do Premium tieru.
- Hosted REST API verze (pro non-MCP klienty) — odložit.
- Multi-jazyk UI (CZ/EN/SK) — README anglicky, error messages dvojjazyčně.
- Integrace s Pohoda/Fakturoid — separátní projekt v MCP suite.

---

## 14. Definition of Done pro v1.0.0

- [ ] 8 MVP tools implementovaných a otestovaných (unit + integration)
- [ ] 80%+ test coverage
- [ ] README v EN s příklady použití pro Claude Desktop, Claude Code, Cursor
- [ ] CHANGELOG.md
- [ ] LICENSE (MIT)
- [ ] Publikováno na npm jako `ares-mcp`
- [ ] Publikováno na Smithery
- [ ] Submission do Anthropic plugin directory
- [ ] Show HN post připraven
- [ ] CZ blog post publikován
- [ ] 5+ reálných uživatelů potvrdilo funkčnost (Discord / GitHub issues / direct feedback)

---

## 15. Odkazy

- ARES portál: https://ares.gov.cz/
- ARES Swagger UI: https://ares.gov.cz/swagger-ui/
- ARES OpenAPI spec: https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/v3/api-docs
- ARES Changelog: https://ares.gov.cz/stranky/changelog-api
- Vývojářské info: https://ares.gov.cz/stranky/vyvojar-info
- Portál otevřených dat MFČR: https://data.mf.gov.cz/api/ares.html
- MCP specifikace: https://modelcontextprotocol.io/
- MCP TS SDK: https://github.com/modelcontextprotocol/typescript-sdk
- Existující komunitní ARES wrapper (inspirace, ne MCP): https://github.com/Ewebovky/ARES
