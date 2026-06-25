import { describe, expect, it } from "vitest";
import type { AresWebClient } from "../src/aresWeb/client.js";
import { beneficialOwnerTool } from "../src/tools/beneficialOwner.js";
import type { RegisteredTool, ToolContext } from "../src/tools/common.js";
import { discoverHoldingTool } from "../src/tools/discoverHolding.js";
import { groupFundingTool } from "../src/tools/groupFunding.js";
import { BASE_TOOLS, MOAT_TOOLS, buildToolset } from "../src/tools/index.js";
import { ownershipVerdictTool } from "../src/tools/ownershipVerdict.js";
import { publicFundingTool } from "../src/tools/publicFunding.js";
import { makeMockClient, testProvenance } from "./_helpers/mockClient.js";

function fakeAresWeb(over: Partial<Record<keyof AresWebClient, unknown>> = {}): AresWebClient {
  return {
    discoverHolding: async () =>
      over.discoverHolding ?? { parent: { ico: "26185610" }, discovered: [] },
    getDotace: async () => over.getDotace ?? { ico: "26185610", available: true, totalDotaci: 19 },
    getSmlouvy: async () =>
      over.getSmlouvy ?? { ico: "26185610", available: true, totalContracts: 51 },
    getUbo: async () =>
      over.getUbo ?? { ico: "26185610", available: true, active: [{ jmeno: "X" }] },
    getOwnershipVerdict: async () =>
      over.getOwnershipVerdict ?? {
        ico: "26185610",
        stav: "nepruhledne_fond",
        level: "warn",
        veta: "Zapsaný akcionář není skutečný majitel.",
        detail: "…",
        vrstvy: { akcionari: [], ubo: [], statutari: [], holding: {} },
        confidence: "vysoka",
        asOf: "2025-10-15",
      },
    getGroupFunding: async () =>
      over.getGroupFunding ?? {
        ico: "26185610",
        skupina: { firemVeSkupine: 9, dotaceCelkemCZK: 851848388, zakazkyCelkemCZK: 490749780 },
        poFirmach: [{ ico: "47675730", obchodniJmeno: "OLMA, a.s.", dotaceCZK: 305067486 }],
      },
  } as unknown as AresWebClient;
}

function ctxWith(aresWeb: AresWebClient | null): ToolContext {
  return { client: makeMockClient({}), provenance: testProvenance(), aresWeb };
}

async function run(tool: RegisteredTool, ctx: ToolContext, args: unknown) {
  let captured:
    | ((a: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>)
    | undefined;
  // biome-ignore lint/suspicious/noExplicitAny: minimal fake McpServer
  const fakeServer = {
    tool: (_n: string, _d: string, _s: unknown, cb: (a: unknown) => Promise<unknown>) => {
      // biome-ignore lint/suspicious/noExplicitAny: capture
      captured = cb as any;
    },
  } as any;
  tool.register(fakeServer, ctx);
  if (!captured) throw new Error("tool did not register a handler");
  const res = await captured(args);
  return { res, json: res.isError ? null : JSON.parse(res.content[0].text) };
}

describe("moat tool gating", () => {
  it("excludes moat tools when ARES_WEB_URL is unset (aresWeb null)", () => {
    const tools = buildToolset(ctxWith(null));
    expect(tools.length).toBe(BASE_TOOLS.length);
    expect(tools.some((t) => t.tier === "moat")).toBe(false);
  });

  it("includes moat tools when aresWeb is configured", () => {
    const tools = buildToolset(ctxWith(fakeAresWeb()));
    expect(tools.length).toBe(BASE_TOOLS.length + MOAT_TOOLS.length);
    expect(tools.filter((t) => t.tier === "moat").length).toBe(MOAT_TOOLS.length);
  });

  it("moat tool returns an error when called without aresWeb", async () => {
    const { res } = await run(discoverHoldingTool, ctxWith(null), { ico: "26185610" });
    expect(res.isError).toBe(true);
  });
});

describe("ares_discover_holding", () => {
  it("proxies the holding tree and seals provenance", async () => {
    const { json } = await run(discoverHoldingTool, ctxWith(fakeAresWeb()), {
      ico: "26185610",
      depth: 2,
      maxIcos: 5,
    });
    expect(json.ico).toBe("26185610");
    expect(json.holding).toBeDefined();
    expect(json.provenance.claims[0].predicate).toBe("holding_ownership_tree");
    expect(json.provenance.claims[0].confidence).toBe("derived");
  });
});

describe("ares_public_funding", () => {
  it("returns dotace + smlouvy with Hlídač attribution", async () => {
    const { json } = await run(publicFundingTool, ctxWith(fakeAresWeb()), { ico: "26185610" });
    expect(json.dotace.totalDotaci).toBe(19);
    expect(json.smlouvy.totalContracts).toBe(51);
    expect(json._attribution.url).toContain("hlidacstatu.cz");
    expect(json.provenance.claims.map((c: { predicate: string }) => c.predicate)).toEqual([
      "subsidies",
      "public_contracts",
    ]);
  });
});

describe("ares_beneficial_owner", () => {
  it("returns UBO with a personal-data notice", async () => {
    const { json } = await run(beneficialOwnerTool, ctxWith(fakeAresWeb()), { ico: "26185610" });
    expect(json.ubo.available).toBe(true);
    expect(json._notice).toMatch(/osobní údaje/i);
    expect(json.provenance.claims[0].predicate).toBe("beneficial_owners");
  });
});

describe("ares_ownership_verdict", () => {
  it("returns the reconciled verdict as a derived signed claim", async () => {
    const { json } = await run(ownershipVerdictTool, ctxWith(fakeAresWeb()), { ico: "26185610" });
    expect(json.stav).toBe("nepruhledne_fond");
    expect(json.veta).toMatch(/akcionář/i);
    expect(json.provenance.claims[0].predicate).toBe("ownership_verdict");
    expect(json.provenance.claims[0].confidence).toBe("derived");
  });
});

describe("ares_group_funding", () => {
  it("returns group totals + per-company breakdown with Hlídač attribution", async () => {
    const { json } = await run(groupFundingTool, ctxWith(fakeAresWeb()), { ico: "26185610" });
    expect(json.skupina.firemVeSkupine).toBe(9);
    expect(json.poFirmach[0].obchodniJmeno).toBe("OLMA, a.s.");
    expect(json._attribution.url).toContain("hlidacstatu.cz");
    expect(json.provenance.claims[0].predicate).toBe("group_public_funding");
  });
});
