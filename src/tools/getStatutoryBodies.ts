import { z } from "zod";
import { validateIco } from "../ares/normalize.js";
import {
  currentObchodniJmeno,
  flattenMembers,
  memberDisplayName,
  pickPrimaryZaznam,
} from "../ares/vr.js";
import { InvalidInputError } from "../errors.js";
import type { Claim } from "../provenance/envelope.js";
import {
  ARES_ATTRIBUTION,
  ARES_DISCLAIMER,
  defineTool,
  errorResult,
  jsonResult,
} from "./common.js";

const inputShape = {
  ico: z.string().min(1).describe("Czech IČO of the company."),
  includeHistorical: z
    .boolean()
    .default(false)
    .describe(
      "If true, include members already removed (datumVymazu set). Default: only currently active.",
    ),
};

export const getStatutoryBodiesTool = defineTool({
  name: "ares_get_statutory_bodies",
  description:
    "List statutory bodies (jednatelé, představenstvo, dozorčí rada) of a Czech company from the Public Register (VR). By default returns currently-active members only. Useful for due diligence, KYC, and verifying who is authorised to sign contracts.",
  inputShape,
  handler: async ({ ico, includeHistorical }, { client, provenance }) => {
    try {
      const { valid, normalized, reason } = validateIco(ico);
      if (!valid || !normalized) {
        throw new InvalidInputError(`Invalid IČO: ${ico}`, { reason });
      }

      const fetchedAt = new Date().toISOString();
      const asOf = fetchedAt.slice(0, 10);

      const vr = await client.getVrRecord(normalized);
      const primary = pickPrimaryZaznam(vr);
      const obchodniJmeno = currentObchodniJmeno(primary);
      const members = flattenMembers(vr, { activeOnly: !includeHistorical });

      const clenoveOrganu = members.map((m) => ({
        organ: m.organName,
        funkce: m.funkce,
        typAngazma: m.typAngazma,
        datumZapisu: m.datumZapisu,
        datumVymazu: m.datumVymazu ?? null,
        jmeno: m.fyzickaOsoba ? memberDisplayName(m) : undefined,
        datumNarozeni: m.fyzickaOsoba?.datumNarozeni,
        adresa: m.fyzickaOsoba?.adresa?.textovaAdresa,
        pravnickaOsoba: m.pravnickaOsoba
          ? {
              ico: m.pravnickaOsoba.ico,
              obchodniJmeno: m.pravnickaOsoba.obchodniJmeno,
            }
          : undefined,
      }));

      const claims: Claim[] = [
        {
          predicate: "statutory_body",
          value: { obchodniJmeno, pocetClenu: members.length, includeHistorical, clenoveOrganu },
          source: {
            registry: "OR",
            endpoint: `ARES /ekonomicke-subjekty-vr/${normalized}`,
            fetched_at: fetchedAt,
            as_of: asOf,
          },
          confidence: "primary",
        },
      ];
      const envelope = provenance.seal({ subject: { ico: normalized }, claims, valid_as_of: asOf });

      return jsonResult({
        ico: normalized,
        obchodniJmeno,
        zakladniKapital: primary?.zakladniKapital,
        pocetClenu: members.length,
        clenoveOrganu,
        provenance: envelope,
        _disclaimer: ARES_DISCLAIMER,
        _attribution: ARES_ATTRIBUTION,
        _source: "ARES /ekonomicke-subjekty-vr/{ico}",
      });
    } catch (err) {
      return errorResult(err);
    }
  },
});
