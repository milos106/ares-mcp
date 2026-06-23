import crypto from "node:crypto";

/**
 * Ed25519 key handling for the provenance layer.
 *
 * Private keys live ONLY in the environment (never in the repo). The server
 * loads the active signing key from `ARES_PROVENANCE_PRIVATE_KEY` (base64 of a
 * PKCS#8 DER) and publishes the matching public keys at
 * `/.well-known/ares-provenance/keys.json` so any verifier can check a
 * signature offline.
 *
 * Key rotation: each key carries a `key_id`. Signed envelopes reference the
 * `key_id` they were signed with; the JWKS endpoint can advertise several
 * public keys at once (current + recently rotated) so older signatures stay
 * verifiable. The active signer is whichever private key is in the env.
 */

export interface ProvenanceJwk {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
  kid: string;
  use: "sig";
  alg: "EdDSA";
}

export interface ProvenanceSigner {
  readonly keyId: string;
  /** Raw Ed25519 signature bytes over `message`. */
  sign(message: Buffer): Buffer;
  /** Public half, as a JWKS-style entry for the `/.well-known` endpoint. */
  publicJwk(): ProvenanceJwk;
}

/**
 * Deterministic, short key identifier derived from the public key — the
 * base64url SHA-256 of the raw 32-byte Ed25519 public key, truncated. Used when
 * `ARES_PROVENANCE_KEY_ID` is not set explicitly, so signatures and the JWKS
 * endpoint always agree without manual bookkeeping.
 */
export function thumbprint(publicKey: crypto.KeyObject): string {
  const jwk = publicKey.export({ format: "jwk" }) as { x?: string };
  if (!jwk.x) throw new Error("Public key is not an Ed25519 OKP key (no `x`).");
  const raw = Buffer.from(jwk.x, "base64url");
  const digest = crypto.createHash("sha256").update(raw).digest("base64url");
  return `ares-prov-${digest.slice(0, 16)}`;
}

function toJwk(publicKey: crypto.KeyObject, keyId: string): ProvenanceJwk {
  const jwk = publicKey.export({ format: "jwk" }) as { kty?: string; crv?: string; x?: string };
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.x) {
    throw new Error("Provenance key must be an Ed25519 (OKP) key.");
  }
  return { kty: "OKP", crv: "Ed25519", x: jwk.x, kid: keyId, use: "sig", alg: "EdDSA" };
}

function signerFromPrivateKey(
  privateKey: crypto.KeyObject,
  explicitKeyId?: string,
): ProvenanceSigner {
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error(`Provenance signing key must be ed25519, got ${privateKey.asymmetricKeyType}.`);
  }
  const publicKey = crypto.createPublicKey(privateKey);
  const keyId = explicitKeyId ?? thumbprint(publicKey);
  return {
    keyId,
    sign: (message: Buffer) => crypto.sign(null, message, privateKey),
    publicJwk: () => toJwk(publicKey, keyId),
  };
}

/**
 * Load the active signer from the environment. Returns `null` when no signing
 * key is configured — provenance then runs in *unsigned* mode (envelopes are
 * still emitted with claims + sources, just without a signature), so the server
 * works out of the box and signing is an explicit opt-in.
 */
export function loadSignerFromEnv(env: NodeJS.ProcessEnv = process.env): ProvenanceSigner | null {
  const b64 = env.ARES_PROVENANCE_PRIVATE_KEY?.trim();
  if (!b64) return null;
  let privateKey: crypto.KeyObject;
  try {
    privateKey = crypto.createPrivateKey({
      key: Buffer.from(b64, "base64"),
      format: "der",
      type: "pkcs8",
    });
  } catch (err) {
    throw new Error(
      `ARES_PROVENANCE_PRIVATE_KEY is set but could not be parsed as base64 PKCS#8 DER: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  return signerFromPrivateKey(privateKey, env.ARES_PROVENANCE_KEY_ID?.trim() || undefined);
}

/** Build a signer from an in-memory Ed25519 private key (tests, scripts). */
export function signerFromKeyObject(
  privateKey: crypto.KeyObject,
  keyId?: string,
): ProvenanceSigner {
  return signerFromPrivateKey(privateKey, keyId);
}

/** Verify a raw Ed25519 signature given a JWKS-style public key entry. */
export function verifyWithJwk(jwk: ProvenanceJwk, message: Buffer, signature: Buffer): boolean {
  const publicKey = crypto.createPublicKey({
    key: jwk as unknown as crypto.JsonWebKey,
    format: "jwk",
  });
  return crypto.verify(null, message, publicKey, signature);
}
