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

const inputShape = {
  ico: z.string().min(1).describe("Czech IČO to look up public funding for."),
};

export const publicFundingTool = defineTool({
  name: "ares_public_funding",
  tier: "moat",
  description:
    "Public money a Czech company has received or transacted: state/EU subsidies (dotace) and public contracts (veřejné zakázky/smlouvy), sourced from Hlídač státu. Returns totals, top providers/counterparties, year ranges. Useful for due diligence on state exposure and conflict-of-interest signals.",
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

      const [dotace, smlouvy] = await Promise.all([
        aresWeb.getDotace(normalized),
        aresWeb.getSmlouvy(normalized),
      ]);
      const fetchedAt = new Date().toISOString();
      const asOf = fetchedAt.slice(0, 10);
      const hsSource = (endpoint: string) => ({
        registry: "Hlídač státu",
        endpoint,
        fetched_at: fetchedAt,
        as_of: asOf,
      });

      const claims: Claim[] = [
        {
          predicate: "subsidies",
          value: dotace,
          source: hsSource("ares_web /api/dotace/{ico}"),
          confidence: "primary",
        },
        {
          predicate: "public_contracts",
          value: smlouvy,
          source: hsSource("ares_web /api/smlouvy/{ico}"),
          confidence: "primary",
        },
      ];
      const envelope = provenance.seal({ subject: { ico: normalized }, claims, valid_as_of: asOf });

      return jsonResult({
        ico: normalized,
        dotace,
        smlouvy,
        provenance: envelope,
        _disclaimer: DERIVED_DISCLAIMER,
        // CC BY 3.0 CZ requires a functional link back to hlidacstatu.cz.
        _attribution: HLIDAC_ATTRIBUTION,
      });
    } catch (err) {
      return errorResult(err);
    }
  },
});
