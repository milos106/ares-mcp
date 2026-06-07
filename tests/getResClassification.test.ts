import { describe, expect, it } from "vitest";
import type { ResOdpoved } from "../src/ares/types.js";
import { getResClassificationTool } from "../src/tools/getResClassification.js";
import { loadFixture, makeMockClient } from "./_helpers/mockClient.js";

const resAgrofert = loadFixture<ResOdpoved>("res_26185610_agrofert.json");

async function runRes(ico: string) {
  let captured: unknown;
  // biome-ignore lint/suspicious/noExplicitAny: minimal fake McpServer
  const fakeServer = {
    tool: (_n: string, _d: string, _shape: unknown, cb: (args: unknown) => Promise<unknown>) => {
      captured = cb;
    },
  } as any;
  getResClassificationTool.register(fakeServer, {
    client: makeMockClient({ res: { "26185610": resAgrofert } }),
  });
  // biome-ignore lint/suspicious/noExplicitAny: cb is captured
  const result = await (captured as any)({ ico });
  return JSON.parse(result.content[0].text);
}

describe("ares_get_res_classification", () => {
  it("decodes the AGROFERT headcount bracket (code 310 → 50-99 → medium SME)", async () => {
    const out = await runRes("26185610");
    expect(out.obchodniJmeno).toMatch(/AGROFERT/);
    expect(out.kategoriePoctuPracovniku.code).toBe("310");
    expect(out.kategoriePoctuPracovniku.label).toMatch(/50.99/);
    expect(out.kategoriePoctuPracovniku.smeClass).toBe("medium");
  });

  it("decodes institutional sector (11002 → private non-financial)", async () => {
    const out = await runRes("26185610");
    expect(out.institucionalniSektor2010.code).toBe("11002");
    expect(out.institucionalniSektor2010.label).toMatch(/non-financial/i);
  });

  it("includes CZ-NACE list and primary financial office", async () => {
    const out = await runRes("26185610");
    expect(Array.isArray(out.czNace)).toBe(true);
    expect(out.czNace.length).toBeGreaterThan(0);
    expect(out.financniUrad).toBeTruthy();
  });

  it("rejects an invalid IČO before any network call", async () => {
    const out = await runRes("12345678");
    expect(out.error).toBe("INVALID_INPUT");
  });
});
