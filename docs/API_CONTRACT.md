# Vitana Health — API Contract

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

### Establish a local owner session
```
POST /api/auth/local
```
**Request body:**
```json
{ "token": "<VITANA_OWNER_TOKEN>" }
```
**Success `204`:** no response body. The loopback-only endpoint sets an `HttpOnly`, `SameSite=Strict` owner cookie. Standalone API clients may instead send the configured owner token as `Authorization: Bearer <token>`.

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

## Desktop runtime settings

These authenticated, owner-only endpoints expose host behavior without exposing
Electron or operating-system registration details. Companion credentials receive
`403 CAPABILITY_REQUIRED`.

```
GET /api/settings/desktop
```

**Success `200`:**
```json
{ "supported": true, "backgroundServiceEnabled": false }
```

Standalone API and browser-development hosts return the same response with
`supported: false`. Updates use:

```
PUT /api/settings/desktop
```

```json
{ "backgroundServiceEnabled": true }
```

The request is strict and rejects additional properties. A host without a desktop
runtime controller returns `501 DESKTOP_RUNTIME_UNSUPPORTED`.

---

## Pairing (device management)

### Submit a pairing request *(pre-auth, rate-limited)*
```
POST /api/pairing/request
```
**Request body:**
```json
{ "deviceId": "stable-device-id", "deviceName": "My phone", "pairingCode": "<QR challenge>" }
```
**Success `201`:** `{ "pairingId": "<id>", "status": "pending", "pollingSecret": "<secret>" }`

### Poll pairing status *(pre-auth)*
```
GET /api/pairing/status/:pairingId
```
Send the `pollingSecret` as `x-pairing-secret`.
**Success `200`:** `{ "id": "<id>", "status": "pending"|"approved"|"denied", "token"?: "<companion token>" }`

### Generate QR code for pairing
```
GET /api/pairing/qr
```
**Success `200`:** `image/png` containing the API URL, challenge, expiry, and TLS public-key hash.

### List pending requests
```
GET /api/pairing/pending
```
**Success `200`:** `[{ "id", "deviceId", "deviceName", "requestedAt" }]`

### List approved devices
```
GET /api/pairing/devices
```
**Success `200`:** `PairingRecord[]`

### Approve a pairing request
```
POST /api/pairing/approve/:pairingId
```
**Request body:** `{ "profileId": "<existing profile id>" }`

Approval binds the device to exactly that profile and grants the fixed companion capabilities:
`profiles:list-minimal`, `assigned-profile:read`, `observations:import-manual`,
`reports:preview`, `reports:commit`, `health-connect:import`, and `pairing:self-revoke`.
Re-pairing the same device revokes its previous token. Authorization schema version 2 is
required; tokens issued under an earlier schema fail closed and the phone must pair again.

### Revoke this companion device
```
POST /api/pairing/revoke-self
```
Requires the companion credential and revokes only that credential.
**Success `200`:** `{ "id": "<id>", "status": "revoked" }`

### Deny a pairing request
```
POST /api/pairing/deny/:pairingId
```
**Success `200`:** `{ "id": "<id>", "status": "denied" }`

### Revoke an approved device
```
POST /api/pairing/revoke/:pairingId
```
**Success `200`:** `PairingRecord`

---

## Profile

### Get active profile
```
GET /api/profile
```
**Success `200`:** `Profile`

### Update active profile
```
PUT /api/profile
```
**Request body:** complete editable profile fields including `displayName`, `subjectKind`, `units`, and optional `birthDate`, `sex`, `heightCm`, `bloodType`, `goalSummary`, and `pet`. Future birth dates, subject-kind age mismatches, implausible heights, and pets without a species are rejected.  
**Success `200`:** `Profile`

### List all profiles
```
GET /api/profiles
```
**Owner success `200`:** `{ "profiles": Profile[], "activeProfileId": "<id>" }`

Companion credentials are granted access only to the explicitly listed companion endpoints.
A companion receives only its granted profile as
`{ "profiles": [{ "id": "<id>", "displayName": "<name>" }] }`; no active-profile or health
metadata is returned.

### Create a new profile
```
POST /api/profiles
```
**Request body:** `{ "displayName": "<name>" }`  
**Success `201`:** `Profile`

### Get active profile ID
```
GET /api/profiles/active
```
**Success `200`:** `{ "profileId": "<id>" }`

### Switch active profile
```
PUT /api/profiles/active
```
**Request body:** `{ "profileId": "<uuid>" }`  
**Success `200`:** `{ "profileId": "<id>" }`

