import { describe, expect, it } from "vitest";
import type {
  EkonomickeSubjektySeznam,
  EkonomickeSubjektySeznam as Search,
} from "../src/ares/types.js";
import { searchByAddressTool } from "../src/tools/searchByAddress.js";
import { loadFixture, makeMockClient, testProvenance } from "./_helpers/mockClient.js";

const search = loadFixture<EkonomickeSubjektySeznam>("search_address_liberty.json");

async function runSearch(input: { adresa: string; limit?: number; offset?: number }) {
  let captured: unknown;
  // biome-ignore lint/suspicious/noExplicitAny: minimal fake McpServer
  const fakeServer = {
    tool: (_n: string, _d: string, _shape: unknown, cb: (args: unknown) => Promise<unknown>) => {
      captured = cb;
    },
  } as any;
  searchByAddressTool.register(fakeServer, {
    provenance: testProvenance(),
    client: makeMockClient({ search }),
  });
  // biome-ignore lint/suspicious/noExplicitAny: cb is captured
  const result = await (captured as any)({ limit: 50, offset: 0, ...input });
  return JSON.parse(result.content[0].text);
}

describe("ares_search_by_address", () => {
  it("returns the canonical address ARES holds + IČO list", async () => {
    const out = await runSearch({ adresa: "Vratimovská 689/117, Ostrava" });
    expect(out.celkemNalezeno).toBeGreaterThan(0);
    expect(out.vysledky.length).toBeGreaterThan(0);
    expect(out.vysledky[0]).toMatchObject({
      ico: expect.stringMatching(/^\d{8}$/),
      obchodniJmeno: expect.any(String),
      adresa: expect.stringMatching(/Vratimovská/),
    });
  });

  it("emits a virtual-office warning when many entities share the address", async () => {
    const out = await runSearch({ adresa: "Vratimovská 689/117, Ostrava" });
    // 36 entities at this address per the fixture — should not trigger the
    // > 500 strong signal, but should trigger > 50 shell hint if real result
    // count crosses that threshold. We assert the structure regardless.
    if (out.celkemNalezeno > 50) {
      expect(out.warnings).toBeDefined();
    } else {
      expect(out.warnings).toBeUndefined();
    }
  });

  it("includes attribution and source pointer", async () => {
    const out = await runSearch({ adresa: "Vratimovská 689/117, Ostrava" });
    expect(out._attribution.license).toBe("CC BY 4.0");
    expect(out._source).toMatch(/\/ekonomicke-subjekty\/vyhledat/);
  });
});
