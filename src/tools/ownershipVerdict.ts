import { z } from "zod";
import { validateIco } from "../ares/normalize.js";
import { InvalidInputError } from "../errors.js";
import type { Claim } from "../provenance/envelope.js";
import { DERIVED_DISCLAIMER, defineTool, errorResult, jsonResult } from "./common.js";

interface OwnershipVerdict {
  ico?: string;
  stav?: string;
  level?: string;
  veta?: string;
  detail?: string;
  vrstvy?: unknown;
  confidence?: string;
  asOf?: string | null;
  [k: string]: unknown;
}

const inputShape = {
  ico: z.string().min(1).describe("Czech IČO."),
};

export const ownershipVerdictTool = defineTool({
  name: "ares_ownership_verdict",
  tier: "moat",
  description:
    "Who really owns a Czech company. A one-line, sourced verdict reconciling three layers — registered shareholders (Obchodní rejstřík), the beneficial owner (UBO evidence), and the holding structure (GLEIF). Flags when the registered shareholder differs from the beneficial owner (held via a trust/nominee). Descriptive, not a legal determination of control.",
  inputShape,
  handler: async ({ ico }, { aresWeb, provenance }) => {
    if (!aresWeb) {
      return errorResult(
        new Error("Relationship tools are not enabled on this server (ARES_WEB_URL unset)."),
      );
    }
    try {
      const { valid, normalized, reason } = validateIco(ico);
      if (!valid || !normalized) throw new InvalidInputError(`Invalid IČO '${ico}'`, { reason });

      const v = (await aresWeb.getOwnershipVerdict(normalized)) as OwnershipVerdict;
      const fetchedAt = new Date().toISOString();
      const asOf = fetchedAt.slice(0, 10);

      // The verdict is a SYNTHESIS across three registries → confidence "derived".
      const claims: Claim[] = [
        {
          predicate: "ownership_verdict",
          value: { stav: v.stav, veta: v.veta, detail: v.detail, vrstvy: v.vrstvy },
          source: {
            registry: "Obchodní rejstřík + evidence skutečných majitelů + GLEIF",
            endpoint: "ares_web /api/ownership-verdict/{ico}",
            fetched_at: fetchedAt,
            as_of: v.asOf ?? asOf,
          },
          confidence: "derived",
        },
      ];
      const envelope = provenance.seal({ subject: { ico: normalized }, claims, valid_as_of: asOf });

      return jsonResult({ ...v, provenance: envelope, _disclaimer: DERIVED_DISCLAIMER });
    } catch (err) {
      return errorResult(err);
    }
  },
});
