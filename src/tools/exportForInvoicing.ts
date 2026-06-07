import { z } from "zod";
import { validateIco } from "../ares/normalize.js";
import type { Adresa, EkonomickySubjekt } from "../ares/types.js";
import { InvalidInputError } from "../errors.js";
import {
  ARES_ATTRIBUTION,
  ARES_DISCLAIMER,
  defineTool,
  errorResult,
  isActiveRegistration,
  jsonResult,
} from "./common.js";

const inputShape = {
  ico: z.string().min(1).describe("Czech IČO of the entity to export."),
  target: z
    .enum(["fakturoid", "idoklad", "pohoda"])
    .describe(
      "Invoice-system target format. `fakturoid` returns a JSON shape ready to POST to https://app.fakturoid.cz/api/v3/{slug}/subjects.json. `idoklad` returns a JSON shape compatible with https://api.idoklad.cz Contact endpoint. `pohoda` returns an XML-hint JSON that maps onto Pohoda's `<dat:address>` element in its mServer / XML export schemas.",
    ),
};

interface CommonFields {
  ico: string;
  obchodniJmeno: string;
  dic: string | null;
  platceDph: boolean;
  ulice: string | undefined;
  cisloOrientacni: string | undefined;
  cisloDomovni: string | undefined;
  obec: string | undefined;
  psc: string | undefined;
  zeme: string | undefined;
}

function streetLine(a: Adresa | undefined): string | undefined {
  if (!a) return undefined;
  const street = a.nazevUlice ?? "";
  const domovni = a.cisloDomovni;
  const orient = a.cisloOrientacni;
  const orientPismeno = a.cisloOrientacniPismeno ?? "";
  if (!street && !domovni) return a.textovaAdresa;
  const num =
    domovni && orient
      ? `${domovni}/${orient}${orientPismeno}`
      : (domovni ?? orient ?? "").toString();
  return [street, num].filter(Boolean).join(" ").trim() || undefined;
}

function extractCommon(subject: EkonomickySubjekt): CommonFields {
  const reg = subject.seznamRegistraci ?? {};
  const dphActive = isActiveRegistration(reg.stavZdrojeDph);
  const sidlo = subject.sidlo;
  return {
    ico: subject.ico,
    obchodniJmeno: subject.obchodniJmeno ?? "",
    dic: subject.dic ?? null,
    platceDph: dphActive,
    ulice: streetLine(sidlo),
    cisloOrientacni:
      sidlo?.cisloOrientacni !== undefined ? String(sidlo.cisloOrientacni) : undefined,
    cisloDomovni:
      sidlo?.cisloDomovni !== undefined ? String(sidlo.cisloDomovni) : undefined,
    obec: sidlo?.nazevObce,
    psc: sidlo?.psc !== undefined ? String(sidlo.psc) : undefined,
    zeme: (sidlo?.nazevStatu ?? sidlo?.kodStatu) as string | undefined,
  };
}

/**
 * Fakturoid v3 Subject payload (shape per the public API documentation).
 * Field set is intentionally minimal — covers identification + address,
 * leaves contact / bank / pricing fields blank for the caller to fill.
 */
function asFakturoid(c: CommonFields) {
  return {
    custom_id: c.ico,
    name: c.obchodniJmeno,
    registration_no: c.ico,
    vat_no: c.dic ?? undefined,
    type: "supplier_customer",
    enabled_reminders: true,
    street: c.ulice,
    city: c.obec,
    zip: c.psc,
    country: c.zeme === "Česká republika" ? "CZ" : c.zeme,
    // Fakturoid expects EU VAT mode for vat-payers without explicit flag,
    // but we surface plátce status so the caller can map it.
    _platceDph: c.platceDph,
  };
}

/**
 * iDoklad Contact payload (shape per the public API).
 */
function asIDoklad(c: CommonFields) {
  return {
    CompanyName: c.obchodniJmeno,
    IdentificationNumber: c.ico,
    VatIdentificationNumber: c.dic ?? undefined,
    Street: c.ulice,
    City: c.obec,
    PostalCode: c.psc,
    Country: c.zeme,
    IsRegisteredForVatOss: false,
    _platceDph: c.platceDph,
  };
}

/**
 * Pohoda XML address hint — a JSON projection of the dat:address element
 * structure. The caller wraps it in the appropriate Pohoda XML envelope.
 */
function asPohoda(c: CommonFields) {
  return {
    "adb:identity": {
      "adb:address": {
        "adb:company": c.obchodniJmeno,
        "adb:ico": c.ico,
        "adb:dic": c.dic ?? undefined,
        "adb:street": c.ulice,
        "adb:city": c.obec,
        "adb:zip": c.psc,
        "adb:country": c.zeme === "Česká republika" ? "Česká republika" : c.zeme,
      },
    },
    _platceDph: c.platceDph,
  };
}

export const exportForInvoicingTool = defineTool({
  name: "ares_export_for_invoicing",
  description:
    "Transform an ARES company profile into a payload ready for a Czech invoicing system: Fakturoid (JSON), iDoklad (JSON), or Pohoda (XML-hint JSON). Pure data transformation — no calls to the target system. The result is a paste-ready or post-ready object that fills the identification + address fields; the caller adds contact, bank and pricing.",
  inputShape,
  handler: async ({ ico, target }, { client }) => {
    try {
      const { valid, normalized, reason } = validateIco(ico);
      if (!valid || !normalized) {
        throw new InvalidInputError(`Invalid IČO: ${ico}`, { reason });
      }
      const subject = await client.getEconomicSubject(normalized);
      const common = extractCommon({ ...subject, ico: normalized });

      let payload: Record<string, unknown>;
      let endpointHint: string;
      let format: "json" | "xml-hint";
      switch (target) {
        case "fakturoid":
          payload = asFakturoid(common);
          endpointHint = "POST https://app.fakturoid.cz/api/v3/{slug}/subjects.json";
          format = "json";
          break;
        case "idoklad":
          payload = asIDoklad(common);
          endpointHint = "POST https://api.idoklad.cz/v3/Contacts";
          format = "json";
          break;
        case "pohoda":
          payload = asPohoda(common);
          endpointHint = "Wrap in <dat:dataPack> for Pohoda mServer / XML import";
          format = "xml-hint";
          break;
      }

      return jsonResult({
        ico: normalized,
        obchodniJmeno: common.obchodniJmeno,
        target,
        format,
        payload,
        endpointHint,
        _disclaimer: ARES_DISCLAIMER,
        _attribution: ARES_ATTRIBUTION,
        _note:
          "Generated from ARES public records. Target-system schemas may evolve — verify against the current vendor documentation before integrating: Fakturoid (fakturoid.docs.apiary.io), iDoklad (api.idoklad.cz), Pohoda (stormware.cz/xml).",
      });
    } catch (err) {
      return errorResult(err);
    }
  },
});
