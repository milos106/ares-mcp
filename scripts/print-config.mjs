#!/usr/bin/env node
/**
 * Prints ready-to-paste MCP-client configs for this local checkout with the
 * absolute path of dist/index.js pre-filled. Run via `npm run config`.
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const distPath = resolve(projectRoot, "dist", "index.js");
const distHttp = resolve(projectRoot, "dist", "http.js");

const SERVER_KEY = "ares";

const claudeDesktop = {
  mcpServers: {
    [SERVER_KEY]: {
      command: "node",
      args: [distPath],
      env: { ARES_RATE_PER_SECOND: "5" },
    },
  },
};

const cursor = {
  mcpServers: {
    [SERVER_KEY]: {
      command: "node",
      args: [distPath],
      env: { ARES_RATE_PER_SECOND: "5" },
    },
  },
};

const claudeCodeCmd = `claude mcp add ${SERVER_KEY} -- node ${distPath}`;
const httpDevCmd = `PORT=3030 node ${distHttp}`;

const out = (s) => process.stdout.write(`${s}\n`);

out("== Claude Desktop (~/.config/Claude/claude_desktop_config.json on Linux) ==\n");
out(JSON.stringify(claudeDesktop, null, 2));
out("\n== Cursor (Settings → MCP servers) ==\n");
out(JSON.stringify(cursor, null, 2));
out("\n== Claude Code (one-liner) ==\n");
out(claudeCodeCmd);
out("\n== Local HTTP transport (POST /mcp on localhost:3030) ==\n");
out(httpDevCmd);
out("\n== Notes ==");
out(`- dist/index.js path: ${distPath}`);
out(`- dist/http.js  path: ${distHttp}`);
out("- Run `npm run build` once before pointing a client at dist/.");
out("- Override ARES_RATE_PER_SECOND if you run multiple clients concurrently; keep total ≤ 8.");
