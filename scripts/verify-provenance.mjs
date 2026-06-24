#!/usr/bin/env node
/**
 * Standalone verifier for a provenance envelope (#4 demo).
 *
 * Deliberately self-contained — it reimplements canonicalization + Ed25519
 * verification in ~30 lines and depends on nothing but Node's built-in crypto.
 * That is the whole point: any third party can confirm a signed answer offline
 * with just the public key, independent of our server or codebase.
 *
 * Usage:
 *   # verify a full tool output (auto-extracts the `provenance` field)
 *   node scripts/verify-provenance.mjs response.json --jwks keys.json
 *
 *   # fetch the JWKS over HTTP instead
 *   node scripts/verify-provenance.mjs response.json \
 *     --jwks https://your-host/.well-known/ares-provenance/keys.json
 *
 *   # or pipe the envelope on stdin
 *   cat response.json | node scripts/verify-provenance.mjs --jwks keys.json
 */

import crypto from "node:crypto";
import fs from "node:fs";

// --- minimal RFC 8785-style canonical JSON (must match src/provenance/canonicalize.ts) ---
function canonicalize(value) {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "string") return JSON.stringify(value);
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (t === "object") {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(",")}}`;
  }
  throw new TypeError(`cannot canonicalize ${t}`);
}

function verify(envelope, jwks) {
  if (!envelope || !envelope.signature) return { valid: false, reasons: ["envelope is unsigned"] };
  const { signature, ...payload } = envelope;
  const jwk = (jwks.keys ?? []).find((k) => k.kid === signature.key_id);
  if (!jwk) return { valid: false, reasons: [`unknown key_id: ${signature.key_id}`] };
  const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const ok = crypto.verify(
    null,
    Buffer.from(canonicalize(payload), "utf8"),
    publicKey,
    Buffer.from(signature.value, "base64url"),
  );
  return { valid: ok, reasons: ok ? [] : ["signature does not match payload"] };
}

// --- CLI plumbing ---
async function main() {
  const argv = process.argv.slice(2);
  const jwksIdx = argv.indexOf("--jwks");
  const jwksRef = jwksIdx !== -1 ? argv[jwksIdx + 1] : undefined;
  const fileArg = argv.find(
    (a, i) => a !== "--jwks" && argv[i - 1] !== "--jwks" && !a.startsWith("--"),
  );

  if (!jwksRef) {
    console.error("error: --jwks <file-or-url> is required");
    process.exit(2);
  }

  const inputText = fileArg ? fs.readFileSync(fileArg, "utf8") : fs.readFileSync(0, "utf8");
  const parsed = JSON.parse(inputText);
  // Accept either a bare envelope or a full tool output that contains one.
  const envelope = parsed.signature || parsed.claims ? parsed : parsed.provenance;
  if (!envelope) {
    console.error("error: no provenance envelope found in input");
    process.exit(2);
  }

  const jwks = /^https?:\/\//.test(jwksRef)
    ? await (await fetch(jwksRef)).json()
    : JSON.parse(fs.readFileSync(jwksRef, "utf8"));

  const result = verify(envelope, jwks);

  console.log(`subject:     ${JSON.stringify(envelope.subject)}`);
  console.log(`issued_at:   ${envelope.issued_at}`);
  console.log(`valid_as_of: ${envelope.valid_as_of}`);
  console.log(`key_id:      ${envelope.signature?.key_id ?? "(unsigned)"}`);
  console.log("claims:");
  for (const c of envelope.claims ?? []) {
    console.log(
      `  - ${c.predicate.padEnd(16)} [${c.confidence}] source=${c.source.registry} as_of=${c.source.as_of}`,
    );
  }
  console.log(
    `\nsignature ${result.valid ? "✅ VALID" : "❌ INVALID"}${result.reasons.length ? ` (${result.reasons.join("; ")})` : ""}`,
  );
  process.exit(result.valid ? 0 : 1);
}

main().catch((err) => {
  console.error("fatal:", err.message);
  process.exit(2);
});
