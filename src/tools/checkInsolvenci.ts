import { z } from "zod";
import { validateIco } from "../ares/normalize.js";
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
  ico: z.string().min(1).describe("Czech IČO of the entity to check."),
};

/**
 * ARES exposes the registration status across sub-registries via
 * `seznamRegistraci`. For insolvency-style red flags we look at two fields:
 *   - `stavZdrojeIr`  — Insolvenční rejstřík (active insolvency proceedings)
 *   - `stavZdrojeCeu` — Centrální evidence úpadců (central register of
 *     bankrupted persons)
 * Both use the same vocabulary: AKTIVNI / NEEXISTUJICI / ZANIKLY / null.
 *
 * AKTIVNI in either of these is a strong red flag — the entity is in
 * insolvency proceedings or has been declared bankrupt right now. ZANIKLY
 * means "was, no longer" which is historically interesting but not
 * disqualifying. NEEXISTUJICI / null = clean.
 *
 * Real-world fixture: Liberty Ostrava a.s. (IČO 45193258) has
 * `stavZdrojeIr: "AKTIVNI"` at the time of writing.
 */
function classifyRegistrationStatus(value: string | null | undefined): "ACTIVE" | "ENDED" | "NONE" {
  if (value === "AKTIVNI") return "ACTIVE";
  if (value === "ZANIKLY") return "ENDED";
  return "NONE";
}

export const checkInsolvenciTool = defineTool({
  name: "ares_check_insolvenci",
  description:
    "Fast red-flag check: is a Czech entity currently in insolvency proceedings or marked as bankrupt? Reads the ARES `seznamRegistraci` for the Insolvency Register (IR) and Central Bankruptcy Register (CEÚ). Returns a clear true/false on `isInsolvent` plus the underlying state codes. Useful as a pre-contract sanity check.",
  inputShape,
  handler: async ({ ico }, { client, provenance }) => {
    try {
      const { valid, normalized, reason } = validateIco(ico);
      if (!valid || !normalized) {
        throw new InvalidInputError(`Invalid IČO: ${ico}`, { reason });
      }

      const fetchedAt = new Date().toISOString();
      const asOf = fetchedAt.slice(0, 10);

      const subject = await client.getEconomicSubject(normalized);
      const reg = subject.seznamRegistraci ?? {};
      const irRaw = reg.stavZdrojeIr ?? null;
      const ceuRaw = reg.stavZdrojeCeu ?? null;
      const ir = classifyRegistrationStatus(irRaw);
      const ceu = classifyRegistrationStatus(ceuRaw);
      const isInsolvent = ir === "ACTIVE" || ceu === "ACTIVE";
      const hadHistory = ir === "ENDED" || ceu === "ENDED";

      const notes: string[] = [];
      if (ir === "ACTIVE") notes.push("Active insolvency proceedings (Insolvenční rejstřík).");
      if (ceu === "ACTIVE") notes.push("Listed in the Central Bankruptcy Register (CEÚ).");
      if (ir === "ENDED")
        notes.push("Past insolvency proceedings — closed, but indicates historical distress.");
      if (ceu === "ENDED") notes.push("Past CEÚ entry — historical bankruptcy, no longer current.");
      if (subject.datumZaniku) notes.push(`Entity dissolved on ${subject.datumZaniku}.`);

      const claims: Claim[] = [
        {
          predicate: "insolvency",
          value: {
            isInsolvent,
            hadHistory,
            insolvencniRejstrik: ir,
            centralniEvidenceUpadcu: ceu,
            datumZaniku: subject.datumZaniku ?? null,
          },
          source: {
            registry: "ISIR",
            endpoint: `ARES /ekonomicke-subjekty/${normalized} → seznamRegistraci`,
            fetched_at: fetchedAt,
            as_of: asOf,
          },
          confidence: "primary",
        },
      ];
      const envelope = provenance.seal({ subject: { ico: normalized }, claims, valid_as_of: asOf });

      return jsonResult({
        ico: normalized,
        obchodniJmeno: subject.obchodniJmeno,
        isInsolvent,
        hadInsolvencyHistory: hadHistory,
        insolvencniRejstrik: { state: ir, raw: irRaw },
        centralniEvidenceUpadcu: { state: ceu, raw: ceuRaw },
        datumZaniku: subject.datumZaniku ?? null,
        notes,
        provenance: envelope,
        _disclaimer: ARES_DISCLAIMER,
        _attribution: ARES_ATTRIBUTION,
        _source: "ARES /ekonomicke-subjekty/{ico} → seznamRegistraci.{stavZdrojeIr, stavZdrojeCeu}",
        _note:
          "For the authoritative current status, consult the Insolvency Register at https://isir.justice.cz directly.",
      });
    } catch (err) {
      return errorResult(err);
    }
  },
});
