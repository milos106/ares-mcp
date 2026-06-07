import { z } from "zod";
import { validateIco } from "../ares/normalize.js";
import type { EkonomickySubjekt, RzpZaznam, VrOdpoved } from "../ares/types.js";
import { currentObchodniJmeno, flattenMembers, pickPrimaryZaznam } from "../ares/vr.js";
import { InvalidInputError, NotFoundError } from "../errors.js";
import {
  ARES_ATTRIBUTION,
  ARES_DISCLAIMER,
  defineTool,
  errorResult,
  isActiveRegistration,
  jsonResult,
} from "./common.js";

const inputShape = {
  ico: z.string().min(1).describe("Czech IČO of the company."),
};

type RiskLevel = "green" | "yellow" | "red";

interface RiskFinding {
  level: RiskLevel;
  message: string;
}

function tally(findings: RiskFinding[]): RiskLevel {
  if (findings.some((f) => f.level === "red")) return "red";
  if (findings.some((f) => f.level === "yellow")) return "yellow";
  return "green";
}

function statusOf(value: string | null | undefined): "ACTIVE" | "ENDED" | "NONE" {
  if (value === "AKTIVNI") return "ACTIVE";
  if (value === "ZANIKLY") return "ENDED";
  return "NONE";
}

function buildMarkdown(report: {
  ico: string;
  obchodniJmeno?: string;
  pravniForma?: string;
  datumVzniku?: string;
  datumZaniku?: string | null;
  sidlo?: string;
  dic: string | null;
  platceDph: boolean;
  insolvenci: { isInsolvent: boolean; hadHistory: boolean; ir: string; ceu: string };
  statutariCount: number;
  zivnostenskaCount: number;
  zivnostenskaActiveCount: number;
  czNace: string[];
  risk: { level: RiskLevel; findings: RiskFinding[] };
}): string {
  const emoji = { green: "🟢", yellow: "🟡", red: "🔴" }[report.risk.level];
  const lines: string[] = [];
  lines.push(`# Due diligence: ${report.obchodniJmeno ?? report.ico}`);
  lines.push("");
  lines.push(`**Risk level:** ${emoji} ${report.risk.level.toUpperCase()}`);
  lines.push("");
  if (report.risk.findings.length > 0) {
    lines.push("**Findings:**");
    for (const f of report.risk.findings) {
      const icon = { green: "✅", yellow: "⚠️", red: "🚨" }[f.level];
      lines.push(`- ${icon} ${f.message}`);
    }
    lines.push("");
  }
  lines.push("## Identification");
  lines.push(`- IČO: \`${report.ico}\``);
  if (report.dic) lines.push(`- DIČ: \`${report.dic}\` (VAT payer: ${report.platceDph ? "yes" : "no"})`);
  if (report.pravniForma) lines.push(`- Legal form: ${report.pravniForma}`);
  if (report.datumVzniku) lines.push(`- Founded: ${report.datumVzniku}`);
  if (report.datumZaniku) lines.push(`- Dissolved: **${report.datumZaniku}**`);
  if (report.sidlo) lines.push(`- Registered seat: ${report.sidlo}`);
  if (report.czNace.length > 0) lines.push(`- CZ-NACE: ${report.czNace.join(", ")}`);
  lines.push("");
  lines.push("## Governance");
  lines.push(`- Active statutary members: **${report.statutariCount}**`);
  lines.push("");
  lines.push("## Trade licenses");
  lines.push(
    `- Total: ${report.zivnostenskaCount} (active: ${report.zivnostenskaActiveCount})`,
  );
  lines.push("");
  lines.push("## Insolvency");
  lines.push(`- Insolvenční rejstřík: ${report.insolvenci.ir}`);
  lines.push(`- Centrální evidence úpadců: ${report.insolvenci.ceu}`);
  if (report.insolvenci.isInsolvent) lines.push("- **Currently insolvent.**");
  else if (report.insolvenci.hadHistory) lines.push("- Past insolvency on record.");
  else lines.push("- No insolvency record.");
  return lines.join("\n");
}

