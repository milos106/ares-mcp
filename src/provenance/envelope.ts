import { canonicalBytes } from "./canonicalize.js";
import type { ProvenanceJwk, ProvenanceSigner } from "./keys.js";
import { verifyWithJwk } from "./keys.js";

/**
 * Provenance envelope — see agentData/mvp-spec.md §2.
 *
 * The shape is a list of `claims`, each carrying its own `source` (which
 * registry, when fetched, what date it is valid as of). The whole payload is
 * signed with Ed25519 over its canonical form, so a verifier can confirm both
 * integrity ("these exact claims were issued by us") and provenance ("each fact
 * came from this registry as of this date") — the difference between a
 * provable answer and one an LLM merely generated.
 */

export const ENVELOPE_ISSUER = "ares-provenance/v1";

/**
 * Legal positioning of the signature, travelling *inside* the signed payload so
 * it cannot be stripped without breaking the signature. Wording follows the
 * legal research (agentData/pravni-reserse.md §2): a self-issued Ed25519
 * signature is a technical integrity/authenticity proof — NOT a qualified
 * electronic signature/seal nor an officially certified extract under eIDAS.
 * Do not upgrade this claim without a qualified electronic seal (QeSeal).
 */
export const PROVENANCE_NOTICE =
  "Technický důkaz integrity a původu dat (Ed25519). Nejedná se o kvalifikovaný " +
  "elektronický podpis/pečeť ani úředně ověřený výstup dle eIDAS. Data pocházejí " +
  "z veřejných rejstříků (zdroj: ARES, MF ČR) a mají informativní charakter.";

export type ClaimConfidence = "primary" | "derived";

export interface ClaimSource {
  /** ARES | OR | RŽP | ADIS | ISIR | ČNB-JERRS | EU-sankce | Hlídač | … */
  registry: string;
  endpoint?: string;
  fetched_at: string;
  /** Date the registry states the data is valid as of. */
  as_of: string;
}

export interface Claim {
  predicate: string;
  value: unknown;
  source: ClaimSource;
  /** `primary` = straight from a registry; `derived` = computed (holding, graph). */
  confidence: ClaimConfidence;
}

export interface EnvelopeSignature {
  alg: "Ed25519";
  key_id: string;
  /** base64url(raw Ed25519 signature) over canonicalize(envelope without `signature`). */
  value: string;
}

export interface ProvenanceEnvelope {
  issuer: typeof ENVELOPE_ISSUER;
  /** Legal positioning of the signature; signed (see PROVENANCE_NOTICE). */
  notice: string;
  subject: Record<string, unknown>;
  issued_at: string;
  valid_as_of: string;
  claims: Claim[];
  signature: EnvelopeSignature | null;
}

export interface BuildEnvelopeInput {
  subject: Record<string, unknown>;
  claims: Claim[];
  issued_at: string;
  valid_as_of: string;
}

/** Build an unsigned envelope. */
export function buildEnvelope(input: BuildEnvelopeInput): ProvenanceEnvelope {
  return {
    issuer: ENVELOPE_ISSUER,
    notice: PROVENANCE_NOTICE,
    subject: input.subject,
    issued_at: input.issued_at,
    valid_as_of: input.valid_as_of,
    claims: input.claims,
    signature: null,
  };
}

/** The exact bytes that get signed / verified: the envelope minus `signature`. */
function signingPayload(env: ProvenanceEnvelope): Buffer {
  const { signature: _omit, ...rest } = env;
  return canonicalBytes(rest);
}

/** Return a copy of the envelope with an Ed25519 signature attached. */
export function signEnvelope(
  env: ProvenanceEnvelope,
  signer: ProvenanceSigner,
): ProvenanceEnvelope {
  const unsigned: ProvenanceEnvelope = { ...env, signature: null };
  const sig = signer.sign(signingPayload(unsigned));
  return {
    ...unsigned,
    signature: { alg: "Ed25519", key_id: signer.keyId, value: sig.toString("base64url") },
  };
}

export interface VerifyResult {
  valid: boolean;
  reasons: string[];
}

/**
 * Verify an envelope's signature. The caller supplies a resolver that maps a
 * `key_id` to its published JWK (e.g. fetched from
 * `/.well-known/ares-provenance/keys.json`). This keeps verification offline
 * and independent of the signing server.
 */
export function verifyEnvelope(
  env: ProvenanceEnvelope,
  resolveKey: (keyId: string) => ProvenanceJwk | undefined,
): VerifyResult {
  const reasons: string[] = [];
  if (!env.signature) {
    return { valid: false, reasons: ["envelope is unsigned"] };
  }
  if (env.signature.alg !== "Ed25519") {
    reasons.push(`unsupported signature alg: ${env.signature.alg}`);
  }
  const jwk = resolveKey(env.signature.key_id);
  if (!jwk) {
    return { valid: false, reasons: [`unknown key_id: ${env.signature.key_id}`] };
  }
  let ok = false;
  try {
    ok = verifyWithJwk(jwk, signingPayload(env), Buffer.from(env.signature.value, "base64url"));
  } catch (err) {
    reasons.push(`verification error: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!ok) reasons.push("signature does not match payload");
  return { valid: ok && reasons.length === 0, reasons };
}
