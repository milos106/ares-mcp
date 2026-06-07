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
  ico: z.string().min(1).describe("Czech IČO of the company."),
};

/**
 * ČSÚ classification of headcount bracket (kategoriePoctuPracovniku).
 * Codes are stable and documented in the public číselník.
 */
const HEADCOUNT_BRACKET: Record<string, string> = {
  "100": "Nezjištěno (unknown)",
  "110": "0 zaměstnanců",
  "120": "1–5 zaměstnanců",
  "130": "6–9 zaměstnanců",
  "140": "10–19 zaměstnanců",
  "210": "20–24 zaměstnanců",
  "220": "25–49 zaměstnanců",
  "310": "50–99 zaměstnanců",
  "320": "100–199 zaměstnanců",
  "330": "200–249 zaměstnanců",
  "340": "250–499 zaměstnanců",
  "410": "200–249 zaměstnanců (legacy code)",
  "420": "250–499 zaměstnanců (legacy code)",
  "510": "500–999 zaměstnanců",
  "520": "1 000–1 499 zaměstnanců",
  "530": "1 500–1 999 zaměstnanců",
  "610": "2 000–2 499 zaměstnanců",
  "620": "2 500–2 999 zaměstnanců",
  "630": "3 000–3 999 zaměstnanců",
  "640": "4 000–4 999 zaměstnanců",
  "710": "5 000–9 999 zaměstnanců",
  "720": "10 000+ zaměstnanců",
  "999": "Nezjištěno",
};

/** Coarse SME / large classification per EC Recommendation 2003/361. */
function smeClass(bracketCode: string | undefined | null): "micro" | "small" | "medium" | "large" | "unknown" {
  if (!bracketCode) return "unknown";
  // 110 = 0, 120 = 1-5, 130 = 6-9 → all under 10 = micro
  if (["110", "120", "130"].includes(bracketCode)) return "micro";
  // 140 = 10-19, 210 = 20-24, 220 = 25-49 → small (<50)
  if (["140", "210", "220"].includes(bracketCode)) return "small";
  // 310 = 50-99, 320 = 100-199, 330/410 = 200-249 → medium (<250)
  if (["310", "320", "330", "410"].includes(bracketCode)) return "medium";
  // 340 = 250-499, 420+ = large
  if (bracketCode === "340" || (/^[4-7]/.test(bracketCode) && bracketCode !== "410")) {
    return "large";
  }
  return "unknown";
}

/**
 * Institucionální sektor (SEC2010) — major categories per ESA 2010.
 * The full číselník has finer subdivisions; we map only the top-level
 * groupings for human-readability.
 */
const INSTITUTIONAL_SECTOR_GROUP: Record<string, string> = {
  "11001": "Veřejné nefinanční korporace (state-owned non-financial corp)",
  "11002": "Národní soukromé nefinanční korporace (private non-financial corp)",
  "11003": "Nefinanční korporace pod zahraniční kontrolou (foreign-controlled non-financial corp)",
  "12101": "Centrální banka",
  "12201": "Depozitní instituce kromě centrální banky",
  "13": "Vládní instituce",
  "13110": "Ústřední vládní instituce",
  "13130": "Místní vládní instituce",
  "13140": "Fondy sociálního zabezpečení",
  "14": "Domácnosti",
  "15": "Neziskové instituce sloužící domácnostem",
};

export const getResClassificationTool = defineTool({
  name: "ares_get_res_classification",
  description:
    "Get statistical classification of a Czech company from RES (Registr ekonomických subjektů): headcount bracket (decoded into SME / large), institutional sector (ESA 2010), primary CZ-NACE, financial office (FÚ), and NUTS region. Useful for B2B segmentation, reporting and policy-style analysis.",
  inputShape,
  handler: async ({ ico }, { client }) => {
    try {
      const { valid, normalized, reason } = validateIco(ico);
      if (!valid || !normalized) {
        throw new InvalidInputError(`Invalid IČO: ${ico}`, { reason });
      }
      const res = await client.getResRecord(normalized);
      const primary =
        res.zaznamy?.find((z) => z.primarniZaznam) ?? res.zaznamy?.[0] ?? null;
      if (!primary) {
        throw new InvalidInputError(
          `No RES record found for IČO ${normalized}. The entity may exist only in VR or RŽP.`,
        );
      }

      const bracketCode = primary.statistickeUdaje?.kategoriePoctuPracovniku ?? null;
      const sectorCode = primary.statistickeUdaje?.institucionalniSektor2010 ?? null;

      return jsonResult({
        ico: normalized,
        obchodniJmeno: primary.obchodniJmeno,
        pravniForma: primary.pravniForma,
        financniUrad: primary.financniUrad,
        okresNutsLau: primary.okresNutsLau ?? null,
        zakladniUzemniJednotka: primary.zakladniUzemniJednotka ?? null,
        sidlo: primary.sidlo?.textovaAdresa,
        czNacePrevazujici: primary.czNacePrevazujici2008 ?? primary.czNacePrevazujici ?? null,
        czNace: primary.czNace2008 ?? primary.czNace ?? [],
        kategoriePoctuPracovniku: {
          code: bracketCode,
          label: bracketCode ? (HEADCOUNT_BRACKET[bracketCode] ?? "Unknown code") : null,
          smeClass: smeClass(bracketCode),
        },
        institucionalniSektor2010: {
          code: sectorCode,
          label: sectorCode
            ? (INSTITUTIONAL_SECTOR_GROUP[sectorCode] ??
                INSTITUTIONAL_SECTOR_GROUP[sectorCode.slice(0, 2)] ??
                "Unknown code")
            : null,
        },
        datumVzniku: primary.datumVzniku,
        datumAktualizace: primary.datumAktualizace,
        _disclaimer: ARES_DISCLAIMER,
        _attribution: ARES_ATTRIBUTION,
        _source: "ARES /ekonomicke-subjekty-res/{ico}",
        _note:
          "Headcount bracket and institutional sector codes follow ČSÚ číselníky. Decoded labels are embedded for convenience but `code` is authoritative — verify against the published číselník if used for formal reporting.",
      });
    } catch (err) {
      return errorResult(err);
    }
  },
});
