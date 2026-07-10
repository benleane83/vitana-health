# Local Fitness Advisor

A local-first health analytics app for Samsung Health exports, manual blood-test results, profile metrics, deterministic analytics, and guarded AI recommendations from a configurable model runtime.

## Stack

- Frontend: React + Vite
- API: Node.js + TypeScript + Express
- Storage: encrypted local JSON store with a file-vault style envelope
- AI: optional local Ollama runtime or cloud OpenAI-compatible Responses API endpoint

## Quick start

```powershell
npm install
npm run dev
```

The API binds to `127.0.0.1:4317` by default, and the Vite UI runs on `127.0.0.1:5173`.

To receive sync requests from an Android phone on your local network, start the API with:

```powershell
$env:HOST = "0.0.0.0"
npm run dev -w apps/api
```

## Privacy model

- Personal health data is stored locally in per-profile encrypted files: `data\health-store-<profileId>.enc`.
- Profile registry and active selection are stored locally in `data\profiles.json` and `data\active-profile.json`.
- Raw imports are stored inside the encrypted local store and are omitted from normal API responses.
- No telemetry, cloud sync, remote AI APIs, or vendor data upload paths are implemented.
- Set `LFA_SECRET` to control the encryption passphrase. If omitted, a generated local key is stored under `data\local.key`.

## Safety boundaries

The app generates wellness-oriented summaries and questions to discuss with a clinician. It does not diagnose conditions, prescribe treatment, recommend medication changes, or handle urgent medical concerns.

## Model Runtime Configuration

The API supports two model providers for insight generation and `/api/llm/simple` debugging.

### Option A: Local Ollama

```powershell
$env:LLM_PROVIDER = "ollama"
$env:OLLAMA_ENDPOINT = "http://127.0.0.1:11434/api/generate"
$env:OLLAMA_MODEL = "qwen3:14b"
$env:MODEL_TIMEOUT_MS = "90000"
```

### Option B: Azure Foundry / OpenAI Responses API

```powershell
$env:LLM_PROVIDER = "openai"
$env:OPENAI_RESPONSES_ENDPOINT = "https://azureai-demo-ben.services.ai.azure.com/openai/v1/responses"
$env:OPENAI_MODEL = "gpt-5.4-mini"
$env:OPENAI_API_KEY = "<your-api-key>"
$env:MODEL_TIMEOUT_MS = "30000"
```

If `LLM_PROVIDER` is omitted and `OPENAI_RESPONSES_ENDPOINT` plus `OPENAI_API_KEY` are set, the API auto-selects `openai`.

