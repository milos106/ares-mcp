#!/usr/bin/env -S npx tsx
/**
 * End-to-end provenance demo (#4): seal a sample due-diligence answer with the
 * real ProvenanceService, write the signed response + JWKS to disk, and print a
 * verification command. Pair with `scripts/verify-provenance.mjs` to prove an
 * independent verifier accepts the signature.
 *
 *   node scripts/generate-provenance-keys.mjs --key-id ares-prov-2026-06 > .keys.env
 *   set -a; source .keys.env; set +a
 *   npx tsx scripts/demo-provenance.mts ./out
 *   node scripts/verify-provenance.mjs ./out/response.json --jwks ./out/keys.json
 */

import fs from "node:fs";
import path from "node:path";
import type { Claim } from "../src/provenance/envelope.js";
import { createProvenanceService } from "../src/provenance/service.js";

const outDir = process.argv[2] ?? ".";
fs.mkdirSync(outDir, { recursive: true });

const svc = createProvenanceService();
const now = new Date().toISOString();
const asOf = now.slice(0, 10);

const claims: Claim[] = [
  {
    predicate: "legal_status",
    value: { obchodniJmeno: "AGROFERT, a.s.", pravniForma: "121", datumZaniku: null },
    source: {
      registry: "ARES",
      endpoint: "ARES /ekonomicke-subjekty/26185610",
      fetched_at: now,
      as_of: asOf,
    },
    confidence: "primary",
  },
  {
    predicate: "insolvency",
    value: { isInsolvent: false, hadHistory: false },
    source: { registry: "ISIR", fetched_at: now, as_of: asOf },
    confidence: "primary",
  },
  {
    predicate: "risk_assessment",
    value: {
      level: "green",
      findings: [{ level: "green", message: "No red flags found in ARES public records." }],
    },
    source: { registry: "ares-mcp/derived", fetched_at: now, as_of: asOf },
    confidence: "derived",
  },
];

const envelope = svc.seal({ subject: { ico: "26185610" }, claims, valid_as_of: asOf });

fs.writeFileSync(
  path.join(outDir, "response.json"),
  JSON.stringify({ ico: "26185610", provenance: envelope }, null, 2),
);
fs.writeFileSync(path.join(outDir, "keys.json"), JSON.stringify(svc.jwks(), null, 2));

console.log(
  `provenance signing: ${svc.enabled ? `ON (key ${svc.signer?.keyId})` : "OFF (no key in env → unsigned)"}`,
);
console.log(`wrote ${path.join(outDir, "response.json")} and ${path.join(outDir, "keys.json")}`);
console.log(
  `\nverify with:\n  node scripts/verify-provenance.mjs ${path.join(outDir, "response.json")} --jwks ${path.join(outDir, "keys.json")}`,
);
