import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AresClient } from "./ares/client.js";
import { createAresWebClientFromEnv } from "./aresWeb/client.js";
import { createProvenanceService } from "./provenance/service.js";
import { buildToolset } from "./tools/index.js";

const SERVER_NAME = "ares-mcp";
const SERVER_VERSION = "0.1.0";

function log(...args: unknown[]): void {
  // MCP stdio mode requires stdout to be reserved for JSON-RPC; all logs go to stderr.
  process.stderr.write(`[${SERVER_NAME}] ${args.map(String).join(" ")}\n`);
}

async function main(): Promise<void> {
  const client = new AresClient({
    baseUrl: process.env.ARES_BASE_URL,
    ratePerSecond: parseEnvNumber(process.env.ARES_RATE_PER_SECOND, 5),
    timeoutMs: parseEnvNumber(process.env.ARES_TIMEOUT_MS, 15000),
    retries: parseEnvNumber(process.env.ARES_RETRIES, 3),
  });

  const provenance = createProvenanceService();
  const aresWeb = createAresWebClientFromEnv();

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  const ctx = { client, provenance, aresWeb };
  const tools = buildToolset(ctx);
  for (const tool of tools) {
    tool.register(server, ctx);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  const moatCount = tools.filter((t) => t.tier === "moat").length;
  log(
    `ready — registered ${tools.length} tools over stdio (${moatCount} moat${
      aresWeb ? "" : ", ARES_WEB_URL unset → moat tools disabled"
    })` +
      ` (provenance signing: ${provenance.enabled ? `on, key ${provenance.signer?.keyId}` : "off"})`,
  );
}

function parseEnvNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

main().catch((err) => {
  log("fatal:", err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
