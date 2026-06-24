import { z } from "zod";
import { validateIco } from "../ares/normalize.js";
import { InvalidInputError } from "../errors.js";
import type { Claim } from "../provenance/envelope.js";
import { PERSONAL_DATA_NOTICE, defineTool, errorResult, jsonResult } from "./common.js";

const inputShape = {
  ico: z
    .string()
    .min(1)
    .describe("Czech IČO to look up beneficial owners (skuteční majitelé) for."),
};

export const beneficialOwnerTool = defineTool({
  name: "ares_beneficial_owner",
  tier: "moat",
  description:
    "Beneficial owners (skuteční majitelé) of a Czech company from the Register of Beneficial Owners (ESM) — both active and historical, with their position/share basis. The real ownership behind the legal entity, beyond the statutory body. Contains personal data — see the GDPR notice in the output.",
  inputShape,
  handler: async ({ ico }, { aresWeb, provenance }) => {
    if (!aresWeb) {
      return errorResult(
        new Error("Relationship tools are not enabled on this server (ARES_WEB_URL unset)."),
      );
    }
    try {
      const { valid, normalized, reason } = validateIco(ico);
      if (!valid || !normalized) throw new InvalidInputError(`Invalid IČO '${ico}'`, { reason });

      const ubo = await aresWeb.getUbo(normalized);
      const fetchedAt = new Date().toISOString();
      const asOf = fetchedAt.slice(0, 10);

      const claims: Claim[] = [
        {
          predicate: "beneficial_owners",
          value: ubo,
          source: {
            registry: "Evidence skutečných majitelů (ESM, MSp ČR) via Hlídač státu",
            endpoint: "ares_web /api/ubo/{ico}",
            fetched_at: fetchedAt,
            as_of: asOf,
          },
          confidence: "primary",
        },
      ];
      const envelope = provenance.seal({ subject: { ico: normalized }, claims, valid_as_of: asOf });

      return jsonResult({
        ico: normalized,
        ubo,
        provenance: envelope,
        // Beneficial-owner data is personal data — flag controller obligations.
        _notice: PERSONAL_DATA_NOTICE,
      });
    } catch (err) {
      return errorResult(err);
    }
  },
});
