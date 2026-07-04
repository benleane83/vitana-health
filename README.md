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

- Personal health data is stored locally under `data\health-store.enc`.
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

An Android MVP companion app lives at `/home/runner/work/local-fitness-advisor/local-fitness-advisor/apps/android-companion`.

It supports:

- Manual endpoint URL input
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

## Local Warehouse (DuckDB)

After importing data, build a query-friendly local warehouse:

```powershell
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4317/api/warehouse/rebuild" -ContentType "application/json" -Body "{}"
```

This creates `data\health-warehouse.duckdb` with normalized tables and daily/weekly metric views.

## Natural-language Query Endpoint

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
