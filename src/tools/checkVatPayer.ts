import { z } from "zod";
import { normalizeDic, validateIco } from "../ares/normalize.js";
import { InvalidInputError } from "../errors.js";
import {
  ARES_ATTRIBUTION,
  VAT_DISCLAIMER,
  defineTool,
  errorResult,
  isActiveRegistration,
  jsonResult,
} from "./common.js";

const inputShape = {
  ico: z.string().min(1).describe("Czech IČO of the company."),
  expectedDic: z
    .string()
    .optional()
    .describe("Optional DIČ to cross-check against ARES (e.g. 'CZ27074358'). Tool will report a mismatch."),
};

export const checkVatPayerTool = defineTool({
  name: "ares_check_vat_payer",
  description:
    "Check whether a Czech entity is registered as a VAT payer (plátce DPH) based on ARES. Returns the IČ DPH (= DIČ) if active. NOTE: ARES reflects VAT-payer status with up to 24h delay; the authoritative source is MFČR (adisspr.mfcr.cz).",
  inputShape,
  handler: async ({ ico, expectedDic }, { client }) => {
    try {
      const { valid, normalized, reason } = validateIco(ico);
      if (!valid || !normalized) {
        throw new InvalidInputError(`Invalid IČO: ${ico}`, { reason });
      }

      const subject = await client.getEconomicSubject(normalized);
      const stavDph = subject.seznamRegistraci?.stavZdrojeDph;
      const platceDph = isActiveRegistration(stavDph);
      const icDph = platceDph ? subject.dic ?? null : null;

      let dicMismatch: string | undefined;
      if (expectedDic) {
        const normExpected = normalizeDic(expectedDic);
        if (!normExpected) {
          dicMismatch = `Provided expectedDic '${expectedDic}' is not a valid Czech DIČ format.`;
        } else if (icDph && normExpected !== icDph) {
          dicMismatch = `Provided DIČ '${normExpected}' does not match ARES IČ DPH '${icDph}'.`;
        } else if (!icDph) {
          dicMismatch = `Provided DIČ '${normExpected}' but ARES reports this entity is not an active VAT payer.`;
        }
      }

      return jsonResult({
        ico: normalized,
        platceDph,
        icDph,
        dic: subject.dic ?? null,
        stavZdrojeDph: stavDph ?? null,
        ...(dicMismatch ? { dicMismatch } : {}),
        _overeno: new Date().toISOString(),
        _disclaimer: VAT_DISCLAIMER,
        _attribution: ARES_ATTRIBUTION,
        _source: "ARES /ekonomicke-subjekty/{ico}",
      });
    } catch (err) {
      return errorResult(err);
    }
  },
});
