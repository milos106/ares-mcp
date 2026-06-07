import { z } from "zod";
import { ARES_ATTRIBUTION, defineTool, errorResult, jsonResult } from "./common.js";

const inputShape = {
  adresa: z
    .string()
    .min(2)
    .describe("Free-form address text to standardize against RÚIAN (e.g. 'Za Prachárnou 4962/45, Jihlava')."),
  limit: z.number().int().min(1).max(20).default(5).describe("Max number of suggestions."),
};

export const standardizeAddressTool = defineTool({
  name: "ares_standardize_address",
  description:
    "Standardize a free-form Czech address against the RÚIAN register. Returns canonical address text, RÚIAN address-point code, and confidence score for up to N suggestions.",
  inputShape,
  handler: async ({ adresa, limit }, { client }) => {
    try {
      const result = await client.searchAddresses({ textovaAdresa: adresa, pocet: limit });
      const suggestions = (result.adresy ?? []).map((a) => ({
        kanonickaAdresa: a.textovaAdresa,
        ruianAdresniMisto: a.kodAdresnihoMista,
        skore: a.skore,
        komponenty: a.adresa,
      }));
      return jsonResult({
        vstup: adresa,
        pocetCelkem: result.pocetCelkem ?? suggestions.length,
        navrhy: suggestions,
        _attribution: ARES_ATTRIBUTION,
        _source: "ARES /standardizovane-adresy/vyhledat (RÚIAN)",
      });
    } catch (err) {
      return errorResult(err);
    }
  },
});
