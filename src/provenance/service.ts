import { type ProvenanceEnvelope, buildEnvelope, signEnvelope } from "./envelope.js";
import type { Claim } from "./envelope.js";
import type { ProvenanceJwks } from "./index.js";
import { type ProvenanceSigner, loadSignerFromEnv } from "./keys.js";

/**
 * Runtime provenance service, created once at server start and threaded into
 * every tool via the ToolContext. It owns the active signing key (if any) and
 * turns a tool's claim list into a sealed (signed-when-possible) envelope.
 *
 * When no key is configured it still produces envelopes — just unsigned — so
 * the server runs out of the box and signing is an explicit opt-in via
 * `ARES_PROVENANCE_PRIVATE_KEY`.
 */
export interface ProvenanceService {
  readonly enabled: boolean;
  readonly signer: ProvenanceSigner | null;
  /** JWKS document for the `/.well-known/ares-provenance/keys.json` endpoint. */
  jwks(): ProvenanceJwks;
  /**
   * Build an envelope around `claims`, stamp `issued_at` = now, and sign it if a
   * key is loaded. `valid_as_of` defaults to today's date (UTC).
   */
  seal(input: {
    subject: Record<string, unknown>;
    claims: Claim[];
    valid_as_of?: string;
  }): ProvenanceEnvelope;
}

function todayUtc(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function createProvenanceService(
  env: NodeJS.ProcessEnv = process.env,
  clock: () => Date = () => new Date(),
): ProvenanceService {
  const signer = loadSignerFromEnv(env);
  return {
    enabled: signer !== null,
    signer,
    jwks(): ProvenanceJwks {
      return { keys: signer ? [signer.publicJwk()] : [] };
    },
    seal(input): ProvenanceEnvelope {
      const now = clock();
      const env0 = buildEnvelope({
        subject: input.subject,
        claims: input.claims,
        issued_at: now.toISOString(),
        valid_as_of: input.valid_as_of ?? todayUtc(now),
      });
      return signer ? signEnvelope(env0, signer) : env0;
    },
  };
}