export const fullDueDiligenceTool = defineTool({
  name: "ares_full_due_diligence",
  description:
    "One-shot due-diligence report for a Czech company. Fetches the aggregate ARES profile, Public Register record (statutory bodies), Trade Register (licenses), evaluates insolvency status (IR + CEÚ) and dissolution date, and returns a structured report with a green/yellow/red risk flag plus a Markdown summary suitable for chat display. Replaces 4–5 individual lookups with a single call.",
  inputShape,
  handler: async ({ ico }, { client }) => {
    try {
      const { valid, normalized, reason } = validateIco(ico);
      if (!valid || !normalized) {
        throw new InvalidInputError(`Invalid IČO: ${ico}`, { reason });
      }

      // Run the three independent ARES calls in parallel. Catch missing
      // sub-records (some entities are in ARES but not in VR/RŽP).
      const [subjectRes, vrRes, rzpRes] = await Promise.allSettled([
        client.getEconomicSubject(normalized),
        client.getVrRecord(normalized),
        client.getRzpRecord(normalized),
      ]);

      if (subjectRes.status === "rejected") {
        // If the main lookup fails, propagate (e.g. 404 NOT_FOUND).
        throw subjectRes.reason;
      }

      const subject: EkonomickySubjekt = subjectRes.value;
      const vr: VrOdpoved | null = vrRes.status === "fulfilled" ? vrRes.value : null;
      const rzp: RzpZaznam | null = rzpRes.status === "fulfilled" ? rzpRes.value : null;

      // Insolvency
      const reg = subject.seznamRegistraci ?? {};
      const ir = statusOf(reg.stavZdrojeIr);
      const ceu = statusOf(reg.stavZdrojeCeu);
      const isInsolvent = ir === "ACTIVE" || ceu === "ACTIVE";
      const hadInsolvencyHistory = ir === "ENDED" || ceu === "ENDED";

      // Governance
      const members = flattenMembers(vr, { activeOnly: true });
      const statutariCount = members.length;

      // Trade licenses
      const allLicenses = rzp?.zivnostenskeOpravneni ?? [];
      const activeLicenses = allLicenses.filter((l) => !l.datumZaniku);

      // VAT
      const dphActive = isActiveRegistration(reg.stavZdrojeDph);
      const dic = subject.dic ?? null;

      // CZ-NACE
      const czNace =
        (subject as { czNace2008?: string[] }).czNace2008 ?? subject.czNace ?? [];

      // Risk scoring — conservative, prefer false positives over missed flags
      const findings: RiskFinding[] = [];
      if (isInsolvent) findings.push({ level: "red", message: "Active insolvency or bankruptcy on record." });
      if (subject.datumZaniku) {
        findings.push({
          level: "red",
          message: `Entity dissolved on ${subject.datumZaniku}.`,
        });
      }
      if (statutariCount === 0 && !subject.datumZaniku) {
        findings.push({
          level: "yellow",
          message: "No active statutory body members in the Public Register — verify before contracting.",
        });
      }
      if (hadInsolvencyHistory && !isInsolvent) {
        findings.push({
          level: "yellow",
          message: "Past insolvency proceedings closed — historical distress.",
        });
      }
      if (!dphActive && dic) {
        findings.push({
          level: "yellow",
          message: "DIČ on record but VAT registration is not active — verify with MFČR if invoicing as VAT payer.",
        });
      }
      if (rzp && allLicenses.length > 0 && activeLicenses.length === 0) {
        findings.push({
          level: "yellow",
          message: "All trade licenses (živnostenská oprávnění) are terminated.",
        });
      }
      if (findings.length === 0) {
        findings.push({ level: "green", message: "No red flags found in ARES public records." });
      }

      const riskLevel = tally(findings);
      const sidloText = subject.sidlo?.textovaAdresa as string | undefined;
      const obchodniJmeno = subject.obchodniJmeno ?? currentObchodniJmeno(pickPrimaryZaznam(vr));

      const markdown = buildMarkdown({
        ico: normalized,
        obchodniJmeno,
        pravniForma: subject.pravniForma,
        datumVzniku: subject.datumVzniku,
        datumZaniku: subject.datumZaniku,
        sidlo: sidloText,
        dic,
        platceDph: dphActive,
        insolvenci: { isInsolvent, hadHistory: hadInsolvencyHistory, ir, ceu },
        statutariCount,
        zivnostenskaCount: allLicenses.length,
        zivnostenskaActiveCount: activeLicenses.length,
        czNace,
        risk: { level: riskLevel, findings },
      });

      return jsonResult({
        ico: normalized,
        obchodniJmeno,
        risk: { level: riskLevel, findings },
        identification: {
          pravniForma: subject.pravniForma,
          datumVzniku: subject.datumVzniku,
          datumZaniku: subject.datumZaniku ?? null,
          sidlo: subject.sidlo,
          czNace,
        },
        vat: {
          platceDph: dphActive,
          dic,
          icDph: dphActive ? dic : null,
          stavZdrojeDph: reg.stavZdrojeDph ?? null,
        },
        statutary: {
          aktivniCount: statutariCount,
          clenove: members.map((m) => ({
            organ: m.organName,
            funkce: m.funkce,
            jmeno: m.fyzickaOsoba
              ? `${m.fyzickaOsoba.jmeno ?? ""} ${m.fyzickaOsoba.prijmeni ?? ""}`.trim()
              : m.pravnickaOsoba?.obchodniJmeno,
            datumNarozeni: m.fyzickaOsoba?.datumNarozeni,
            datumZapisu: m.datumZapisu,
          })),
        },
        trade_licenses: {
          total: allLicenses.length,
          aktivni: activeLicenses.length,
          predmety: activeLicenses.map((l) => l.predmetPodnikani).filter(Boolean),
        },
        insolvenci: {
          isInsolvent,
          hadHistory: hadInsolvencyHistory,
          insolvencniRejstrik: ir,
          centralniEvidenceUpadcu: ceu,
        },
        markdown,
        _disclaimer: ARES_DISCLAIMER,
        _attribution: ARES_ATTRIBUTION,
        _sources: [
          "ARES /ekonomicke-subjekty/{ico}",
          "ARES /ekonomicke-subjekty-vr/{ico}",
          "ARES /ekonomicke-subjekty-rzp/{ico}",
        ],
        _note:
          "Risk scoring is conservative and based solely on ARES public data. For high-stakes contracts also consult: ISIR insolvency register (isir.justice.cz), Public Register extract (justice.cz), MFČR VAT registry (adisspr.mfcr.cz), and Hlídač státu.",
      });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return errorResult(err);
      }
      return errorResult(err);
    }
  },
});
