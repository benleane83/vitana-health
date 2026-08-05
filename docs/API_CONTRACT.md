# Vitana Health — API Contract

**Version:** 1 (stable)  
**Base URL:** `http(s)://<host>:<port>`  
**Content-Type:** `application/json` (all requests and responses unless noted)

---

## Overview

All API endpoints begin with `/api/`. The server enforces:

- **Correlation IDs** — every response carries an `x-correlation-id` header.
- **Auth** — most endpoints require a `Bearer` token in the `Authorization` header. Two bootstrap endpoints (pairing request / status) are deliberately pre-auth.
- **Rate limits** — all API requests are limited to 300 req/min per IP, with
  tighter route-group limits for pairing (30), settings (30), queries (30), LLM
  (10), and backup operations (5 create/restore; 10 inspect) per minute.
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

### Desktop updates

Owner-only desktop update operations are separate from the settings mutation:

```text
GET  /api/settings/updates
POST /api/settings/updates/check
POST /api/settings/updates/download
POST /api/settings/updates/restart
```

Responses include `status`, `currentVersion`, immutable `channel`, and optional
`availableVersion`, `lastCheckedAt`, safe `error`, and download `progress`.
Standalone/web development hosts report `unsupported`; commands return
`501 DESKTOP_UPDATES_UNSUPPORTED`. Feed URLs are never returned.

### AI provider settings

These authenticated, owner-only endpoints configure the local or approved cloud
model used by the AI query service. Responses never include an API key; they
return `hasApiKey` instead.

```text
GET  /api/settings/ai
PUT  /api/settings/ai
POST /api/settings/ai/validate
```

`PUT /api/settings/ai` accepts this strict body:

```json
{
  "provider": "ollama",
  "endpoint": "http://127.0.0.1:11434/v1",
  "apiKey": "optional-for-ollama; required-as-applicable-for-openai",
  "model": "model-name",
  "timeoutMs": 30000
}
```

`provider` is `ollama` or `openai`; `endpoint` must be a valid URL, `model` is
required, and `timeoutMs` is an integer from 1,000 through 180,000 milliseconds.
Cloud endpoints are checked against the model-endpoint safety policy. An OpenAI
endpoint-origin change requires resubmission of its API key. The validation route
runs a bounded compatibility probe and returns model identity, elapsed time,
compatibility state, and safe probe diagnostics.

`GET /api/settings/ai/openrouter/connect` begins the optional OpenRouter browser
authorization flow. Its callback endpoint is internal to that flow and returns
HTML rather than a JSON API response.

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

### Profile photo

```text
GET /api/profile/photo
PUT /api/profile/photo
DELETE /api/profile/photo
```

`GET` is available to the owner for the active profile and to a companion for
its single assigned profile. `PUT` and `DELETE` are owner-only; upload is
therefore a PC feature while desktop and mobile may both display the photo.
All successful photo responses and photo `404` responses use
`Cache-Control: no-store`.

`PUT` accepts a normalized JPEG as JSON:

```json
{ "contentType": "image/jpeg", "contentBase64": "<canonical-base64>" }
```

The decoded payload must not exceed 256 KiB. The API rejects malformed base64,
other MIME types, and data without JPEG magic bytes. It computes the SHA-256
revision itself and returns the same bounded JSON transport for `PUT` and
`GET`:

```json
{
  "contentType": "image/jpeg",
  "contentBase64": "<canonical-base64>",
  "revision": "<sha256-hex>",
  "updatedAt": "2026-07-24T10:00:00.000Z"
}
```

Missing photos return `404`; successful deletion returns `{ "deleted": true }`.
Only `{ "revision", "updatedAt" }` metadata appears in profile-list and
bootstrap responses. Photo bytes are stored only in the profile's encrypted
DuckDB database. Desktop normalizes JPEG, PNG, and WebP input to a centered
256×256 JPEG at approximately 85% quality and does not retain the source image
or its EXIF metadata.

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

### Cloud AI consent

```text
GET /api/profile/cloud-ai-consent
PUT /api/profile/cloud-ai-consent
```

Both routes are authenticated and owner-only. `GET` returns the active profile's
consent state, defaulting to disabled when it has never been set:

