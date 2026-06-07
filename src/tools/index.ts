import { checkInsolvenciTool } from "./checkInsolvenci.js";
import { checkVatPayerTool } from "./checkVatPayer.js";
import type { RegisteredTool } from "./common.js";
import { crossCompanyPersonsTool } from "./crossCompanyPersons.js";
import { fullDueDiligenceTool } from "./fullDueDiligence.js";
import { getStatutoryBodiesTool } from "./getStatutoryBodies.js";
import { getTradeLicensesTool } from "./getTradeLicenses.js";
import { lookupCompanyTool } from "./lookupCompany.js";
import { lookupCzNaceTool } from "./lookupCzNace.js";
import { searchCompaniesTool } from "./searchCompanies.js";
import { standardizeAddressTool } from "./standardizeAddress.js";
import { validateIcoTool } from "./validateIco.js";

export const ALL_TOOLS: RegisteredTool[] = [
  validateIcoTool,
  lookupCompanyTool,
  searchCompaniesTool,
  getStatutoryBodiesTool,
  getTradeLicensesTool,
  checkVatPayerTool,
  standardizeAddressTool,
  lookupCzNaceTool,
  crossCompanyPersonsTool,
  checkInsolvenciTool,
  fullDueDiligenceTool,
];
