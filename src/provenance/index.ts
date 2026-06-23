export { canonicalize, canonicalBytes } from "./canonicalize.js";
export {
  type ProvenanceJwk,
  type ProvenanceSigner,
  loadSignerFromEnv,
  signerFromKeyObject,
  thumbprint,
  verifyWithJwk,
} from "./keys.js";
export {
  type Claim,
  type ClaimConfidence,
  type ClaimSource,
  type EnvelopeSignature,
  type ProvenanceEnvelope,
  type VerifyResult,
  ENVELOPE_ISSUER,
  PROVENANCE_NOTICE,
  buildEnvelope,
  signEnvelope,
  verifyEnvelope,
} from "./envelope.js";

import type { ProvenanceJwk } from "./keys.js";

/** Shape of the `/.well-known/ares-provenance/keys.json` document. */
export interface ProvenanceJwks {
  keys: ProvenanceJwk[];
}

/**
 * Build a `key_id -> JWK` resolver from a fetched JWKS document, for use with
 * `verifyEnvelope`. Verifiers stay fully offline: fetch the JWKS once, cache it,
 * resolve locally.
 */
export function resolverFromJwks(
  jwks: ProvenanceJwks,
): (keyId: string) => ProvenanceJwk | undefined {
  const byId = new Map(jwks.keys.map((k) => [k.kid, k]));
  return (keyId: string) => byId.get(keyId);
}
