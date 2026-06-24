# Security Policy

## Supported versions

Pre-1.0: fixes land on the latest `0.1.x` release only.

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue.

- Preferred: GitHub private vulnerability reporting (repository **Security → Report a vulnerability**).
- Or email **info@simplesolar.cz** with the subject `ares-mcp security`.

We aim to acknowledge within 5 business days and to share a remediation timeline
after triage. Please allow reasonable time for a fix before public disclosure.

## Scope / threat model

`ares-mcp` is a **read-only client of the public ARES REST API**.

- No authentication and no API keys are required; ARES data is public.
- By default **no personal data is stored or logged** (see README).
- The HTTP variant applies per-IP rate limiting and a request-size cap.

**In scope:** input validation, request handling, the HTTP server, dependency
vulnerabilities, and the provenance signing/verification logic.

**Out of scope:** the upstream ARES service and the accuracy of its data; issues
that require a malicious local environment the user already controls.

## Signing keys (provenance feature)

The optional provenance signing uses an Ed25519 private key supplied via the
`ARES_PROVENANCE_PRIVATE_KEY` environment variable.

- **Private keys must never be committed.** The repository ships only public keys
  (JWKS) where applicable; `.env` is gitignored.
- Rotate keys via the documented `key_id` mechanism and publish public keys at
  `/.well-known/ares-provenance/keys.json`.
- On suspected key compromise, rotate immediately and stop trusting the old
  `key_id`.

## Note on the signatures

`ares-mcp` aggregates public-registry data for **informational purposes**. It is
not an official source, and its signatures are **technical integrity & origin
proofs — not qualified electronic signatures** and not officially certified
extracts. See the README for details.