```json
{
  "enabled": false,
  "providerScopeAccepted": false,
  "consentedAt": "2026-07-23T12:00:00.000Z",
  "consentVersion": "v1"
}
```

`PUT` accepts `{ "enabled", "providerScopeAccepted", "consentVersion"? }`.
Enabling records the current consent timestamp; disabling clears the accepted
scope and timestamp. AI requests can use a cloud provider only when the active
profile has the required consent.

### Reset built-in measurement metadata

```text
POST /api/profile/measurement-types/reset
```

Authenticated, owner-only. Refreshes built-in measurement metadata from the
current registry without deleting health records or custom measurement types.

**Success `200`:**
```json
{ "profileId": "self", "refreshed": 108, "inserted": 0 }
```

## Backups

Backup operations are authenticated and owner-only. They use independent rate
limits: create and restore allow 5 requests/minute, and inspect allows 10
requests/minute. A restore places every non-health endpoint into temporary
maintenance mode until it completes.

### Create an encrypted portable backup

```text
POST /api/backups/create
```

**Request body:**
```json
{ "passphrase": "at-least-12-characters", "scope": "active" }
```

`scope` is `active` or `all` and defaults to `all`. The response is an
`application/octet-stream` `.vitana-backup` attachment. The passphrase is never
returned or stored by this endpoint. Profile photos are intentionally excluded
from backup creation and restore; replaced and restored-as-copy profiles start
without photo metadata.

### Inspect a backup without restoring it

```text
POST /api/backups/inspect
```

Send `multipart/form-data` with exactly one `file` part (up to 100 MB) and a
`passphrase` text field (12–256 characters). The API does not accept passphrases
in request headers. **Success `200`:**

```json
{
  "formatVersion": 1,
  "createdAt": "2026-07-23T12:00:00.000Z",
  "scope": "all",
  "profiles": [{
    "profileId": "self",
    "displayName": "Alex",
    "digestValid": true,
    "observationCount": 42,
    "existsLocally": true
  }]
}
```

### Restore profiles from a backup

```text
POST /api/backups/restore
```

Send `multipart/form-data` with `file` and `passphrase` as above, plus a
`decisions` text field containing a JSON array of profile decisions:

```json
[
  { "profileId": "self", "decision": "replace", "acknowledgeReplacement": "REPLACE_CONFIRMED" },
  { "profileId": "family-member", "decision": "create-copy" }
]
```

Each decision is `replace`, `create-copy`, or `skip`. `replace` requires the
literal `REPLACE_CONFIRMED` acknowledgement. **Success `200`:**

```json
{
  "restored": [{ "profileId": "self", "decision": "replace", "success": true }],
  "activeProfileId": "self"
}
```

Entries restored as copies include `newProfileId`. The service rejects a
concurrent restore with `409 RESTORE_IN_PROGRESS` and returns `400
DECRYPT_FAILED` for an incorrect passphrase or corrupt encrypted payload.

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

### Get biological-age report

```text
GET /api/biological-age
```

Authenticated, owner-only. **Success `200`:** `BiologicalAgeReport`, calculated
from the active profile's available source measurements. A report can include
limitations when the available data is insufficient; it is not a diagnosis.

### Get measurement chart data

```text
GET /api/summary/:measurementCode/chart?range=all|1y|3m|1m&mode=auto|raw
```

Authenticated, owner-only. `range` and `mode` are optional and default through
the shared chart query schema. **Success `200`:** `HealthDataChartSeries`,
including the selected measurement, unit, source samples, and chart points.

### Set or clear a personal reference range

```text
PUT    /api/summary/:measurementCode/reference-range
DELETE /api/summary/:measurementCode/reference-range
```

Authenticated, owner-only. `PUT` accepts a strict body with a required `unit`
and at least one finite bound:

```json
{ "low": 70, "high": 99, "unit": "mg/dL" }
```

When both bounds are supplied, `low` must not exceed `high`. Both methods return
`ReferenceRangeState` for the measurement after the mutation.

## Care

Care endpoints are authenticated. Companion credentials with the relevant Care
capability are restricted to their assigned profile; owner credentials use the
active profile. List endpoints return a strict paginated envelope:

```json
{ "items": [], "total": 0, "offset": 0, "limit": 20, "hasMore": false }
```

