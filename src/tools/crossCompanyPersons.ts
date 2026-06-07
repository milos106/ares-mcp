import { z } from "zod";
import { validateIco } from "../ares/normalize.js";
import type { VrOdpoved } from "../ares/types.js";
import { type CompanyInput, buildCrossCompanyGraph } from "../graph/crossCompanyPersons.js";
import { InvalidInputError, NotFoundError } from "../errors.js";
import {
  ARES_ATTRIBUTION,
  ARES_DISCLAIMER,
  defineTool,
  errorResult,
  jsonResult,
} from "./common.js";

const inputShape = {
  icos: z
    .array(z.string().min(1))
    .min(2)
    .max(50)
    .describe(
      "List of 2–50 Czech IČOs to cross-reference. Each will be validated and looked up in the Public Register (VR). Members marked as removed (datumVymazu) are excluded.",
    ),
  emitMermaid: z
    .boolean()
    .default(true)
    .describe(
      "If true, also include a Mermaid `graph LR` string that MCP clients (e.g. Claude) can render as a visual person→companies diagram.",
    ),
};

export const crossCompanyPersonsTool = defineTool({
  name: "ares_cross_company_persons",
  description:
    "Given a list of Czech IČOs, find natural persons (and legal entities) who hold active statutory roles in two or more of them. Returns a structured cross-reference plus an optional Mermaid graph for visualization. Useful for due diligence (holding-group mapping, undisclosed beneficial connections, nominee director detection on a small known set).",
  inputShape,
  handler: async ({ icos, emitMermaid }, { client }) => {
    try {
      const normalizedIcos: string[] = [];
      for (const raw of icos) {
        const { valid, normalized, reason } = validateIco(raw);
        if (!valid || !normalized) {
          throw new InvalidInputError(`Invalid IČO in input: '${raw}'`, { reason });
        }
        normalizedIcos.push(normalized);
      }
      const uniqueIcos = [...new Set(normalizedIcos)];
      if (uniqueIcos.length < 2) {
        throw new InvalidInputError(
          "At least two distinct IČOs are required after deduplication.",
        );
      }

      const companies: CompanyInput[] = [];
      const skipped: { ico: string; reason: string }[] = [];

      // Sequential fetch — token bucket in client paces requests under the
      // MFČR ceiling. Tool may issue up to 50 GETs; budget is documented to
      // the user via the input limit and the README's "Acceptable use" notice.
      for (const ico of uniqueIcos) {
        try {
          const vr: VrOdpoved = await client.getVrRecord(ico);
          companies.push({ ico, vr });
        } catch (err) {
          if (err instanceof NotFoundError) {
            skipped.push({ ico, reason: "Not present in VR (may be in RŽP only)." });
            companies.push({ ico, vr: null });
          } else {
            throw err;
          }
        }
      }

      const graph = buildCrossCompanyGraph(companies);

      return jsonResult({
        zpracovanoIco: uniqueIcos.length,
        companies: graph.companies,
        totalActivePersons: graph.totalActivePersons,
        sharedCount: graph.sharedPersons.length,
        sharedPersons: graph.sharedPersons.map((p) => ({
          jmeno: p.jmeno,
          datumNarozeni: p.datumNarozeni,
          isLegalEntity: p.personKey.startsWith("LEGAL|"),
          memberships: p.memberships,
        })),
        ...(skipped.length > 0 ? { skipped } : {}),
        ...(emitMermaid ? { mermaid: graph.mermaid } : {}),
        _disclaimer: ARES_DISCLAIMER,
        _attribution: ARES_ATTRIBUTION,
        _note:
          "Person identity is derived from name + date of birth (rodné číslo is not exposed by the public ARES API). Coincidental matches are possible but rare for small sets. Only currently active members are included.",
      });
    } catch (err) {
      return errorResult(err);
    }
  },
});
