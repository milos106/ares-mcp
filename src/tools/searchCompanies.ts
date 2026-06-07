import { z } from "zod";
import { InvalidInputError } from "../errors.js";
import {
  ARES_ATTRIBUTION,
  ARES_DISCLAIMER,
  defineTool,
  errorResult,
  jsonResult,
} from "./common.js";

const inputShape = {
  obchodniJmeno: z
    .string()
    .min(1)
    .optional()
    .describe("Full or partial company name (full-text search)."),
  sidloPsc: z.string().regex(/^\d{3}\s?\d{2}$/).optional().describe("Postal code of the registered seat, e.g. '11000' or '110 00'."),
  sidloKodObce: z
    .number()
    .int()
    .optional()
    .describe("Numeric municipality code (RÚIAN). Use ares_lookup_czNace or your own lookup if unknown."),
  pravniForma: z
    .array(z.string())
    .optional()
    .describe("List of legal-form codes (e.g. ['112'] for s.r.o., ['121'] for a.s.)."),
  czNace: z
    .array(z.string())
    .optional()
    .describe("List of CZ-NACE classification codes (e.g. ['620'] for IT activities)."),
  limit: z.number().int().min(1).max(100).default(25).describe("Page size, max 100."),
  offset: z.number().int().min(0).default(0).describe("Pagination offset."),
};

export const searchCompaniesTool = defineTool({
  name: "ares_search_companies",
  description:
    "Search Czech companies by structured filters (name, postal code, municipality, legal form, CZ-NACE). At least one filter is required to avoid full-registry scans. Returns paginated results with totals.",
  inputShape,
  handler: async (args, { client }) => {
    try {
      const hasFilter =
        args.obchodniJmeno ||
        args.sidloPsc ||
        args.sidloKodObce !== undefined ||
        (args.pravniForma?.length ?? 0) > 0 ||
        (args.czNace?.length ?? 0) > 0;

      if (!hasFilter) {
        throw new InvalidInputError(
          "At least one filter parameter is required (obchodniJmeno, sidloPsc, sidloKodObce, pravniForma, or czNace).",
        );
      }

      const result = await client.searchEconomicSubjects({
        obchodniJmeno: args.obchodniJmeno,
        sidloPsc: args.sidloPsc?.replace(/\s/g, ""),
        sidloKodObce: args.sidloKodObce,
        pravniForma: args.pravniForma,
        czNace: args.czNace,
        pocet: args.limit,
        start: args.offset,
      });

      const total = result.pocetCelkem ?? 0;
      const warnings: string[] = [];
      if (total > 1000) {
        warnings.push(
          `Found ${total} matches — consider narrowing the filter (e.g. add postal code or CZ-NACE).`,
        );
      }

      return jsonResult({
        celkemNalezeno: total,
        vraceno: result.ekonomickeSubjekty?.length ?? 0,
        offset: args.offset,
        vysledky:
          result.ekonomickeSubjekty?.map((s) => ({
            ico: s.ico,
            obchodniJmeno: s.obchodniJmeno,
            sidlo: s.sidlo?.textovaAdresa,
            pravniForma: s.pravniForma,
            datumVzniku: s.datumVzniku,
            datumZaniku: s.datumZaniku,
          })) ?? [],
        ...(warnings.length > 0 ? { warnings } : {}),
        _disclaimer: ARES_DISCLAIMER,
        _attribution: ARES_ATTRIBUTION,
        _source: "ARES /ekonomicke-subjekty/vyhledat",
      });
    } catch (err) {
      return errorResult(err);
    }
  },
});