Check active runtime configuration:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:4317/api/health"
```

Quick model connectivity test:

```powershell
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4317/api/llm/simple" -ContentType "application/json" -Body '{"prompt":"Reply with exactly: model runtime ok"}'
```

## Samsung JSON Upload Import

If you place a full Samsung Health export folder under `data\uploads`, you can ingest it directly:

```powershell
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4317/api/import/samsung-json-upload" -ContentType "application/json" -Body "{}"
```

To target a specific folder explicitly:

```powershell
$body = @{ uploadPath = "Z:\repos\local-fitness-advisor\data\uploads\samsunghealth_ben.leane_20260702142947" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4317/api/import/samsung-json-upload" -ContentType "application/json" -Body $body
```

Current parser coverage includes Samsung JSON datasets for heart rate, oxygen saturation, HRV, movement activity level, pedometer day summary step bins, and exercise live-data heart-rate/speed samples.

## Android Companion App (Expo / Health Connect)

An Android MVP companion app lives at `apps/android-companion`.

It supports:

- Manual endpoint URL input
- Profile target selection (persisted locally on device)
- Manual "Sync now" action
- Last-30-days Health Connect read for steps, heart rate, oxygen saturation, HRV RMSSD, weight, and exercise sessions
- POST to `POST /api/import/health-connect` on your local API

The API import pipeline uses deterministic IDs so re-running sync keeps existing records deduplicated.

### Build an APK for sideloading

```powershell
cd apps/android-companion
npm install
npx eas login
npx eas build --platform android --profile preview
```

Install the generated APK on your phone, open the app, set your local endpoint URL (for example `http://192.168.1.20:4317`), then tap **Sync now**.

### Health Connect import endpoint

The companion app posts structured JSON to:

```text
POST /api/import/health-connect
```

You can also call it directly if needed:

```powershell
$body = @{
  profileId = "self"
  syncedAt = "2026-07-04T09:00:00.000Z"
  rangeStart = "2026-06-04T09:00:00.000Z"
  rangeEnd = "2026-07-04T09:00:00.000Z"
  deviceLabel = "android-companion"
  steps = @()
  heartRate = @()
  oxygenSaturation = @()
  hrvRmssd = @()
  weightKg = @()
  exerciseSessions = @()
} | ConvertTo-Json -Depth 6
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4317/api/import/health-connect" -ContentType "application/json" -Body $body
```

### Profile management endpoints

```text
GET    /api/profiles
POST   /api/profiles
GET    /api/profiles/active
PUT    /api/profiles/active
DELETE /api/profiles/:id
```

## Local Warehouse (DuckDB)

After importing data, build a query-friendly local warehouse:

```powershell
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4317/api/warehouse/rebuild" -ContentType "application/json" -Body "{}"
```

This creates `data\health-warehouse.duckdb` with normalized tables and daily/weekly metric views.

## AI-Powered Natural Language Query (`/api/query/ai`)

The AI query endpoint provides broad natural-language coverage over your local warehouse using a **DSL → SQL compiler pipeline** with safety guardrails.

### Architecture

```
question → AI DSL Planner → validate DSL (Zod) → compile to SQL → validate SQL → execute DuckDB → summarize answer
```

1. **AI DSL Planner** (`aiQueryPlanner.ts`) — prompts the configured model to return a strict JSON query DSL (not raw SQL), validated by Zod schema.
2. **DSL Compiler** (`queryCompiler.ts`) — maps the validated DSL to parameterized SQL templates only; no free-form SQL from the model.
3. **SQL Validator** — a separate safety pass denies disallowed tokens and non-whitelisted identifiers even though SQL is compiler-produced.
4. **DuckDB execution** — runs the validated query against your local warehouse.
5. **Answer summarization** — the model produces a one-sentence answer from the evidence rows.

### Request

```powershell
$body = @{ question = "average heart rate last month" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4317/api/query/ai" -ContentType "application/json" -Body $body
```

Optional fields: `timezone` (IANA string), `debug` (boolean, adds planner timing to response).

### Response fields

| Field | Description |
|---|---|
| `answer` | Natural-language answer from the model |
| `plan` | The structured DSL returned by the planner |
| `sql` | The compiler-produced SQL that was executed |
| `rows` | Up to 100 result rows |
| `chart` | Optional chart-ready series `{ type, series: [{label, value}] }` |
| `confidence` | Planner confidence score 0–1 |
| `limitations` | Any caveats or planner assumptions |
| `resolvedTimeRange` | The exact date range applied to the query |

### Supported query classes

- Time-series trends: `steps trend this week`, `daily heart rate last month`
- Aggregations: `average heart rate last month`, `total steps this month`
- Top-N: `max daily steps this month`, `top 10 step days`
- Latest reading: `latest heart rate`
- Activity summaries: `top exercises this month`

### Safety guardrails

- **SELECT-only**: Non-SELECT tokens (`DROP`, `DELETE`, `INSERT`, `UPDATE`, `CREATE`, etc.) are blocked at both compile and validate stages.
- **Table/column whitelist**: Only `v_daily_metrics`, `v_weekly_metrics`, and `activities` with their known columns are allowed.
- **Time window cap**: Maximum 366-day time window per query.
- **Row limit cap**: Maximum 200 rows per query.
- **Graceful fallback**: Unsupported questions return a clarifying limitations message and suggested rephrase rather than raw model output.

### Time semantics

Calendar month/week boundaries are resolved server-side before SQL compilation:

| Phrase | Resolved range |
|---|---|
| `this month` | First day to last day of current calendar month |
| `last month` | First day to last day of previous calendar month |
| `this week` | Monday to Sunday of current week |
| `last week` | Monday to Sunday of previous week |
| `last 30d` (default) | Rolling 30 days from today |

### Known limitations

- The AI planner requires a running model runtime (Ollama or OpenAI-compatible). If the model is unavailable, a graceful error with suggested rephrases is returned.
- Compound queries (e.g. "steps AND heart rate together") may be simplified to the first metric.
- Lab marker queries are not supported via the AI query endpoint; use the warehouse NL endpoint for those.



You can ask trend questions using a rule-based NL planner backed by DuckDB:

```powershell
$body = @{ question = "How have my steps and heart rate trended in the last month?" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4317/api/query/nl" -ContentType "application/json" -Body $body
```

Response includes the planned SQL, returned rows, and row count so you can render charts or summaries in your app.

## Data-grounded Ask Endpoint

You can ask supported plain-language questions and get a warehouse-grounded answer phrased by the configured model runtime.

```powershell
$body = @{ question = "What was the last heart rate recorded?" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4317/api/query/ask" -ContentType "application/json" -Body $body
```

Current supported example:

- Latest heart-rate observation (for example: "What was the last heart rate recorded?")

## Store-grounded Ask Endpoint

If your warehouse is still being refreshed, you can query directly from the live datastore snapshot:

```powershell
$body = @{ question = "What was my latest oxygen saturation?" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4317/api/query/ask-store" -ContentType "application/json" -Body $body
```

Current supported examples:

- "What was the last heart rate recorded?"
- "What was my latest oxygen saturation?"