### Delete a profile
```
DELETE /api/profiles/:id
```
**Success `200`:** `{ "deletedProfileId": "<id>", "activeProfileId": "<id>", "profiles": ProfileEntry[] }`

---

## Data (store / analytics / export)

### Download clinician report PDF
```
GET /api/export/pdf
```
Requires owner authentication. Returns an `application/pdf` attachment containing the active profile's
details, data totals, latest measurements, flagged laboratory results, trends, and import provenance. The report is a
health-data summary for discussion with a clinician and is not diagnostic.

### Get analytics data
```
GET /api/analytics
```
**Success `200`:** `AnalyticsSummary`

Companions may read `GET /api/bootstrap`, `GET /api/analytics`, `GET /api/summary`, and
`GET /api/summary/:measurementCode`. These routes always resolve the profile assigned during
pairing, regardless of the PC's active profile or any `profileId` body/query value. Profile
management, observation mutation, Insights, Settings, exports, backups, queries, and model
routes remain owner-only.

### Get summary by measurement code
```
GET /api/summary
GET /api/summary/:measurementCode
```
**Success `200`:** `SummaryEntry[]` or `Observation[]`

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

### Inspect analytics storage
```
GET /api/analytics/storage
```
**Success `200`:** `{ "databasePath": "encrypted-profile:<profile-id>", "engine": "duckdb", "counts": { ... } }`

Returns metadata and row counts for the active encrypted profile. It does not rebuild or create a separate analytics database.

### Generate AI health insights
```
POST /api/insights/generate
```
**Success `200`:** `{ "insight": "<text>" }`

### Export all data
```
GET /api/export
```
**Response:** `application/json` download of the complete active profile store. This is the only supported complete-store read.

---

## Import

Successful import commits return `201` with safe import metadata and transaction-derived outcomes:

```json
{
  "import": { "id": "...", "sourceKind": "manual-entry", "fileName": "...", "rowCount": 2, "status": "processed" },
  "outcome": {
    "sourceImport": { "attempted": 1, "accepted": 1, "duplicates": 0, "evicted": 0 },
    "dataSource": { "attempted": 1, "accepted": 1, "duplicates": 0, "evicted": 0 },
    "observations": { "attempted": 2, "accepted": 2, "duplicates": 0, "evicted": 0 },
    "observationGroups": { "attempted": 1, "accepted": 1, "duplicates": 0, "evicted": 0 },
    "timeSeriesSamples": { "attempted": 0, "accepted": 0, "duplicates": 0, "evicted": 0 },
    "activitySessions": { "attempted": 0, "accepted": 0, "duplicates": 0, "evicted": 0 }
  }
}
```

`accepted` and `duplicates` describe committed database effects, including duplicates within the submitted batch and records already stored. `evicted` is always `0`: imports never remove older records. Raw source content is retained locally but omitted from API responses. Some commit endpoints also include `analyticsStorage` aggregate counts.

### Import blood test PDF
```
POST /api/import/blood-test
```
**Request body:** `{ "base64": "<pdf-data-uri>", "panelName"?, "labName"?, "collectedAt"? }`  
**Success `201`:** committed import response described above.

### Submit manual lab markers
```
POST /api/import/labs/manual
```
**Request body:** `{ "rows": [{ "markerName", "value", "unit" }], "panelName"?, "labName"?, "collectedAt"? }`  
**Success `201`:** committed import response described above.

### Preview body composition file
```
POST /api/import/body-composition/preview
```
**Request body:** `{ "fileName", "mimeType": "application/pdf"|"image/jpeg"|"image/png", "contentBase64": "<base64>" }`.
The JSON field is capped at 20,000,000 characters and decoded content at 15 MB. Empty,
malformed, and oversized payloads are rejected without changing these limits for companions.  
**Success `200`:** `{ "rows": BodyCompositionRow[], "diagnostics": string[] }`

### Commit body composition rows
```
POST /api/import/body-composition/commit
```
**Request body:** `{ "rows": BodyCompositionRow[] }`  
**Success `201`:** committed import response described above, including `analyticsStorage`.

The equivalent blood-test scan routes are `POST /api/import/blood-test/preview` and
`POST /api/import/blood-test/commit`. Companions may use both report types. Preview performs
OCR/parsing only; commit writes only reviewed rows to the assigned profile.

### Generic structured (CSV/TSV) upload

