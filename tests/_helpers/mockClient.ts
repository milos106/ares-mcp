import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AresClient } from "../../src/ares/client.js";
import type {
  CiselnikyOdpoved,
  EkonomickeSubjektySeznam,
  EkonomickySubjekt,
  ResOdpoved,
  RzpZaznam,
  StandardizovaneAdresyOdpoved,
  VrOdpoved,
} from "../../src/ares/types.js";
import { NotFoundError } from "../../src/errors.js";

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
);

function loadFixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8")) as T;
}

export interface MockResponses {
  subjects?: Record<string, EkonomickySubjekt | null>;
  vr?: Record<string, VrOdpoved | null>;
  rzp?: Record<string, RzpZaznam | null>;
  res?: Record<string, ResOdpoved | null>;
  search?: EkonomickeSubjektySeznam;
  addresses?: StandardizovaneAdresyOdpoved;
  ciselniky?: CiselnikyOdpoved;
}

/**
 * Construct a fake AresClient backed by an in-memory response map. Methods
 * not stubbed throw NotFoundError so missing fixtures are loud rather than
 * silent.
 */
export function makeMockClient(responses: MockResponses): AresClient {
  const fallback = (ico: string, kind: string): never => {
    throw new NotFoundError(`Mock has no ${kind} record for ${ico}`);
  };
  return {
    async getEconomicSubject(ico: string) {
      const r = responses.subjects?.[ico];
      if (r === undefined) return fallback(ico, "subject");
      if (r === null) throw new NotFoundError(`Subject ${ico} not found.`);
      return r;
    },
    async getVrRecord(ico: string) {
      const r = responses.vr?.[ico];
      if (r === undefined) return fallback(ico, "VR");
      if (r === null) throw new NotFoundError(`VR record ${ico} not found.`);
      return r;
    },
    async getRzpRecord(ico: string) {
      const r = responses.rzp?.[ico];
      if (r === undefined) return fallback(ico, "RŽP");
      if (r === null) throw new NotFoundError(`RŽP record ${ico} not found.`);
      return r;
    },
    async getResRecord(ico: string) {
      const r = responses.res?.[ico];
      if (r === undefined) return fallback(ico, "RES");
      if (r === null) throw new NotFoundError(`RES record ${ico} not found.`);
      return r;
    },
    async searchEconomicSubjects() {
      if (!responses.search) throw new Error("Mock has no search response");
      return responses.search;
    },
    async searchAddresses() {
      if (!responses.addresses) throw new Error("Mock has no addresses response");
      return responses.addresses;
    },
    async searchCiselniky() {
      if (!responses.ciselniky) throw new Error("Mock has no ciselniky response");
      return responses.ciselniky;
    },
    // biome-ignore lint/suspicious/noExplicitAny: AresClient has private members
  } as any;
}

export const FIXTURES_DIR = FIXTURES;
export { loadFixture };
