# Contributing to ares-mcp

Thanks for your interest! `ares-mcp` is an independent open-source MCP server for
ARES (the Czech business registry). Contributions — bug reports, fixes, new
tools, docs — are welcome.

## Getting started

```sh
git clone git@github.com:milos106/ares-mcp.git
cd ares-mcp
npm install
npm run build      # tsup → dist/
npm test           # vitest (mocked ARES client, no network)
```

Useful scripts:

| Script | What it does |
|---|---|
| `npm run build` | Bundle `src/` → `dist/` (stdio + HTTP entry points) |
| `npm test` | Run the vitest suite (offline, fixture-based) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` / `npm run format` | Biome check / format |
| `npm run dev` / `npm run dev:http` | Run from source via tsx |
| `npm run inspector` | Launch the MCP Inspector against `dist/index.js` |

## Adding a tool

Tools live in `src/tools/` and are registered in `src/tools/index.ts`.

1. Create `src/tools/myTool.ts` and export a tool built with `defineTool({ name, description, inputShape, handler })` (see `lookupCompany.ts` for the pattern). Use a `zod` `inputShape` so arguments are validated and typed.
2. Return results via `jsonResult(...)` / `errorResult(...)` from `tools/common.ts`. Include the relevant disclaimer + attribution constants.
3. Register it in `BASE_TOOLS` (public ARES tools) in `src/tools/index.ts`. Tools that depend on the optional `ares_web` data brain go in `MOAT_TOOLS` and set `tier: "moat"` (they only register when `ARES_WEB_URL` is configured).
4. Add a focused test in `tests/` (mock the client via `tests/_helpers/mockClient.ts`).

Before opening a PR, please make sure `npm run typecheck`, `npm run lint`, and `npm test` all pass.

## Pull requests

- Keep PRs focused; describe the change and the motivation.
- Match the surrounding code style (Biome enforces formatting).
- New behavior should come with a test.
- Don't commit `dist/` (it is git-ignored and built in CI / on install).

## Reporting issues

Open a GitHub issue with steps to reproduce. For **security** vulnerabilities,
do **not** open a public issue — see [SECURITY.md](./SECURITY.md).

## Data, attribution & scope

ARES data is public (CC BY 4.0, MF ČR) but **not** authoritative for legal
proceedings; tools surface this in their disclaimers. `ares-mcp` is not
affiliated with or endorsed by MF ČR or the ARES operator. Please keep new
tools within the public-registry, due-diligence scope and preserve source
attribution in outputs.

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](./LICENSE).
