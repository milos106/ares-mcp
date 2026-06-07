import { describe, expect, it } from "vitest";
import type { EkonomickySubjekt, RzpZaznam, VrOdpoved } from "../src/ares/types.js";
import { fullDueDiligenceTool } from "../src/tools/fullDueDiligence.js";
import { loadFixture, makeMockClient } from "./_helpers/mockClient.js";

const liberty = loadFixture<EkonomickySubjekt>("subjekt_liberty_ostrava.json");
const agrofert = loadFixture<EkonomickySubjekt>("subjekt_agrofert.json");
const vrLiberty = loadFixture<VrOdpoved>("vr_45193258_liberty.json");
const vrAgrofert = loadFixture<VrOdpoved>("vr_26185610.json");
const rzpAgrofert = loadFixture<RzpZaznam>("rzp_26185610_agrofert.json");

async function runDD(ico: string) {
  let captured: unknown;
  // biome-ignore lint/suspicious/noExplicitAny: minimal fake McpServer
  const fakeServer = {
    tool: (_n: string, _d: string, _shape: unknown, cb: (args: unknown) => Promise<unknown>) => {
      captured = cb;
    },
  } as any;
  fullDueDiligenceTool.register(fakeServer, {
    client: makeMockClient({
      subjects: { [liberty.ico]: liberty, [agrofert.ico]: agrofert },
      vr: { [liberty.ico]: vrLiberty, [agrofert.ico]: vrAgrofert },
      rzp: { [liberty.ico]: null, [agrofert.ico]: rzpAgrofert },
    }),
  });
  // biome-ignore lint/suspicious/noExplicitAny: cb is captured
  const result = await (captured as any)({ ico });
  return JSON.parse(result.content[0].text);
}

describe("ares_full_due_diligence", () => {
  it("returns RED risk for Liberty Ostrava (active insolvency)", async () => {
    const out = await runDD("45193258");
    expect(out.obchodniJmeno).toMatch(/Liberty Ostrava/i);
    expect(out.risk.level).toBe("red");
    expect(out.risk.findings.some((f: { level: string }) => f.level === "red")).toBe(true);
    expect(out.insolvenci.isInsolvent).toBe(true);
    expect(out.markdown).toContain("🔴 RED");
    expect(out.markdown).toContain("Active insolvency");
  });

  it("returns GREEN risk for AGROFERT (healthy)", async () => {
    const out = await runDD("26185610");
    expect(out.obchodniJmeno).toMatch(/AGROFERT/);
    expect(out.risk.level).toBe("green");
    expect(out.statutary.aktivniCount).toBeGreaterThanOrEqual(10);
    expect(out.vat.platceDph).toBe(true);
    expect(out.insolvenci.isInsolvent).toBe(false);
    expect(out.markdown).toContain("🟢 GREEN");
  });

  it("includes structured sections + Markdown summary", async () => {
    const out = await runDD("26185610");
    expect(out.identification).toBeDefined();
    expect(out.statutary).toBeDefined();
    expect(out.trade_licenses).toBeDefined();
    expect(out.insolvenci).toBeDefined();
    expect(typeof out.markdown).toBe("string");
    // Markdown has all the required sections
    expect(out.markdown).toContain("# Due diligence");
    expect(out.markdown).toContain("## Identification");
    expect(out.markdown).toContain("## Governance");
    expect(out.markdown).toContain("## Trade licenses");
    expect(out.markdown).toContain("## Insolvency");
  });

  it("includes CC BY 4.0 attribution and authoritative-source pointers", async () => {
    const out = await runDD("26185610");
    expect(out._attribution.license).toBe("CC BY 4.0");
    expect(out._sources).toEqual(
      expect.arrayContaining([
        expect.stringContaining("/ekonomicke-subjekty/"),
        expect.stringContaining("/ekonomicke-subjekty-vr/"),
        expect.stringContaining("/ekonomicke-subjekty-rzp/"),
      ]),
    );
    expect(out._note).toMatch(/isir\.justice\.cz/);
    expect(out._note).toMatch(/adisspr\.mfcr\.cz/);
  });

  it("rejects an invalid IČO before any network call", async () => {
    const out = await runDD("00000000");
    expect(out.error).toBe("INVALID_INPUT");
  });
});
