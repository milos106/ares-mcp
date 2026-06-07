import { z } from "zod";
import { ARES_ATTRIBUTION, defineTool, errorResult, jsonResult } from "./common.js";

const inputShape = {
  query: z
    .string()
    .min(1)
    .describe("CZ-NACE code (e.g. '620') or name fragment (e.g. 'informačn'). Used to look up classification entries."),
  limit: z.number().int().min(1).max(50).default(20).describe("Max number of results."),
};

const CZ_NACE_CISELNIK = "80008"; // ČSÚ číselník code for CZ-NACE

export const lookupCzNaceTool = defineTool({
  name: "ares_lookup_cz_nace",
  description:
    "Look up CZ-NACE (Czech industry classification) entries by code or partial name. Useful when filtering ares_search_companies by industry.",
  inputShape,
  handler: async ({ query, limit }, { client }) => {
    try {
      const looksLikeCode = /^\d+$/.test(query);
      const result = await client.searchCiselniky({
        kodCiselniku: CZ_NACE_CISELNIK,
        ...(looksLikeCode ? { kodPolozky: query } : { nazev: query }),
        pocet: limit,
      });

      const items =
        result.polozky ??
        result.ciselniky?.flatMap((c) => c.polozky) ??
        [];

      return jsonResult({
        query,
        pocetCelkem: result.pocetCelkem ?? items.length,
        vysledky: items.map((p) => ({
          kod: p.kod,
          nazev: p.nazev,
          uroven: p.uroven,
        })),
        _attribution: ARES_ATTRIBUTION,
        _source: "ARES /ciselniky-nazevniky/vyhledat (CZ-NACE)",
      });
    } catch (err) {
      return errorResult(err);
    }
  },
});
