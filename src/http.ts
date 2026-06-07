/**
 * HTTP entry point: exposes the same MCP server over Streamable HTTP transport
 * at POST /mcp, plus a /healthz liveness endpoint. Designed for self-hosting
 * (Fly.io, Hetzner, Cloudflare Workers via WebStandard variant) or running
 * locally alongside the stdio variant.
 *
 * Stateful sessions: each MCP `initialize` request spawns a new transport
 * keyed by the generated session ID. Subsequent requests must include the
 * `Mcp-Session-Id` header.
 *
 * Defensive limits:
 *  - Per-IP token bucket (60 req/min by default) — protects upstream ARES
 *    even if a single client misbehaves
 *  - Request body size cap (1 MB) — JSON-RPC payloads are tiny; anything
 *    larger is rejected
 *  - Optional origin allow-list via ARES_HTTP_ALLOW_ORIGIN
 *
 * Per design we do NOT add authentication out of the box — the upstream
 * data is public. Operators adding auth should put a reverse proxy in
 * front (Cloudflare Access, nginx basic auth, …).
 */

import { randomUUID } from "node:crypto";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { AresClient } from "./ares/client.js";
import { ALL_TOOLS } from "./tools/index.js";

const SERVER_NAME = "ares-mcp";
const SERVER_VERSION = "0.1.0";

function log(...args: unknown[]): void {
  process.stderr.write(`[${SERVER_NAME}:http] ${args.map(String).join(" ")}\n`);
}

function parseEnvNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const PORT = parseEnvNumber(process.env.PORT, 3030);
const MAX_BODY_BYTES = parseEnvNumber(process.env.ARES_HTTP_MAX_BODY, 1_000_000);
const RATE_LIMIT_PER_MIN = parseEnvNumber(process.env.ARES_HTTP_RATE_LIMIT, 60);
const SESSION_TTL_MS = parseEnvNumber(process.env.ARES_HTTP_SESSION_TTL_MS, 60 * 60 * 1000);
const ALLOW_ORIGIN = process.env.ARES_HTTP_ALLOW_ORIGIN; // exact match or '*'

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  lastSeen: number;
}

const sessions = new Map<string, SessionEntry>();

interface RateBucket {
  tokens: number;
  last: number;
}
const rateBuckets = new Map<string, RateBucket>();

function clientIp(req: IncomingMessage): string {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.length > 0) return cf;
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? "unknown";
}

/**
 * Sliding token bucket per IP. Refills at RATE_LIMIT_PER_MIN/60 tokens per
 * second; capacity equals the per-minute budget. Cheap and stateless in
 * practice — under load a busy IP simply waits.
 */
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const refillPerMs = RATE_LIMIT_PER_MIN / 60_000;
  const bucket = rateBuckets.get(ip) ?? { tokens: RATE_LIMIT_PER_MIN, last: now };
  bucket.tokens = Math.min(RATE_LIMIT_PER_MIN, bucket.tokens + (now - bucket.last) * refillPerMs);
  bucket.last = now;
  if (bucket.tokens < 1) {
    rateBuckets.set(ip, bucket);
    return false;
  }
  bucket.tokens -= 1;
  rateBuckets.set(ip, bucket);
  return true;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const limit = MAX_BODY_BYTES;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > limit) {
      throw new BodyTooLargeError(total);
    }
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new InvalidJsonError();
  }
}

class BodyTooLargeError extends Error {
  constructor(readonly size: number) {
    super(`Request body exceeds ${MAX_BODY_BYTES} bytes`);
  }
}
class InvalidJsonError extends Error {
  constructor() {
    super("Request body is not valid JSON");
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...(ALLOW_ORIGIN ? { "access-control-allow-origin": ALLOW_ORIGIN } : {}),
  });
  res.end(JSON.stringify(body));
}

function handleCors(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== "OPTIONS") return false;
  res.writeHead(204, {
    ...(ALLOW_ORIGIN ? { "access-control-allow-origin": ALLOW_ORIGIN } : {}),
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, mcp-session-id",
    "access-control-max-age": "86400",
  });
  res.end();
  return true;
}

function buildServer(client: AresClient): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  for (const tool of ALL_TOOLS) {
    tool.register(server, { client });
  }
  return server;
}

