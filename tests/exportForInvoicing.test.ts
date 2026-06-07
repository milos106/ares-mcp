import { describe, expect, it } from "vitest";
import type { EkonomickySubjekt } from "../src/ares/types.js";
import { exportForInvoicingTool } from "../src/tools/exportForInvoicing.js";
import { loadFixture, makeMockClient } from "./_helpers/mockClient.js";

const agrofert = loadFixture<EkonomickySubjekt>("subjekt_agrofert.json");

async function runExport(ico: string, target: "fakturoid" | "idoklad" | "pohoda") {
  let captured: unknown;
  // biome-ignore lint/suspicious/noExplicitAny: minimal fake McpServer
  const fakeServer = {
    tool: (_n: string, _d: string, _shape: unknown, cb: (args: unknown) => Promise<unknown>) => {
      captured = cb;
    },
  } as any;
  exportForInvoicingTool.register(fakeServer, {
    client: makeMockClient({ subjects: { "26185610": agrofert } }),
  });
  // biome-ignore lint/suspicious/noExplicitAny: cb is captured
  const result = await (captured as any)({ ico, target });
  return JSON.parse(result.content[0].text);
}

describe("ares_export_for_invoicing", () => {
  it("emits Fakturoid-shaped JSON with registration_no and vat_no", async () => {
    const out = await runExport("26185610", "fakturoid");
    expect(out.format).toBe("json");
    expect(out.payload).toMatchObject({
      name: expect.stringMatching(/AGROFERT/),
      registration_no: "26185610",
      vat_no: "CZ26185610",
      country: "CZ",
      _platceDph: true,
    });
    expect(out.endpointHint).toContain("fakturoid.cz");
  });

  it("emits iDoklad-shaped JSON with Czech property names", async () => {
    const out = await runExport("26185610", "idoklad");
    expect(out.payload).toMatchObject({
      CompanyName: expect.stringMatching(/AGROFERT/),
      IdentificationNumber: "26185610",
      VatIdentificationNumber: "CZ26185610",
    });
    expect(out.endpointHint).toContain("idoklad.cz");
  });

  it("emits Pohoda XML-hint structure with adb: namespaces", async () => {
    const out = await runExport("26185610", "pohoda");
    expect(out.format).toBe("xml-hint");
    expect(out.payload["adb:identity"]).toBeDefined();
    expect(out.payload["adb:identity"]["adb:address"]).toMatchObject({
      "adb:company": expect.stringMatching(/AGROFERT/),
      "adb:ico": "26185610",
      "adb:dic": "CZ26185610",
    });
  });

  it("rejects invalid IČO before any network call", async () => {
    const out = await runExport("11111111", "fakturoid");
    expect(out.error).toBe("INVALID_INPUT");
  });
});
