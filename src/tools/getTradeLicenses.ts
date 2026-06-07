import { z } from "zod";
import { validateIco } from "../ares/normalize.js";
import { InvalidInputError } from "../errors.js";
import {
  ARES_ATTRIBUTION,
  ARES_DISCLAIMER,
  defineTool,
  errorResult,
  jsonResult,
} from "./common.js";

const inputShape = {
  ico: z.string().min(1).describe("Czech IČO of the entity."),
};

function normalizeObory(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === "string" ? v : typeof v === "object" && v && "nazev" in v ? (v as { nazev?: string }).nazev : undefined))
      .filter((v): v is string => typeof v === "string");
  }
  return [];
}

export const getTradeLicensesTool = defineTool({
  name: "ares_get_trade_licenses",
  description:
    "List trade licenses (živnostenská oprávnění) of a Czech entity from the Trade Register (RŽP). Returns each license's subject, type (volná / vázaná / koncesovaná / řemeslná), validity period, and fields of activity.",
  inputShape,
  handler: async ({ ico }, { client }) => {
    try {
      const { valid, normalized, reason } = validateIco(ico);
      if (!valid || !normalized) {
        throw new InvalidInputError(`Invalid IČO: ${ico}`, { reason });
      }
      const rzp = await client.getRzpRecord(normalized);

      const opravneni = (rzp.zivnostenskeOpravneni ?? []).map((z) => ({
        predmetPodnikani: z.predmetPodnikani,
        druh: z.druh,
        datumVzniku: z.datumVzniku,
        datumZaniku: z.datumZaniku,
        stav: z.stav,
        oboryCinnosti: normalizeObory(z.oboryCinnosti),
      }));

      const active = opravneni.filter((o) => !o.datumZaniku);

      return jsonResult({
        ico: normalized,
        pocetCelkem: opravneni.length,
        pocetAktivnich: active.length,
        zivnostenskaOpravneni: opravneni,
        _disclaimer: ARES_DISCLAIMER,
        _attribution: ARES_ATTRIBUTION,
        _source: "ARES /ekonomicke-subjekty-rzp/{ico}",
      });
    } catch (err) {
      return errorResult(err);
    }
  },
});
