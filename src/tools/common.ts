import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import type { AresClient } from "../ares/client.js";
import { toToolErrorPayload } from "../errors.js";

export interface ToolContext {
  client: AresClient;
}

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface ToolDefinition<TShape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  inputShape: TShape;
  handler: (
    args: z.infer<z.ZodObject<TShape>>,
    ctx: ToolContext,
  ) => Promise<ToolResult>;
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
  register(server: McpServer, ctx: ToolContext): void;
}

export function defineTool<TShape extends z.ZodRawShape>(
  def: ToolDefinition<TShape>,
): RegisteredTool {
  return {
    name: def.name,
    description: def.description,
    register(server, ctx) {
      // The SDK's CallToolResult includes optional annotations / _meta and an
      // index signature that our slimmer ToolResult does not — structurally
      // compatible at runtime but rejected by TS overload resolution. Cast
      // through `as never` to bypass without losing the rest of the type
      // safety on caller side (each tool's handler is type-checked against
      // its own inputShape thanks to the closure here).
      // biome-ignore lint/suspicious/noExplicitAny: SDK overload variance
      (server.tool as any)(def.name, def.description, def.inputShape, async (args: unknown) =>
        def.handler(args as z.infer<z.ZodObject<TShape>>, ctx),
      );
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
 * Returns true if the registry source status string indicates an active
 * registration in the given ARES sub-source (e.g. "AKTIVNI" for VAT, VR,
 * RES, RŽP). ARES uses string flags; we treat anything other than the
 * documented active value as "not active" for safety.
 */
export function isActiveRegistration(status: string | null | undefined): boolean {
  return status === "AKTIVNI";
}
