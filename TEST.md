# Testing & verifying ares-mcp

How to independently verify this MCP server — from a clean clone, the way any
third party would. Works on **macOS, Windows and Linux** (it's a Node.js tool).

## Prerequisites

- **Node.js ≥ 20** (`node -v`)
- Network access — the tools call the **public** ARES API at `ares.gov.cz`
  (no API key, no account required)

## 1. Build & run the unit tests

```sh
git clone https://github.com/milos106/ares-mcp
cd ares-mcp
npm install
npm run build
npm test
```

Expected: **all tests pass**, including the provenance sign / verify / tamper
suite.

## 2. MCP Inspector (interactive, easiest)

```sh
npm run inspector
```

Opens the official MCP Inspector in your browser. Then:

1. **Connect** — transport `stdio`, command `node dist/index.js`.
2. **List Tools** — you should see 14 tools.
3. Call `ares_full_due_diligence` with:
   ```json
   { "ico": "26185610" }
   ```

Expected: a **live** response from ARES (AGROFERT, a.s., 🟢 green risk) with
structured sections, a Markdown summary and a `provenance` envelope.

## 3. Use it from a real MCP client (Claude Desktop / Code / Cursor)

```sh
npm run config
```

Prints ready-to-paste configs with the absolute path to `dist/index.js` for
Claude Desktop, Claude Code and Cursor. Claude Code one-liner:

```sh
claude mcp add ares -- node "$(pwd)/dist/index.js"
```

Restart the client, then ask it to look up a company by IČO.

> **macOS note:** Claude Desktop config lives at
> `~/Library/Application Support/Claude/claude_desktop_config.json`.
> `npm run config` prints the right path for your OS.

## 4. HTTP transport

```sh
npm run start:http              # listens on :3030 (set PORT to override)
curl localhost:3030/healthz
curl localhost:3030/llms.txt
```

## 5. Verify signed provenance (optional)

Signing is **opt-in** via an Ed25519 key (the server runs unsigned without one).

```sh
node scripts/generate-provenance-keys.mjs --key-id test > /tmp/ares.keys.env
set -a; source /tmp/ares.keys.env; set +a
npm run provenance:demo /tmp/ares-out
node scripts/verify-provenance.mjs /tmp/ares-out/response.json --jwks /tmp/ares-out/keys.json
```

Expected: `signature ✅ VALID`. Now edit any value in
`/tmp/ares-out/response.json` and re-run the verify step → `❌ INVALID`
(tamper detection).

With a key set, the HTTP server also publishes the public keys:

```sh
ARES_PROVENANCE_PRIVATE_KEY=… ARES_PROVENANCE_KEY_ID=test npm run start:http
curl localhost:3030/.well-known/ares-provenance/keys.json
```

> The signature is a **technical integrity & origin proof** — not a qualified
> electronic signature/seal and not an officially certified extract. See README.

## What this proves

- The tools return **real, current** ARES data.
- The MCP handshake + `tools/list` + `tools/call` work with any compliant client.
- Signed provenance is **verifiable offline** and **detects tampering**.

The most independent check: have someone else run section 1 + 2 from a clean
clone on their own machine.