### Health events

```text
GET    /api/care/health-events
POST   /api/care/health-events
PATCH  /api/care/health-events/:id
DELETE /api/care/health-events/:id
```

The list accepts `limit` (1-100, default 20), `offset`, `search`, `kind`,
`status`, `occurredFrom`, `occurredTo`, and `includeId`. Create and update use a
strict body containing `kind`, `status`, and `occurredAt`, with optional
`provider` and `notes`. `occurredAt` is the event's single Date timestamp.
Timestamps are ISO 8601 with an offset. Create returns `201`; update returns `200`;
both return `HealthEventMutationResponse`. Deleting returns
`DeleteHealthEventResponse`, `404 HEALTH_EVENT_NOT_FOUND` when absent, or `409
CARE_HEALTH_EVENT_LINK_CONFLICT` when linked care items prevent deletion.

### Care items

```text
GET    /api/care/items
POST   /api/care/items
PATCH  /api/care/items/:id
POST   /api/care/items/:id/complete
DELETE /api/care/items/:id
```

The list accepts `limit` (1-100, default 20), `offset`, `search`, `kind`, `status`,
`priority`, `dueFrom`, `dueTo`, and `includeId`. Create and update use a strict
body with `title`, `kind`, `priority`, and `status`; optional due/reminder
timestamps and notes are supported. `dueStart` is the single Due Date timestamp.
`reminderAt` is independent: it may be omitted or set before, on, or after the
due date, and does not require a due date. Create returns `201`; update returns
`200`; both return `CareItemMutationResponse`.

