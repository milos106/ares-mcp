/**
 * Deterministic JSON serialization for signing (RFC 8785 / JCS subset).
 *
 * A cryptographic signature must be computed over a byte string that both the
 * signer and any verifier can reproduce *exactly*. Plain `JSON.stringify` does
 * not guarantee this: object key order is insertion-dependent. We therefore
 * canonicalize by recursively sorting object keys and emitting compact JSON.
 *
 * Scope / limitations (sufficient for provenance envelopes, documented on
 * purpose): values are restricted to the JSON types we actually emit — string,
 * boolean, null, finite number, array, and plain object. We rely on the JS
 * engine's `JSON.stringify` for string escaping and number formatting, which
 * matches RFC 8785 for the integer / short-decimal values present in registry
 * data. Non-finite numbers (NaN/Infinity) and `undefined` are rejected rather
 * than silently coerced, so a malformed claim fails loudly instead of producing
 * a signature a verifier cannot reproduce.
 */
export function canonicalize(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) return "null";

  const t = typeof value;

  if (t === "string") return JSON.stringify(value);
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") {
    if (!Number.isFinite(value as number)) {
      throw new TypeError(`Cannot canonicalize non-finite number: ${String(value)}`);
    }
    return JSON.stringify(value);
  }
  if (t === "undefined") {
    throw new TypeError("Cannot canonicalize `undefined` — omit the key instead.");
  }

  if (Array.isArray(value)) {
    return `[${value.map(serialize).join(",")}]`;
  }

  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      // Drop keys whose value is `undefined` (mirrors JSON.stringify semantics)
      // so callers can spread optional fields without breaking determinism.
      .filter((k) => obj[k] !== undefined)
      .sort();
    const entries = keys.map((k) => `${JSON.stringify(k)}:${serialize(obj[k])}`);
    return `{${entries.join(",")}}`;
  }

  throw new TypeError(`Cannot canonicalize value of type ${t}`);
}

/** UTF-8 bytes of the canonical form — the actual signing input. */
export function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(canonicalize(value), "utf8");
}
