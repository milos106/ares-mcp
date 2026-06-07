import { describe, expect, it } from "vitest";
import type { EkonomickySubjekt } from "../src/ares/types.js";
import { checkInsolvenciTool } from "../src/tools/checkInsolvenci.js";
import { loadFixture, makeMockClient } from "./_helpers/mockClient.js";

const liberty = loadFixture<EkonomickySubjekt>("subjekt_liberty_ostrava.json");
const agrofert = loadFixture<EkonomickySubjekt>("subjekt_agrofert.json");

async function runTool(ico: string) {
  let captured: unknown;
  const fakeServer = {
    tool: (_n: string, _d: string, _shape: unknown, cb: (args: unknown) => Promise<unknown>) => {
      // capture the wrapped callback so we can invoke it directly
      captured = cb;
    },
    // biome-ignore lint/suspicious/noExplicitAny: minimal fake McpServer
  } as any;
  checkInsolvenciTool.register(fakeServer, {
    client: makeMockClient({
      subjects: { [liberty.ico]: liberty, [agrofert.ico]: agrofert },
    }),
  });
  // biome-ignore lint/suspicious/noExplicitAny: cb is captured
  const result = await (captured as any)({ ico });
  return JSON.parse(result.content[0].text);
}

describe("ares_check_insolvenci", () => {
  it("flags a company with stavZdrojeIr=AKTIVNI as insolvent", async () => {
    const out = await runTool("45193258");
    expect(out.ico).toBe("45193258");
    expect(out.obchodniJmeno).toMatch(/Liberty Ostrava/i);
    expect(out.isInsolvent).toBe(true);
    expect(out.insolvencniRejstrik.state).toBe("ACTIVE");
    expect(out.insolvencniRejstrik.raw).toBe("AKTIVNI");
    expect(out.notes).toContain("Active insolvency proceedings (Insolvenční rejstřík).");
  });

  it("reports clean status for a healthy company", async () => {
    const out = await runTool("26185610");
    expect(out.obchodniJmeno).toMatch(/AGROFERT/);
    expect(out.isInsolvent).toBe(false);
    expect(out.hadInsolvencyHistory).toBe(false);
    expect(out.insolvencniRejstrik.state).toBe("NONE");
    expect(out.centralniEvidenceUpadcu.state).toBe("NONE");
    expect(out.notes).toEqual([]);
  });

  it("rejects an IČO that fails the Mod-11 checksum", async () => {
    const out = await runTool("11111111");
    expect(out.error).toBe("INVALID_INPUT");
  });
});
