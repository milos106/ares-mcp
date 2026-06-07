# Calling ares-mcp over HTTP from curl

Start the HTTP server locally:

```sh
PORT=3030 npm run start:http
```

## 1. Liveness check

```sh
curl http://localhost:3030/healthz
```

```json
{ "ok": true, "name": "ares-mcp", "version": "0.1.0", "sessions": 0, "uptimeSeconds": 5 }
```

## 2. Initialize a session

```sh
curl -i -X POST http://localhost:3030/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0", "id": 1, "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": { "name": "curl", "version": "0.0.0" }
    }
  }'
```

Response includes a `Mcp-Session-Id` header — keep it for subsequent requests.

## 3. Send the initialized notification

```sh
SESSION="<paste session id>"
curl -X POST http://localhost:3030/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{ "jsonrpc": "2.0", "method": "notifications/initialized" }'
```

## 4. List tools

```sh
curl -X POST http://localhost:3030/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }'
```

## 5. Call a tool

```sh
curl -X POST http://localhost:3030/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{
    "jsonrpc": "2.0", "id": 3, "method": "tools/call",
    "params": {
      "name": "ares_lookup_company",
      "arguments": { "ico": "26185610" }
    }
  }'
```

## 6. Cross-company persons (the killer feature)

```sh
curl -X POST http://localhost:3030/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{
    "jsonrpc": "2.0", "id": 4, "method": "tools/call",
    "params": {
      "name": "ares_cross_company_persons",
      "arguments": {
        "icos": ["26185610", "46967851", "46900411", "27435148"],
        "emitMermaid": true
      }
    }
  }'
```

Returns shared persons across the Agrofert holding plus a Mermaid graph string.

## Rate limit

The server enforces a per-IP token bucket at `ARES_HTTP_RATE_LIMIT` requests per minute (default `60`). When exceeded, it returns:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 60

{ "error": "RATE_LIMITED", "message": "Per-IP limit 60/min exceeded" }
```

`/healthz` is intentionally exempt so health checkers don't consume the budget.
