import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalize } from "../src/provenance/canonicalize.js";
import {
  type Claim,
  type ProvenanceEnvelope,
  buildEnvelope,
  signEnvelope,
  verifyEnvelope,
} from "../src/provenance/envelope.js";
import { resolverFromJwks } from "../src/provenance/index.js";
import { signerFromKeyObject } from "../src/provenance/keys.js";
import { createProvenanceService } from "../src/provenance/service.js";

function makeSigner(keyId?: string) {
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  return signerFromKeyObject(privateKey, keyId);
}

const sampleClaim: Claim = {
  predicate: "insolvency",
  value: { isInsolvent: false },
  source: { registry: "ISIR", fetched_at: "2026-06-24T10:00:00.000Z", as_of: "2026-06-24" },
  confidence: "primary",
};

function sampleEnvelope(): ProvenanceEnvelope {
  return buildEnvelope({
    subject: { ico: "26185610" },
    claims: [sampleClaim],
    issued_at: "2026-06-24T10:00:00.000Z",
    valid_as_of: "2026-06-24",
  });
}

describe("canonicalize", () => {
  it("is independent of object key insertion order", () => {
    const a = canonicalize({ b: 1, a: 2, c: { y: 1, x: 2 } });
    const b = canonicalize({ c: { x: 2, y: 1 }, a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1,"c":{"x":2,"y":1}}');
  });

  it("omits undefined-valued keys (mirrors JSON.stringify)", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalize({ n: Number.POSITIVE_INFINITY })).toThrow();
  });
});

describe("sign / verify envelope", () => {
  it("round-trips: a freshly signed envelope verifies against its JWKS", () => {
    const signer = makeSigner();
    const signed = signEnvelope(sampleEnvelope(), signer);
    expect(signed.signature).not.toBeNull();
    expect(signed.signature?.alg).toBe("Ed25519");
    expect(signed.signature?.key_id).toBe(signer.keyId);
    // legal positioning travels inside the signed payload
    expect(signed.notice).toMatch(/Nejedná se o kvalifikovaný/);

    const resolve = resolverFromJwks({ keys: [signer.publicJwk()] });
    expect(verifyEnvelope(signed, resolve)).toEqual({ valid: true, reasons: [] });
  });

  it("fails when a claim value is tampered with after signing", () => {
    const signer = makeSigner();
    const signed = signEnvelope(sampleEnvelope(), signer);
    // flip the insolvency verdict without re-signing
    const tampered: ProvenanceEnvelope = structuredClone(signed);
    (tampered.claims[0]!.value as { isInsolvent: boolean }).isInsolvent = true;

    const resolve = resolverFromJwks({ keys: [signer.publicJwk()] });
    const result = verifyEnvelope(tampered, resolve);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("signature does not match payload");
  });

  it("fails for an unknown key_id", () => {
    const signed = signEnvelope(sampleEnvelope(), makeSigner());
    const otherSigner = makeSigner();
    const resolve = resolverFromJwks({ keys: [otherSigner.publicJwk()] });
    const result = verifyEnvelope(signed, resolve);
    expect(result.valid).toBe(false);
    expect(result.reasons[0]).toMatch(/unknown key_id/);
  });

  it("reports an unsigned envelope as invalid", () => {
    const resolve = resolverFromJwks({ keys: [] });
    expect(verifyEnvelope(sampleEnvelope(), resolve)).toEqual({
      valid: false,
      reasons: ["envelope is unsigned"],
    });
  });

  it("verifies regardless of JSON key order (canonicalization)", () => {
    const signer = makeSigner();
    const signed = signEnvelope(sampleEnvelope(), signer);
    // Rebuild the same envelope with keys inserted in a different order; a
    // canonicalizing verifier must still accept it.
    const reordered = {
      signature: signed.signature,
      claims: signed.claims,
      valid_as_of: signed.valid_as_of,
      subject: signed.subject,
      notice: signed.notice,
      issued_at: signed.issued_at,
      issuer: signed.issuer,
    } as ProvenanceEnvelope;
    const resolve = resolverFromJwks({ keys: [signer.publicJwk()] });
    expect(verifyEnvelope(reordered, resolve).valid).toBe(true);
  });
});

describe("createProvenanceService", () => {
  it("runs unsigned when no key is configured", () => {
    const svc = createProvenanceService({});
    expect(svc.enabled).toBe(false);
    expect(svc.jwks().keys).toEqual([]);
    const env = svc.seal({ subject: { ico: "1" }, claims: [sampleClaim] });
    expect(env.signature).toBeNull();
  });

  it("signs and exposes a JWKS when a key is configured, and the output verifies", () => {
    const { privateKey } = crypto.generateKeyPairSync("ed25519");
    const der = privateKey.export({ type: "pkcs8", format: "der" }) as Buffer;
    const svc = createProvenanceService(
      { ARES_PROVENANCE_PRIVATE_KEY: der.toString("base64"), ARES_PROVENANCE_KEY_ID: "test-key" },
      () => new Date("2026-06-24T10:00:00.000Z"),
    );
    expect(svc.enabled).toBe(true);
    expect(svc.jwks().keys[0]?.kid).toBe("test-key");

    const env = svc.seal({ subject: { ico: "26185610" }, claims: [sampleClaim] });
    expect(env.issued_at).toBe("2026-06-24T10:00:00.000Z");
    expect(env.valid_as_of).toBe("2026-06-24");
    expect(env.signature?.key_id).toBe("test-key");

    const resolve = resolverFromJwks(svc.jwks());
    expect(verifyEnvelope(env, resolve).valid).toBe(true);
  });
});