```
POST /api/import/upload/preview
```
**Request body:** `{ "fileName", "format"?: "csv"|"tsv", "content": "<structured text>", "mapping"? }`.
`content` is the raw file text (not base64) and is capped at 2 MB; the format is inferred from the
file name or the header line when omitted. This endpoint never reads or writes the profile store —
it is a pure parse of the submitted content and mapping override. Every preview call produces a
fresh draft; no server-side draft state is retained between calls.

The parser detects a **long** layout (one row per observation, with measurement/value/unit columns)
or a **wide** layout (one row per timestamp, with one column per known measurement) and returns a
`mappingSuggestion` alongside the effective `mapping` (suggestion merged with any override). In the
long layout, rows whose measurement text doesn't match a known code are still included in the draft
but marked `included: false` (generated code) until corrected. In the wide layout, columns that
aren't recognized as a known measurement produce no rows at all until the caller adds a mapping
override for that column and re-previews. Draft rows are capped at 200; `truncated: true` indicates
the file had more matching rows than the ceiling.

**Success `200`:** `{ "fileName", "format", "layout", "checksum", "columns": string[], "mapping",
"mappingSuggestion", "rowCount", "diagnostics": string[], "rows": UploadDraftRow[], "truncated" }`

```
POST /api/import/upload/commit
```
**Request body:** `{ "fileName", "format"?, "checksum"?, "layout"?, "rows": UploadDraftRow[] }`
(max 200 rows). Owner credential required — companion tokens have no capability mapped to this
route and are rejected before any row is processed. Only rows still marked `included` are written,
using the same deterministic-ID and provenance conventions as the other import parsers.
**Success `201`:** committed import response described above, including `analyticsStorage`.

PDF and image reports are not supported by this generic path. Use the body-composition/blood-test
scan endpoints above for OCR-based report import.

### Submit manual observations
```
POST /api/import/observations/manual
```
Companions and owners may submit the existing `ManualObservationPayload`. Companion requests
always commit to the assigned profile; a body/query profile value cannot redirect the import.

### Import Health Connect data
```
POST /api/import/health-connect
```
**Request body:** Health Connect JSON export (max 10 MB)  
**Success `201`:** committed import response described above, including `analyticsStorage`.

For companions, `profileId` may be omitted. If supplied, it must equal the paired device's
profile grant; mismatches return `403 PROFILE_ACCESS_DENIED` before store access. The assigned
profile is always used. Owners may omit `profileId` to use the active profile or provide a
target profile. Missing or invalid credentials return `401`; an authenticated companion
without the required capability returns `403`.

---

## Query / AI

Endpoints in this section return `x-vitana-lifecycle` to identify their compatibility commitment. Supported endpoints are part of the product API; experimental endpoints are diagnostic or fallback paths and can change without a compatibility guarantee.

### AI query *(supported)*
```
POST /api/query/ai
```
**Request body:** `{ "question": "<text>", "timezone"?: "<IANA timezone>", "debug"?: false }`
**Success `200`:** `{ "question", "answer", "limitations", "assumptions", "confidence", "plan", "sourceResolved", "intentResolved", "sql", "resolvedTimeRange", "rowCount", "rows", "chart", "model" }`

Runs the product's validated DSL-to-SQL pipeline for metrics, activities, health events, or care items. Queries are single-source, SELECT-only, capped at 200 rows and 366 days, and restricted to whitelisted projection views and columns. See the README for supported query classes and examples.

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
| `CAPABILITY_REQUIRED` | 403 | Companion lacks access to this operation |
| `PROFILE_ACCESS_DENIED` | 403 | Companion profile grant does not match request |
| `AUTH_LOOPBACK_ONLY` | 403 | Endpoint only accessible from loopback (127.x) |
| `PAIRING_CODE_INVALID` | 400 | Pairing code missing or expired |
| `PAIRING_SECRET_REQUIRED` | 400 | VITANA_SECRET not configured |
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
# Edit .env, set VITANA_OWNER_TOKEN and VITANA_SECRET
npm run build
npm start --workspace=apps/api
```

### Quick start (Windows CMD)

```bat
copy .env.example .env
:: Edit .env, set VITANA_OWNER_TOKEN and VITANA_SECRET
npm run build
npm start --workspace=apps/api
```

### Quick start (Windows PowerShell)

```powershell
Copy-Item .env.example .env
# Edit .env, set VITANA_OWNER_TOKEN and VITANA_SECRET
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
