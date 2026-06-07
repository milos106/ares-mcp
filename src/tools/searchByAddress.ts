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
  adresa: z
    .string()
    .min(3)
    .describe(
      "Free-form Czech address text — e.g. 'Vratimovská 689/117, Ostrava' or 'Pyšelská 2327/2, Praha'. The tool forwards it to ARES as a sidlo.textovaAdresa filter.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .describe("Max number of IČOs to return per page."),
  offset: z.number().int().min(0).default(0).describe("Pagination offset."),
};

export const searchByAddressTool = defineTool({
  name: "ares_search_by_address",
  description:
    "Find all Czech companies whose registered seat (sídlo) matches a given address. Useful for shell-company / virtual-office detection: an address with dozens or hundreds of entities at it is a strong signal. Returns IČOs, names, and the canonical address ARES holds for each.",
  inputShape,
  handler: async (args, { client }) => {
    try {
      // We use the ARES /ekonomicke-subjekty/vyhledat endpoint with a
      // sidlo.textovaAdresa filter. AdresaFiltr in the OpenAPI spec only
      // accepts numeric codes plus a free-text field; textovaAdresa is the
      // most flexible match for natural-language input. ARES tokenises the
      // input internally — partial matches work too (e.g. just the street
      // and city). Empty input would cause CHYBA_VSTUPU upstream, but the
      // zod schema already requires `.min(3)`.
      const result = await client.searchEconomicSubjects({
        // biome-ignore lint/suspicious/noExplicitAny: extending search params with sidlo field
        sidlo: { textovaAdresa: args.adresa } as any,
        pocet: args.limit,
        start: args.offset,
      });

      const total = result.pocetCelkem ?? 0;
      const entities = result.ekonomickeSubjekty ?? [];

      const warnings: string[] = [];
      if (total > 500) {
        warnings.push(
          `${total} entities found at this address — strong virtual-office / shell signal. Consider drilling into specific IČOs via ares_lookup_company.`,
        );
      } else if (total > 50) {
        warnings.push(
          `${total} entities found — possibly a shared business address (regus / virtual office / industrial park).`,
        );
      }

      return jsonResult({
        adresa: args.adresa,
        celkemNalezeno: total,
        vraceno: entities.length,
        offset: args.offset,
        vysledky: entities.map((e) => ({
          ico: e.ico,
          obchodniJmeno: e.obchodniJmeno,
          adresa: e.sidlo?.textovaAdresa,
          pravniForma: e.pravniForma,
          datumVzniku: e.datumVzniku,
          datumZaniku: e.datumZaniku ?? null,
        })),
        ...(warnings.length > 0 ? { warnings } : {}),
        _disclaimer: ARES_DISCLAIMER,
        _attribution: ARES_ATTRIBUTION,
        _source: "ARES /ekonomicke-subjekty/vyhledat (sidlo.textovaAdresa)",
        _note:
          "Match is performed by ARES against the canonical sídlo text. Address normalization is best-effort — try ares_standardize_address first to convert free-form input into RÚIAN-canonical form for higher precision.",
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes("CHYBA_VSTUPU")) {
        return errorResult(
          new InvalidInputError(
            "Address is too short or unrecognised by ARES. Try ares_standardize_address first to obtain a canonical form.",
          ),
        );
      }
      return errorResult(err);
    }
  },
});