function purgeStaleSessions(): void {
  const now = Date.now();
  for (const [id, entry] of sessions) {
    if (now - entry.lastSeen > SESSION_TTL_MS) {
      entry.transport.close().catch(() => undefined);
      sessions.delete(id);
    }
  }
}
setInterval(purgeStaleSessions, 5 * 60 * 1000).unref();

async function main(): Promise<void> {
  const client = new AresClient({
    baseUrl: process.env.ARES_BASE_URL,
    ratePerSecond: parseEnvNumber(process.env.ARES_RATE_PER_SECOND, 5),
    timeoutMs: parseEnvNumber(process.env.ARES_TIMEOUT_MS, 15000),
    retries: parseEnvNumber(process.env.ARES_RETRIES, 3),
  });

  const httpServer = createServer(async (req, res) => {
    try {
      if (handleCors(req, res)) return;

      if (req.method === "GET" && req.url === "/healthz") {
        sendJson(res, 200, {
          ok: true,
          name: SERVER_NAME,
          version: SERVER_VERSION,
          sessions: sessions.size,
          uptimeSeconds: Math.floor(process.uptime()),
        });
        return;
      }

      if (req.url !== "/mcp") {
        sendJson(res, 404, { error: "NOT_FOUND", message: "Use POST /mcp" });
        return;
      }

      const ip = clientIp(req);
      if (!checkRateLimit(ip)) {
        res.setHeader("retry-after", "60");
        sendJson(res, 429, {
          error: "RATE_LIMITED",
          message: `Per-IP limit ${RATE_LIMIT_PER_MIN}/min exceeded`,
        });
        return;
      }

      const sessionIdHeader = req.headers["mcp-session-id"];
      const sessionId = typeof sessionIdHeader === "string" ? sessionIdHeader : undefined;
      let session = sessionId ? sessions.get(sessionId) : undefined;

      if (req.method === "POST") {
        let parsedBody: unknown;
        try {
          parsedBody = await readJsonBody(req);
        } catch (err) {
          if (err instanceof BodyTooLargeError) {
            sendJson(res, 413, { error: "BODY_TOO_LARGE", message: err.message });
            return;
          }
          sendJson(res, 400, { error: "INVALID_JSON", message: (err as Error).message });
          return;
        }

        if (!session && isInitializeRequest(parsedBody)) {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (newSessionId) => {
              sessions.set(newSessionId, { transport, lastSeen: Date.now() });
              log(`session ${newSessionId} initialized (ip=${ip})`);
            },
          });
          transport.onclose = () => {
            if (transport.sessionId) sessions.delete(transport.sessionId);
          };
          const mcpServer = buildServer(client);
          await mcpServer.connect(transport);
          await transport.handleRequest(req, res, parsedBody);
          if (transport.sessionId) {
            session = sessions.get(transport.sessionId);
          }
          return;
        }

        if (!session) {
          sendJson(res, 400, {
            error: "NO_SESSION",
            message:
              "Missing or unknown Mcp-Session-Id header. Send an `initialize` request first.",
          });
          return;
        }

        session.lastSeen = Date.now();
        await session.transport.handleRequest(req, res, parsedBody);
        return;
      }

      if (req.method === "GET" || req.method === "DELETE") {
        if (!session) {
          sendJson(res, 400, {
            error: "NO_SESSION",
            message: "Missing or unknown Mcp-Session-Id header.",
          });
          return;
        }
        session.lastSeen = Date.now();
        await session.transport.handleRequest(req, res);
        return;
      }

      sendJson(res, 405, { error: "METHOD_NOT_ALLOWED" });
    } catch (err) {
      log("request error:", err instanceof Error ? err.stack ?? err.message : String(err));
      if (!res.headersSent) {
        sendJson(res, 500, { error: "INTERNAL_ERROR" });
      } else {
        res.end();
      }
    }
  });

  httpServer.listen(PORT, () => {
    log(`ready on http://localhost:${PORT}/mcp  (healthz: /healthz)`);
    log(
      `config: rate ${RATE_LIMIT_PER_MIN}/min/ip, body ${MAX_BODY_BYTES}B, session TTL ${SESSION_TTL_MS}ms`,
    );
    log(`tools: ${ALL_TOOLS.length}`);
  });

  const shutdown = (signal: string) => {
    log(`${signal} received, closing ${sessions.size} sessions`);
    for (const entry of sessions.values()) entry.transport.close().catch(() => undefined);
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  log("fatal:", err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
