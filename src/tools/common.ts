import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import type { AresClient } from "../ares/client.js";
import type { AresWebClient } from "../aresWeb/client.js";
import { toToolErrorPayload } from "../errors.js";
import type { ProvenanceService } from "../provenance/service.js";

export interface ToolContext {
  client: AresClient;
  /** Signs tool outputs into provenance envelopes (see provenance/service.ts). */
  provenance: ProvenanceService;
  /**
   * ares_web ("IČO vazby") data brain for the moat tools (holding/ownership +
   * Hlídač státu). Null when `ARES_WEB_URL` is unset — moat tools are then not
   * registered at all (see tools/index.ts), so the public self-host build never
   * exposes the accumulated index.
   */
  aresWeb: AresWebClient | null;
}

/** `base` = public ARES tools (commodity); `moat` = ares_web-backed (gated). */
export type ToolTier = "base" | "moat";

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface ToolDefinition<TShape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  /** Defaults to "base". Set "moat" on ares_web-backed tools. */
  tier?: ToolTier;
  inputShape: TShape;
  handler: (args: z.infer<z.ZodObject<TShape>>, ctx: ToolContext) => Promise<ToolResult>;
}

/**
 * Demand sensor: one structured line per tool call to stderr (→ journald under
 * systemd). Metadata only, NO PII (never the queried IČO/name/query). Lets us
 * measure whether agents use the moat tools without legal exposure. See
 * agentData/ares-mcp-sensor-metrics.md.
 */
function logUsage(ev: { tool: string; tier: ToolTier; ok: boolean; ms: number }): void {
  try {
    process.stderr.write(
      `[ares-mcp:usage] ${JSON.stringify({
        ts: new Date().toISOString(),
        ev: "tool_call",
        tool: ev.tool,
        tier: ev.tier,
        ok: ev.ok,
        ms: ev.ms,
      })}\n`,
    );
  } catch {
    // logging must never break a tool call
  }
}

/**
 * Type-erased tool descriptor used by the registration loop. Each tool file
 * declares its specific input shape (for type-safe handler authoring) and then
 * wraps it via `defineTool`, which closes over the shape so the public surface
 * is uniform regardless of the input zod schema.
 */
export interface RegisteredTool {
  name: string;
  description: string;
  tier: ToolTier;
  register(server: McpServer, ctx: ToolContext): void;
}

export function defineTool<TShape extends z.ZodRawShape>(
  def: ToolDefinition<TShape>,
): RegisteredTool {
  const tier: ToolTier = def.tier ?? "base";
  return {
    name: def.name,
    description: def.description,
    tier,
    register(server, ctx) {
      // The SDK's CallToolResult includes optional annotations / _meta and an
      // index signature that our slimmer ToolResult does not — structurally
      // compatible at runtime but rejected by TS overload resolution. Cast
      // through `as never` to bypass without losing the rest of the type
      // safety on caller side (each tool's handler is type-checked against
      // its own inputShape thanks to the closure here).
      // biome-ignore lint/suspicious/noExplicitAny: SDK overload variance
      (server.tool as any)(def.name, def.description, def.inputShape, async (args: unknown) => {
        const started = Date.now();
        let ok = true;
        try {
          const result = await def.handler(args as z.infer<z.ZodObject<TShape>>, ctx);
          ok = result.isError !== true;
          return result;
        } catch (err) {
          ok = false;
          throw err;
        } finally {
          logUsage({ tool: def.name, tier, ok, ms: Date.now() - started });
        }
      });
    },
  };
}

export function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function errorResult(err: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(toToolErrorPayload(err), null, 2) }],
    isError: true,
  };
}

export const ARES_DISCLAIMER =
  "Data from ARES is public but not authoritative for legal proceedings. For court use, request an official extract from the Public Register (justice.cz).";

export const VAT_DISCLAIMER =
  "ARES reflects VAT-payer status with up to 24h delay. The authoritative source is the MFČR VAT registry (adisspr.mfcr.cz).";

export const ARES_ATTRIBUTION = {
  source: "ARES — Administrativní registr ekonomických subjektů",
  publisher: "Ministerstvo financí ČR",
  license: "CC BY 4.0",
  url: "https://ares.gov.cz/",
  notAffiliated:
    "ares-mcp is an independent open-source project and is not affiliated with, endorsed by, or sponsored by MFČR or the ARES operator.",
};

/**
 * Hlídač státu (dotace/smlouvy) is CC BY 3.0 CZ — attribution with a FUNCTIONAL
 * link to hlidacstatu.cz is a license requirement. Moat tools that surface HS
 * data MUST include this in their output.
 */
export const HLIDAC_ATTRIBUTION = {
  source: "Hlídač státu",
  license: "CC BY 3.0 CZ",
  url: "https://www.hlidacstatu.cz",
  required_notice: "Data: Hlídač státu (hlidacstatu.cz), licence CC BY 3.0 CZ.",
};

/**
 * Disclaimer for results that contain personal data (beneficial owners,
 * statutory persons) — the recipient who stores/reuses them becomes a GDPR
 * controller with their own obligations. Erasure belongs at the source registry.
 */
export const PERSONAL_DATA_NOTICE =
  "Výstup obsahuje osobní údaje z veřejných rejstříků (čl. 6 GDPR). Kdo je ukládá nebo dále zpracovává, stává se správcem s vlastními povinnostmi. Žádosti o výmaz směřujte na zdrojový rejstřík.";

/** Disclaimer limiting liability for derived risk/relationship signals (§ 2950 OZ). */
export const DERIVED_DISCLAIMER =
  "Orientační signál odvozený z veřejných dat; nejde o doporučení k obchodnímu rozhodnutí. Ověřte v primárních zdrojích.";

/**
 * Returns true if the registry source status string indicates an active
 * registration in the given ARES sub-source (e.g. "AKTIVNI" for VAT, VR,
 * RES, RŽP). ARES uses string flags; we treat anything other than the
 * documented active value as "not active" for safety.
 */
export function isActiveRegistration(status: string | null | undefined): boolean {
  return status === "AKTIVNI";
}
