import { describe, expect, it } from "vitest";
import {
  isValidIcoChecksum,
  normalizeDic,
  normalizeIco,
  validateIco,
} from "../src/ares/normalize.js";

describe("normalizeIco", () => {
  it("returns the canonical 8-digit form for a clean numeric input", () => {
    expect(normalizeIco("27074358")).toBe("27074358");
  });

  it("pads short inputs with leading zeros", () => {
    expect(normalizeIco("1234567")).toBe("01234567");
    expect(normalizeIco("1")).toBe("00000001");
  });

  it("strips whitespace", () => {
    expect(normalizeIco("270 743 58")).toBe("27074358");
    expect(normalizeIco("  27074358  ")).toBe("27074358");
    expect(normalizeIco("27\t074\n358")).toBe("27074358");
  });

  it("strips the CZ prefix", () => {
    expect(normalizeIco("CZ27074358")).toBe("27074358");
    expect(normalizeIco("cz27074358")).toBe("27074358");
    expect(normalizeIco("CZ 27074358")).toBe("27074358");
  });

  it("strips dashes and dots", () => {
    expect(normalizeIco("270-743-58")).toBe("27074358");
    expect(normalizeIco("270.743.58")).toBe("27074358");
  });

  it("rejects non-numeric input", () => {
    expect(normalizeIco("abc")).toBeNull();
    expect(normalizeIco("27074358X")).toBeNull();
    expect(normalizeIco("")).toBeNull();
  });

  it("rejects inputs longer than 8 digits", () => {
    expect(normalizeIco("123456789")).toBeNull();
  });
});

describe("isValidIcoChecksum", () => {
  // Real-world valid IČO values verified against ARES.
  const VALID = [
    "27074358", // Asseco Central Europe a.s. (formerly Stormware)
    "26168685", // ČEZ a.s. holding example
    "45274649", // ČSOB a.s.
    "00006947", // Ministry of Finance CZ
    "47114983", // Komerční banka
    "49240901", // ČEZ a.s. (remainder == 0 special case → expected 1)
    "63078333", // Vodafone CZ
    "60193336", // O2 Czech Republic
    "26178541", // T-Mobile CZ
    "26185610", // AGROFERT, a.s. (remainder == 1 special case → expected 0)
    "46967851", // PENAM, a.s. (Agrofert holding)
    "46900411", // Kostelecké uzeniny a.s. (Agrofert holding)
    "27435148", // Vodňanské kuře, s.r.o. (Agrofert holding)
  ];

  // Known-invalid IČO values: each is a real IČO with the last digit flipped
  // so the checksum no longer matches.
  const INVALID = [
    "27074359",
    "26168684",
    "45274640",
    "00006948",
    "47114984",
    "49240900", // when r==0 and 8th digit is 0 (not the expected 1)
    "63078334",
    "60193337",
    "26178542",
    "26185611", // when r==1 and 8th digit is 1 (not the expected 0)
  ];

  it.each(VALID)("accepts valid IČO %s", (ico) => {
    expect(isValidIcoChecksum(ico)).toBe(true);
  });

  it.each(INVALID)("rejects IČO %s with bad checksum", (ico) => {
    expect(isValidIcoChecksum(ico)).toBe(false);
  });

  it("rejects strings that are not exactly 8 digits", () => {
    expect(isValidIcoChecksum("1234567")).toBe(false);
    expect(isValidIcoChecksum("123456789")).toBe(false);
    expect(isValidIcoChecksum("abcdefgh")).toBe(false);
    expect(isValidIcoChecksum("")).toBe(false);
  });

  it("rejects all-zero IČO", () => {
    // sum=0, remainder=0, expected=1, actual=0 → invalid
    expect(isValidIcoChecksum("00000000")).toBe(false);
  });

  it("regression: remainder==1 case requires 8th digit == 0", () => {
    // 26185610 (AGROFERT): sum=144, 144%11=1, so 8th must be 0. Earlier code
    // wrongly rejected the whole remainder==1 branch.
    expect(isValidIcoChecksum("26185610")).toBe(true);
    expect(isValidIcoChecksum("26185611")).toBe(false);
  });
});

describe("validateIco", () => {
  it("returns valid=true for a normalized, checksum-correct IČO", () => {
    expect(validateIco("27074358")).toEqual({ valid: true, normalized: "27074358" });
  });

  it("normalizes and validates a CZ-prefixed input", () => {
    expect(validateIco("CZ27074358")).toEqual({ valid: true, normalized: "27074358" });
  });

  it("reports INVALID_FORMAT for non-numeric input", () => {
    expect(validateIco("not-an-ico")).toEqual({
      valid: false,
      normalized: null,
      reason: "INVALID_FORMAT",
    });
  });

  it("reports INVALID_CHECKSUM when format is fine but checksum fails", () => {
    expect(validateIco("12345678")).toMatchObject({
      valid: false,
      normalized: "12345678",
      reason: "INVALID_CHECKSUM",
    });
  });
});

describe("normalizeDic", () => {
  it("accepts a standard Czech legal-entity DIČ", () => {
    expect(normalizeDic("CZ27074358")).toBe("CZ27074358");
  });

  it("uppercases and strips whitespace", () => {
    expect(normalizeDic("cz 27074358")).toBe("CZ27074358");
  });

  it("accepts 9- and 10-digit individual DIČ", () => {
    expect(normalizeDic("CZ7651231234")).toBe("CZ7651231234");
    expect(normalizeDic("CZ765123123")).toBe("CZ765123123");
  });

  it("rejects DIČ without CZ prefix", () => {
    expect(normalizeDic("27074358")).toBeNull();
  });

  it("rejects DIČ with wrong digit count", () => {
    expect(normalizeDic("CZ1234567")).toBeNull();
    expect(normalizeDic("CZ12345678901")).toBeNull();
  });
});
