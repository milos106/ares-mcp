#!/usr/bin/env node
/**
 * Generate an Ed25519 signing key for the provenance layer (#4).
 *
 * Prints:
 *   - ARES_PROVENANCE_PRIVATE_KEY  — base64(PKCS#8 DER), put in your env / secret
 *                                    store. NEVER commit this.
 *   - the derived key_id and public JWK (safe to publish; this is what ends up
 *     at /.well-known/ares-provenance/keys.json).
 *
 * Usage:
 *   node scripts/generate-provenance-keys.mjs            # prints to stdout
 *   node scripts/generate-provenance-keys.mjs --key-id ares-prov-2026-06
 */

import crypto from "node:crypto";

const args = process.argv.slice(2);
const keyIdFlag = args.indexOf("--key-id");
const explicitKeyId = keyIdFlag !== -1 ? args[keyIdFlag + 1] : undefined;

const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");

const der = privateKey.export({ type: "pkcs8", format: "der" });
const privB64 = der.toString("base64");

const jwk = publicKey.export({ format: "jwk" });
const raw = Buffer.from(jwk.x, "base64url");
const thumb = crypto.createHash("sha256").update(raw).digest("base64url").slice(0, 16);
const keyId = explicitKeyId ?? `ares-prov-${thumb}`;

const publicJwk = {
  kty: "OKP",
  crv: "Ed25519",
  x: jwk.x,
  kid: keyId,
  use: "sig",
  alg: "EdDSA",
};

process.stdout.write(`# --- Provenance signing key (Ed25519) ---
# Add this to your env / secret store. DO NOT commit it.
ARES_PROVENANCE_PRIVATE_KEY=${privB64}
ARES_PROVENANCE_KEY_ID=${keyId}

# --- Public key (safe to publish) ---
# Served automatically at GET /.well-known/ares-provenance/keys.json by the HTTP server.
# key_id: ${keyId}
# JWKS entry:
${JSON.stringify(publicJwk, null, 2)}
`);
