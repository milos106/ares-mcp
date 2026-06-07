import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { VrOdpoved } from "../src/ares/types.js";
import { buildCrossCompanyGraph } from "../src/graph/crossCompanyPersons.js";

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadVr(ico: string): VrOdpoved {
  const raw = fs.readFileSync(path.join(FIXTURES_DIR, `vr_${ico}.json`), "utf8");
  return JSON.parse(raw) as VrOdpoved;
}

const AGROFERT = "26185610";
const PENAM = "46967851";
const KOSTELECKE = "46900411";
const VODNANSKE = "27435148";

describe("buildCrossCompanyGraph (Agrofert holding fixtures)", () => {
  const inputs = [AGROFERT, PENAM, KOSTELECKE, VODNANSKE].map((ico) => ({
    ico,
    vr: loadVr(ico),
  }));

  it("recognises all four companies as found in VR", () => {
    const g = buildCrossCompanyGraph(inputs);
    expect(g.companies).toHaveLength(4);
    expect(g.companies.every((c) => c.vrFound)).toBe(true);
  });

  it("resolves current trading names from the obchodniJmeno history array", () => {
    const g = buildCrossCompanyGraph(inputs);
    const names = Object.fromEntries(g.companies.map((c) => [c.ico, c.obchodniJmeno]));
    expect(names[AGROFERT]).toBe("AGROFERT, a.s.");
    expect(names[PENAM]).toBe("PENAM, a.s.");
    expect(names[KOSTELECKE]).toBe("Kostelecké uzeniny a.s.");
    expect(names[VODNANSKE]).toBe("Vodňanské kuře, s.r.o.");
  });

  it("counts only active members (those without datumVymazu)", () => {
    const g = buildCrossCompanyGraph(inputs);
    // Agrofert alone had 12 active members in our June 2026 snapshot.
    expect(g.totalActivePersons).toBeGreaterThanOrEqual(12);
    // Sanity: should be less than the historical total (which is in the hundreds).
    expect(g.totalActivePersons).toBeLessThan(100);
  });

  it("identifies shared persons across multiple companies", () => {
    const g = buildCrossCompanyGraph(inputs);
    const names = g.sharedPersons.map((p) => p.jmeno.toUpperCase());

    // Michal Jedlička sits on Agrofert + Kostelecké uzeniny + Vodňanské kuře.
    expect(names.some((n) => n.includes("JEDLIČKA"))).toBe(true);
    // Jaroslav Kurčík sits on Agrofert + Penam.
    expect(names.some((n) => n.includes("KURČÍK"))).toBe(true);
  });

  it("reports memberships per shared person with normalized funkce labels", () => {
    const g = buildCrossCompanyGraph(inputs);
    const jedlicka = g.sharedPersons.find((p) => p.jmeno.toUpperCase().includes("JEDLIČKA"));
    expect(jedlicka).toBeDefined();
    expect(jedlicka!.memberships.length).toBeGreaterThanOrEqual(3);
    const icos = jedlicka!.memberships.map((m) => m.ico);
    expect(icos).toContain(AGROFERT);
    expect(icos).toContain(KOSTELECKE);
    expect(icos).toContain(VODNANSKE);
  });

  it("does not list non-shared persons in sharedPersons", () => {
    const g = buildCrossCompanyGraph(inputs);
    // Tomáš Smola appears only at Penam (per our June 2026 fixture).
    const smola = g.sharedPersons.find((p) => p.jmeno.toUpperCase().includes("SMOLA"));
    expect(smola).toBeUndefined();
  });

  it("emits Mermaid output with a header and nodes for every input company", () => {
    const g = buildCrossCompanyGraph(inputs);
    expect(g.mermaid.startsWith("graph LR")).toBe(true);
    expect(g.mermaid).toContain(`C_${AGROFERT}`);
    expect(g.mermaid).toContain(`C_${PENAM}`);
    expect(g.mermaid).toContain(`C_${KOSTELECKE}`);
    expect(g.mermaid).toContain(`C_${VODNANSKE}`);
    expect(g.mermaid).toContain("classDef company");
    expect(g.mermaid).toContain("classDef person");
  });
});

describe("buildCrossCompanyGraph — edge cases", () => {
  it("handles a company missing from VR (null record)", () => {
    const inputs = [
      { ico: AGROFERT, vr: loadVr(AGROFERT) },
      { ico: "12345678", vr: null },
    ];
    const g = buildCrossCompanyGraph(inputs);
    expect(g.companies).toHaveLength(2);
    expect(g.companies[1]).toMatchObject({ ico: "12345678", vrFound: false });
    // No shared persons when only one company has data.
    expect(g.sharedPersons).toHaveLength(0);
  });

  it("returns an empty shared list for a single company", () => {
    const g = buildCrossCompanyGraph([{ ico: AGROFERT, vr: loadVr(AGROFERT) }]);
    expect(g.sharedPersons).toHaveLength(0);
    expect(g.companies).toHaveLength(1);
  });
});
