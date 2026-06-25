import { z } from "zod";
import { validateIco } from "../ares/normalize.js";
import { InvalidInputError } from "../errors.js";
import type { Claim } from "../provenance/envelope.js";
import {
  DERIVED_DISCLAIMER,
  HLIDAC_ATTRIBUTION,
  defineTool,
  errorResult,
  jsonResult,
} from "./common.js";

interface GroupFunding {
  ico?: string;
  skupina?: unknown;
  poFirmach?: unknown;
  [k: string]: unknown;
}

const inputShape = {
  ico: z.string().min(1).describe("Czech IČO whose whole ownership group to total up."),
};

export const groupFundingTool = defineTool({
  name: "ares_group_funding",
  tier: "moat",
  description:
    "Total public money (state/EU subsidies + public contracts, from Hlídač státu) across a Czech company's ENTIRE ownership group (the company plus its holding), not just the single company. Returns group totals plus a per-company breakdown. Lower-bound estimate; the group is capped at 25 companies and the call may be slower (it walks the holding). Descriptive signal of group exposure, not proof of control.",
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

      const g = (await aresWeb.getGroupFunding(normalized)) as GroupFunding;
      const fetchedAt = new Date().toISOString();
      const asOf = fetchedAt.slice(0, 10);

      // Aggregated across the holding group (Hlídač per company) → "derived".
      const claims: Claim[] = [
        {
          predicate: "group_public_funding",
          value: { skupina: g.skupina, poFirmach: g.poFirmach },
          source: {
            registry: "Hlídač státu (agregováno přes vlastnickou skupinu)",
            endpoint: "ares_web /api/group-funding/{ico}",
            fetched_at: fetchedAt,
            as_of: asOf,
          },
          confidence: "derived",
        },
      ];
      const envelope = provenance.seal({ subject: { ico: normalized }, claims, valid_as_of: asOf });

      return jsonResult({
        ...g,
        provenance: envelope,
        _disclaimer: DERIVED_DISCLAIMER,
        // CC BY 3.0 CZ — funkční odkaz na hlidacstatu.cz je licenční podmínka.
        _attribution: HLIDAC_ATTRIBUTION,
      });
    } catch (err) {
      return errorResult(err);
    }
  },
});
