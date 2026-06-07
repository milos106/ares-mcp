import { z } from "zod";
import { validateIco } from "../ares/normalize.js";
import { InvalidInputError } from "../errors.js";
import {
  ARES_ATTRIBUTION,
  ARES_DISCLAIMER,
  defineTool,
  errorResult,
  isActiveRegistration,
  jsonResult,
} from "./common.js";

const inputShape = {
  ico: z.string().min(1).describe("Czech IČO. Will be normalized and Mod-11 checked before lookup."),
};

export const lookupCompanyTool = defineTool({
  name: "ares_lookup_company",
  description:
    "Look up a Czech company by IČO. Returns aggregated data from ARES (basic identification, legal form, registered address, VAT status, CZ-NACE classification, registrations in VR/RES/RŽP).",
  inputShape,
  handler: async ({ ico }, { client }) => {
    try {
      const { valid, normalized, reason } = validateIco(ico);
      if (!valid || !normalized) {
        throw new InvalidInputError(`Invalid IČO: ${ico}`, { reason });
      }
      const subject = await client.getEconomicSubject(normalized);
      const dphActive = isActiveRegistration(subject.seznamRegistraci?.stavZdrojeDph);
      const czNace =
        (subject as { czNace?: string[]; czNace2008?: string[] }).czNace2008 ??
        subject.czNace ??
        [];

      return jsonResult({
        ico: normalized,
        obchodniJmeno: subject.obchodniJmeno,
        pravniForma: subject.pravniForma,
        datumVzniku: subject.datumVzniku,
        datumZaniku: subject.datumZaniku,
        dic: subject.dic ?? null,
        platceDph: dphActive,
        icDph: dphActive ? subject.dic ?? null : null,
        sidlo: subject.sidlo,
        seznamRegistraci: subject.seznamRegistraci,
        czNace,
        datumAktualizace: subject.datumAktualizace,
        _disclaimer: ARES_DISCLAIMER,
        _attribution: ARES_ATTRIBUTION,
        _source: "ARES /ekonomicke-subjekty/{ico}",
      });
    } catch (err) {
      return errorResult(err);
    }
  },
});
