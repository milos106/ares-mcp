import pRetry, { AbortError } from "p-retry";
import { fetch as undiciFetch } from "undici";
import {
  type AresError,
  InvalidInputError,
  NetworkError,
  NotFoundError,
  RateLimitedError,
  UpstreamError,
  mapHttpStatusToAresError,
} from "../errors.js";

type FetchInit = Parameters<typeof undiciFetch>[1];
type FetchResponse = Awaited<ReturnType<typeof undiciFetch>>;

/**
 * Thin HTTP client for the `ares_web` ("IČO vazby" / icovazby) data brain.
 *
 * The relationship/ownership index, holding-discovery BFS and Hlídač státu
 * (dotace/smlouvy/UBO) enrichment live in ares_web — they are the moat and are
 * NOT reimplemented here. These "moat" MCP tools simply proxy to that service
 * over HTTP (clean network boundary: MIT ares_mcp ↔ AGPL ares_web).
 *
 * Configured via `ARES_WEB_URL`. When unset, the client is not constructed and
 * the moat tools are not registered at all (see tools/index.ts) — so the public
 * self-host build never exposes the accumulated index.
 */
export interface AresWebClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  retries?: number;
  userAgent?: string;
}

export class AresWebClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly userAgent: string;

  constructor(opts: AresWebClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 20000;
    this.retries = opts.retries ?? 2;
    this.userAgent = opts.userAgent ?? "ares-mcp/0.1.0 (+https://github.com/milos106/ares-mcp)";
  }

  /** Holding/ownership tree: subsidiaries via shared statutory bodies AND shareholders. */
  discoverHolding(ico: string, depth: number, maxIcos: number): Promise<unknown> {
    return this.post("/api/holding/discover", { ico, depth, maxIcos });
  }

  /** Hlídač státu — subsidies (dotace) received by the company. */
  getDotace(ico: string): Promise<unknown> {
    return this.get(`/api/dotace/${encodeURIComponent(ico)}`);
  }

  /** Hlídač státu — public contracts (veřejné smlouvy) of the company. */
  getSmlouvy(ico: string): Promise<unknown> {
    return this.get(`/api/smlouvy/${encodeURIComponent(ico)}`);
  }

  /** Beneficial owners (skuteční majitelé) — active + historical. */
  getUbo(ico: string): Promise<unknown> {
    return this.get(`/api/ubo/${encodeURIComponent(ico)}`);
  }

  /** Reconciled "who really owns it" verdict (shareholders × UBO × holding). */
  getOwnershipVerdict(ico: string): Promise<unknown> {
    return this.get(`/api/ownership-verdict/${encodeURIComponent(ico)}`);
  }

  /** Hlídač státu funding (dotace + zakázky) aggregated across the ownership group. */
  getGroupFunding(ico: string): Promise<unknown> {
    return this.get(`/api/group-funding/${encodeURIComponent(ico)}`);
  }

  private get<T = unknown>(path: string): Promise<T> {
    return this.execute<T>(this.buildUrl(path), { method: "GET" });
  }

  private post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.execute<T>(this.buildUrl(path), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  }

  private buildUrl(path: string): string {
    return `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }

  private execute<T>(url: string, init: FetchInit): Promise<T> {
    return pRetry(async () => this.requestOnce<T>(url, init), {
      retries: this.retries,
      minTimeout: 500,
      maxTimeout: 8000,
      factor: 2,
    });
  }

  private async requestOnce<T>(url: string, init: FetchInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: FetchResponse;
    try {
      response = await undiciFetch(url, {
        ...init,
        headers: {
          accept: "application/json",
          "user-agent": this.userAgent,
          ...(init?.headers as Record<string, string> | undefined),
        },
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
        throw abort(new NetworkError("Request to ares_web (icovazby) timed out."));
      }
      throw abort(
        new NetworkError(
          `Network error while contacting ares_web: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) {
      return (await response.json()) as T;
    }

    const body = await safeReadBody(response);
    const message = `ares_web returned HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`;

    if (response.status === 404) throw abort(new NotFoundError(message));
    if (response.status === 400 || response.status === 422) {
      throw abort(new InvalidInputError(message));
    }
    if (response.status === 429) throw new RateLimitedError(message);
    if (response.status >= 500) throw new UpstreamError(message, response.status);
    throw abort(mapHttpStatusToAresError(response.status, message));
  }
}

/**
 * Build the client from `ARES_WEB_URL`. Returns null when unset — the signal
 * that moat tools must NOT be registered (gating).
 */
export function createAresWebClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AresWebClient | null {
  const baseUrl = env.ARES_WEB_URL;
  if (!baseUrl || baseUrl.trim().length === 0) return null;
  return new AresWebClient({
    baseUrl: baseUrl.trim(),
    timeoutMs: numEnv(env.ARES_WEB_TIMEOUT_MS, 20000),
    retries: numEnv(env.ARES_WEB_RETRIES, 2),
  });
}

function numEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function abort(err: AresError): AbortError {
  return new AbortError(err);
}

async function safeReadBody(response: FetchResponse): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
