import { z } from "zod";
import { validateIco } from "../ares/normalize.js";
import { defineTool, errorResult, jsonResult } from "./common.js";

const inputShape = {
  ico: z
    .string()
    .min(1)
    .describe(
      "Czech IČO (Identifikační číslo osoby). Accepts 1–8 digits, optional 'CZ' prefix, whitespace, dashes or dots. Examples: '27074358', 'CZ27074358', '270 743 58'.",
    ),
};

export const validateIcoTool = defineTool({
  name: "ares_validate_ico",
  description:
    "Validate a Czech IČO via the ČSÚ Mod-11 checksum. Pure function — does not call ARES. Returns the normalized 8-digit IČO and whether the checksum is valid.",
  inputShape,
  handler: async ({ ico }) => {
    try {
      const result = validateIco(ico);
      return jsonResult({
        input: ico,
        normalized: result.normalized,
        valid: result.valid,
        ...(result.reason ? { reason: result.reason } : {}),
      });
    } catch (err) {
      return errorResult(err);
    }
  },
});
