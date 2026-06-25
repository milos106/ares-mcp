import { beneficialOwnerTool } from "./beneficialOwner.js";
import { checkInsolvenciTool } from "./checkInsolvenci.js";
import { checkVatPayerTool } from "./checkVatPayer.js";
import type { RegisteredTool, ToolContext } from "./common.js";
import { crossCompanyPersonsTool } from "./crossCompanyPersons.js";
import { discoverHoldingTool } from "./discoverHolding.js";
import { exportForInvoicingTool } from "./exportForInvoicing.js";
import { fullDueDiligenceTool } from "./fullDueDiligence.js";
import { getResClassificationTool } from "./getResClassification.js";
import { getStatutoryBodiesTool } from "./getStatutoryBodies.js";
import { getTradeLicensesTool } from "./getTradeLicenses.js";
import { groupFundingTool } from "./groupFunding.js";
import { lookupCompanyTool } from "./lookupCompany.js";
import { lookupCzNaceTool } from "./lookupCzNace.js";
import { ownershipVerdictTool } from "./ownershipVerdict.js";
import { publicFundingTool } from "./publicFunding.js";
import { searchByAddressTool } from "./searchByAddress.js";
import { searchCompaniesTool } from "./searchCompanies.js";
import { standardizeAddressTool } from "./standardizeAddress.js";
import { validateIcoTool } from "./validateIco.js";

/** Public ARES tools — always available, self-hostable, no data brain needed. */
export const BASE_TOOLS: RegisteredTool[] = [
  validateIcoTool,
  lookupCompanyTool,
  searchCompaniesTool,
  searchByAddressTool,
  getStatutoryBodiesTool,
  getTradeLicensesTool,
  checkVatPayerTool,
  standardizeAddressTool,
  lookupCzNaceTool,
  crossCompanyPersonsTool,
  checkInsolvenciTool,
  fullDueDiligenceTool,
  getResClassificationTool,
  exportForInvoicingTool,
];

/**
 * Moat tools — backed by the ares_web ("IČO-vazby") data brain. Registered ONLY
 * when `ARES_WEB_URL` is configured (ctx.aresWeb != null), so the public
 * self-host build never exposes the accumulated relationship index.
 */
export const MOAT_TOOLS: RegisteredTool[] = [
  discoverHoldingTool,
  publicFundingTool,
  beneficialOwnerTool,
  ownershipVerdictTool,
  groupFundingTool,
];

/** The toolset for a given runtime context — moat tools gated on `aresWeb`. */
export function buildToolset(ctx: ToolContext): RegisteredTool[] {
  return ctx.aresWeb ? [...BASE_TOOLS, ...MOAT_TOOLS] : [...BASE_TOOLS];
}