Callers cannot create a completed item or transition an item to `completed`
through the generic create/update endpoints. `POST /api/care/items/:id/complete`
accepts the strict body `{ "occurredAt": "<ISO timestamp>", "kind": "<health event kind>" }`.
It atomically creates a completed manual-entry Health Event, marks the open care
item completed at the same timestamp, stores the internal completion link, and
returns `CompleteCareItemResponse`. Completion provenance is returned as
`completedHealthEventId` / `completedHealthEvent` but is not caller-authored.
Edits to a completed item preserve its completed status, timestamp, and link.
Missing items return `404 CARE_ITEM_NOT_FOUND`; completing a completed,
cancelled, or skipped item returns `409 CARE_ITEM_NOT_OPEN`. Delete returns
`DeleteCareItemResponse` or `404 CARE_ITEM_NOT_FOUND`.

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
    "sourceImport": { "attempted": 1, "accepted": 1, "duplicates": 0, "rejected": 0 },
    "dataSource": { "attempted": 1, "accepted": 1, "duplicates": 0, "rejected": 0 },
    "observations": { "attempted": 2, "accepted": 2, "duplicates": 0, "rejected": 0 },
    "observationGroups": { "attempted": 1, "accepted": 1, "duplicates": 0, "rejected": 0 },
    "timeSeriesSamples": { "attempted": 0, "accepted": 0, "duplicates": 0, "rejected": 0 },
    "activitySessions": { "attempted": 0, "accepted": 0, "duplicates": 0, "rejected": 0 }
  }
}
```

`accepted` and `duplicates` describe committed database effects, including duplicates within the submitted batch and records already stored. `rejected` counts rows dropped because their unit could not be reconciled with the measurement registry; the reasons are appended to the import's `diagnostics`. Imports never remove previously stored records. Raw source content is retained locally but omitted from API responses. Some commit endpoints also include `analyticsStorage` aggregate counts.

### Import lab test PDF
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

### Start a chunked Health Connect sync session *(companion only)*
```
POST /api/import/health-connect/sessions
```
**Request body:** `{ "protocolVersion", "sessionKey", "deviceLabel", "rangeStart", "rangeEnd", "profileId"? }`
**Success `201`:** `{ "protocolVersion", "sessionId", "processedBatchIds" }`

Sessions are idempotent on `(pairing, sessionKey)`. Replaying a key returns the same `sessionId`
plus every batch already applied, so an interrupted phone resumes instead of re-uploading a full
window. A `protocolVersion` this PC cannot serve returns `409 SYNC_PROTOCOL_UNSUPPORTED`.

### Upload one sync chunk *(companion only)*
```
POST /api/import/health-connect/sessions/:sessionId/chunks
```
**Request body:** the Health Connect import body plus `{ "protocolVersion", "sessionId", "batchId" }`
**Success `201`:** `{ "protocolVersion", "sessionId", "batchId", "counts": { "accepted", "duplicates", "rejected" } }`

The chunk is applied in a single transaction with its acknowledgement, so a replayed `batchId`
returns the original counts without importing twice. A `sessionId` in the path that disagrees with
the body returns `400`; a session unknown to this pairing returns `404`.

---

## Query / AI

Endpoints in this section return `x-vitana-lifecycle` to identify their compatibility commitment. Supported endpoints are part of the product API; experimental endpoints are diagnostic or fallback paths and can change without a compatibility guarantee.

### AI query *(supported)*
```
POST /api/query/ai
```
**Request body:** `{ "question": "<text>", "timezone"?: "<IANA timezone>", "debug"?: false }`
**Success `200`:** `{ "outcome", "question", "answer", "limitations", "assumptions", "confidence", "plan", "sourceResolved", "intentResolved", "sql", "resolvedTimeRange", "rowCount", "rows", "chart", "model", "debug"? }`

Runs the product's validated DSL-to-SQL pipeline for metrics, activities, health events, or care items. Queries are single-source, SELECT-only, capped at 200 rows and 366 days, and restricted to whitelisted projection views and columns. See the README for supported query classes and examples.

`outcome` is `answered` or `no_data`. A valid query with no matching rows remains a `200` response. Model-controlled JSON, schema, semantic, or DSL compilation failures receive at most one repair call. SQL safety and execution failures are never sent back to the model for repair.

AI query errors add `suggestions`, optional `suggestedRephrase`, and optional `diagnostics` when the request uses `debug: true`. Diagnostics may include failure category, attempt count, repair status, structured-output mode, and timings. They do not include raw model responses, health result rows, or credentials.

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
| `QUERY_NOT_UNDERSTOOD` | 422 | Question could not be converted to a valid query plan after one repair |
| `QUERY_UNSUPPORTED` | 422 | Question asks for a query class the compiler does not support |
| `MODEL_UNAVAILABLE` | 502 | Configured model could not be reached or did not return output |
| `MODEL_TIMEOUT` | 504 | Configured model exceeded its request timeout |
| `QUERY_EXECUTION_FAILED` | 500 | Compiler safety validation or database execution failed |
| `AUTH_REQUIRED` | 401 | No valid ****** provided |
| `CAPABILITY_REQUIRED` | 403 | Companion lacks access to this operation |
| `PROFILE_ACCESS_DENIED` | 403 | Companion profile grant does not match request |
| `OWNER_REQUIRED` | 403 | Backup or owner-only operation was attempted without owner access |
| `AUTH_LOOPBACK_ONLY` | 403 | Endpoint only accessible from loopback (127.x) |
| `PAIRING_CODE_INVALID` | 400 | Pairing code missing or expired |
| `PAIRING_SECRET_REQUIRED` | 400 | VITANA_SECRET not configured |
| `PAIRING_NOT_FOUND` | 404 | Pairing request ID not found |
| `DEVICE_NOT_FOUND` | 404 | Device pairing not found |
| `OBSERVATION_NOT_FOUND` | 404 | Observation ID not found |
| `HEALTH_EVENT_NOT_FOUND` | 404 | Health event ID not found |
| `CARE_ITEM_NOT_FOUND` | 404 | Care item ID not found |
| `CARE_ITEM_NOT_OPEN` | 409 | Care item completion was requested for a completed, cancelled, or skipped item |
| `CARE_HEALTH_EVENT_LINK_CONFLICT` | 409 | Health event cannot be deleted while linked care items exist |
| `DECRYPT_FAILED` | 400 | Backup passphrase was incorrect or the encrypted backup is corrupt |
| `RESTORE_IN_PROGRESS` | 409 | Another backup restore currently owns the restore lock |
| `MAINTENANCE_MODE` | 503 | A restore temporarily blocks non-health API requests |
| `DESKTOP_RUNTIME_UNSUPPORTED` | 501 | The host does not provide desktop runtime settings |
| `DESKTOP_UPDATES_UNSUPPORTED` | 501 | The host does not provide desktop updates |
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
