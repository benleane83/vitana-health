# Local Fitness Advisor — API Contract

**Version:** 1 (stable)  
**Base URL:** `http(s)://<host>:<port>`  
**Content-Type:** `application/json` (all requests and responses unless noted)

---

## Overview

All API endpoints begin with `/api/`. The server enforces:

- **Correlation IDs** — every response carries an `x-correlation-id` header.
- **Auth** — most endpoints require a `Bearer` token in the `Authorization` header. Two bootstrap endpoints (pairing request / status) are deliberately pre-auth.
- **Rate limits** — pairing and query endpoints are separately limited to 30 req/min; LLM endpoints to 10 req/min; all other endpoints to 120 req/min per IP.
- **Stable error codes** — see [Error codes](#error-codes).

---

## Authentication

### Exchange credentials for a session token
```
POST /api/auth/local
```
**Request body:**
```json
{ "token": "<LFA_OWNER_TOKEN>" }
```
**Success `200`:**
```json
{ "access_token": "<bearer>", "profile_id": "<uuid>" }
```
Use the returned `access_token` as the value in the `Authorization` header, using the standard scheme for token-based bearer authentication, on all subsequent requests.

---

## Health

### Liveness check
```
GET /api/health
```
No authentication required.  
**Success `200`:**
```json
{ "ok": true, "uptime": 42.1 }
```
Returns `{ "ok": false }` with `503` if the server is shutting down.

---

## Pairing (device management)

### Request a pairing code *(pre-auth, rate-limited)*
```
POST /api/pairing/request
```
**Request body:**
```json
{ "deviceName": "My iPhone" }
```
**Success `200`:** `{ "pairingId": "<id>", "code": "123456", "expiresAt": "<iso>" }`

### Poll pairing status *(pre-auth)*
```
GET /api/pairing/status/:pairingId
```
**Success `200`:** `{ "status": "pending"|"approved"|"denied", "accessToken"?: "<bearer>" }`

### Generate QR code for pairing
```
GET /api/pairing/qr
```
**Success `200`:** `{ "qr": "<data-uri>", "pairingUrl": "<url>" }`

### List pending requests
```
GET /api/pairing/pending
```
**Success `200`:** `{ "pending": [{ "id", "deviceName", "requestedAt" }] }`

### List approved devices
```
GET /api/pairing/devices
```
**Success `200`:** `{ "devices": [{ "id", "deviceName", "approvedAt" }] }`

### Approve a pairing request
```
POST /api/pairing/approve/:pairingId
```
**Success `200`:** `{ "ok": true }`

### Deny a pairing request
```
POST /api/pairing/deny/:pairingId
```
**Success `200`:** `{ "ok": true }`

### Revoke an approved device
```
POST /api/pairing/revoke/:pairingId
```
**Success `200`:** `{ "ok": true }`

---

## Profile

### Get active profile
```
GET /api/profile
```
**Success `200`:** `{ "profile": Profile }`

### Update active profile
```
PUT /api/profile
```
**Request body:** `{ "displayName"?, "sex"?, "birthYear"?, "heightCm"? }`  
**Success `200`:** `{ "profile": Profile }`

### List all profiles
```
GET /api/profiles
```
**Success `200`:** `{ "profiles": Profile[] }`

### Create a new profile
```
POST /api/profiles
```
**Request body:** `{ "displayName": "<name>" }`  
**Success `200`:** `{ "profile": Profile }`

### Get active profile ID
```
GET /api/profiles/active
```
**Success `200`:** `{ "activeProfileId": "<uuid>" }`

### Switch active profile
```
PUT /api/profiles/active
```
**Request body:** `{ "profileId": "<uuid>" }`  
**Success `200`:** `{ "ok": true }`

### Delete a profile
```
DELETE /api/profiles/:id
```
**Success `200`:** `{ "ok": true }`

---

## Data (store / analytics / export)

### Download clinician report PDF
```
GET /api/export/pdf
```
Requires owner or companion authentication. Returns an `application/pdf` attachment containing the active profile's
details, data totals, latest measurements, flagged laboratory results, trends, and import provenance. The report is a
health-data summary for discussion with a clinician and is not diagnostic.

### Get store summary
```
GET /api/store
```
**Success `200`:** `{ "storage": { "profileId", "observationCount", "lastWrittenAt" } }`

### Get analytics data
```
GET /api/analytics
```
**Success `200`:** `{ "analytics": AnalyticsSummary }`

### Get summary by measurement code
```
GET /api/summary
GET /api/summary/:measurementCode
```
**Success `200`:** `{ "summary": SummaryEntry[] }` or `{ "observations": Observation[] }`

### Delete an observation
```
DELETE /api/observations/:id
```
**Success `200`:** `{ "deleted": 1 }`

### Delete all observations of a type
```
DELETE /api/observations/by-type/:measurementCode
```
**Success `200`:** `{ "deleted": <count> }`

### Rebuild analytics warehouse
```
POST /api/warehouse/rebuild
```
**Success `200`:** `{ "ok": true, "tookMs": <number> }`

### Generate AI health insights
```
POST /api/insights/generate
```
**Success `200`:** `{ "insight": "<text>" }`

### Export all data
```
GET /api/export
```
**Response:** `application/json` download of all profile observations.

---

## Import

### Import blood test PDF
```
POST /api/import/blood-test
```
**Request body:** `{ "base64": "<pdf-data-uri>", "panelName"?, "labName"?, "collectedAt"? }`  
**Success `200`:** `{ "inserted": <count>, "skipped"?: <count> }`

### Submit manual lab markers
```
POST /api/import/labs/manual
```
**Request body:** `{ "rows": [{ "markerName", "value", "unit" }], "panelName"?, "labName"?, "collectedAt"? }`  
**Success `200`:** `{ "inserted": <count> }`

### Preview body composition file
```
POST /api/import/body-composition/preview
```
**Request body:** `{ "base64": "<data-uri>" }` (max 20 MB)  
**Success `200`:** `{ "rows": BodyCompositionRow[], "diagnostics": string[] }`

### Commit body composition rows
```
POST /api/import/body-composition/commit
```
**Request body:** `{ "rows": BodyCompositionRow[] }`  
**Success `200`:** `{ "inserted": <count> }`

### Import Health Connect data
```
POST /api/import/health-connect
```
**Request body:** Health Connect JSON export (max 10 MB)  
**Success `200`:** `{ "inserted": <count>, "skipped"?: <count> }`

---

## Query / AI

### Natural language query (structured output)
```
POST /api/query/nl
```
**Request body:** `{ "query": "<natural language>" }`  
**Success `200`:** `{ "answer": "<text>", "chart"?: ChartSeries }`

### Ask a question (full AI)
```
POST /api/query/ask
```
**Request body:** `{ "query": "<text>" }`  
**Success `200`:** `{ "answer": "<text>", "chart"?: ChartSeries, "sql"?: "<string>" }`

### Ask and store the insight
```
POST /api/query/ask-store
```
**Request body:** `{ "query": "<text>" }`  
**Success `200`:** `{ "answer": "<text>", "stored": true }`

### Open-ended AI query
```
POST /api/query/ai
```
**Request body:** `{ "query": "<text>" }`  
**Success `200`:** `{ "response": "<text>" }`

### Simple LLM completion
```
POST /api/llm/simple
```
**Request body:** `{ "prompt": "<text>" }`  
**Success `200`:** `{ "text": "<response>" }`

---

## Error codes

All error responses follow this shape:

```json
{
  "error": "<human-readable message>",
  "code": "<STABLE_CODE>"
}
```

| Code | HTTP Status | Meaning |
|------|-------------|---------|
| `VALIDATION_ERROR` | 400 | Request body or params failed schema validation |
| `EMPTY_PAYLOAD` | 400 | Request body was empty |
| `PAYLOAD_TOO_LARGE` | 413 | Request body exceeded size limit |
| `QUERY_UNRECOGNIZED` | 400 | NL query could not be parsed |
| `QUERY_UNSUPPORTED` | 400 | NL query type not supported |
| `AUTH_REQUIRED` | 401 | No valid ****** provided |
| `AUTH_LOOPBACK_ONLY` | 403 | Endpoint only accessible from loopback (127.x) |
| `PAIRING_CODE_INVALID` | 400 | Pairing code missing or expired |
| `PAIRING_SECRET_REQUIRED` | 400 | LFA_SECRET not configured |
| `PAIRING_NOT_FOUND` | 404 | Pairing request ID not found |
| `DEVICE_NOT_FOUND` | 404 | Device pairing not found |
| `OBSERVATION_NOT_FOUND` | 404 | Observation ID not found |
| `RATE_LIMITED` | 429 | Too many requests — retry after 60 s |
| `REQUEST_ERROR` | 502 | Upstream request (model/service) failed |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## Cross-platform configuration

The server is configured entirely via environment variables. See `.env.example` for the full annotated list.

### Quick start (macOS/Linux)

```sh
cp .env.example .env
# Edit .env, set LFA_OWNER_TOKEN and LFA_SECRET
npm run build
npm start --workspace=apps/api
```

### Quick start (Windows CMD)

```bat
copy .env.example .env
:: Edit .env, set LFA_OWNER_TOKEN and LFA_SECRET
npm run build
npm start --workspace=apps/api
```

### Quick start (Windows PowerShell)

```powershell
Copy-Item .env.example .env
# Edit .env, set LFA_OWNER_TOKEN and LFA_SECRET
npm run build
npm start --workspace=apps/api
```

### Development (with Vite dev server)

```sh
# Terminal 1 — API
npm run dev --workspace=apps/api

# Terminal 2 — Web
npm run dev --workspace=apps/web
```

The API runs on port 4317 by default; Vite proxies `/api` requests to it.
