import { z } from "zod";
import { validateIco } from "../ares/normalize.js";
import { InvalidInputError } from "../errors.js";
import type { Claim } from "../provenance/envelope.js";
import {
  ARES_ATTRIBUTION,
  DERIVED_DISCLAIMER,
  defineTool,
  errorResult,
  jsonResult,
} from "./common.js";

const inputShape = {
  ico: z.string().min(1).describe("Czech IČO whose holding/ownership tree to reveal."),
  depth: z
    .number()
    .int()
    .min(1)
    .max(3)
    .default(2)
    .describe("How many ownership levels to walk (1–3)."),
  maxIcos: z
    .number()
    .int()
    .min(5)
    .max(200)
    .default(50)
    .describe("Max number of companies to return (min 5)."),
};

export const discoverHoldingTool = defineTool({
  name: "ares_discover_holding",
  tier: "moat",
  description:
    "Reveal a Czech company's holding/ownership tree: subsidiaries discovered via shared statutory bodies AND shareholders (akcionáři/společníci) — beyond a plain statutory chain. Backed by the IČO-vazby relationship index; each discovered company carries ownership signals (e.g. parent-is-shareholder, shared-statutory).",
  inputShape,
  handler: async ({ ico, depth, maxIcos }, { aresWeb, provenance }) => {
    if (!aresWeb) {
      return errorResult(
        new Error("Relationship tools are not enabled on this server (ARES_WEB_URL unset)."),
      );
    }
    try {
      const { valid, normalized, reason } = validateIco(ico);
      if (!valid || !normalized) throw new InvalidInputError(`Invalid IČO '${ico}'`, { reason });

      const data = await aresWeb.discoverHolding(normalized, depth, maxIcos);
      const fetchedAt = new Date().toISOString();
      const asOf = fetchedAt.slice(0, 10);

      const claims: Claim[] = [
        {
          predicate: "holding_ownership_tree",
          value: data,
          source: {
            registry: "IČO-vazby (ARES VR + OR akcionáři/společníci)",
            endpoint: "ares_web /api/holding/discover",
            fetched_at: fetchedAt,
            as_of: asOf,
          },
          confidence: "derived",
        },
      ];
      const envelope = provenance.seal({ subject: { ico: normalized }, claims, valid_as_of: asOf });

      return jsonResult({
        ico: normalized,
        holding: data,
        provenance: envelope,
        _disclaimer: DERIVED_DISCLAIMER,
        _attribution: ARES_ATTRIBUTION,
      });
    } catch (err) {
      return errorResult(err);
    }
  },
});
