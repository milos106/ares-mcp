import { checkInsolvenciTool } from "./checkInsolvenci.js";
import { checkVatPayerTool } from "./checkVatPayer.js";
import type { RegisteredTool } from "./common.js";
import { crossCompanyPersonsTool } from "./crossCompanyPersons.js";
import { exportForInvoicingTool } from "./exportForInvoicing.js";
import { fullDueDiligenceTool } from "./fullDueDiligence.js";
import { getResClassificationTool } from "./getResClassification.js";
import { getStatutoryBodiesTool } from "./getStatutoryBodies.js";
import { getTradeLicensesTool } from "./getTradeLicenses.js";
import { lookupCompanyTool } from "./lookupCompany.js";
import { lookupCzNaceTool } from "./lookupCzNace.js";
import { searchByAddressTool } from "./searchByAddress.js";
import { searchCompaniesTool } from "./searchCompanies.js";
import { standardizeAddressTool } from "./standardizeAddress.js";
import { validateIcoTool } from "./validateIco.js";

export const ALL_TOOLS: RegisteredTool[] = [
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
