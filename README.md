# Local Fitness Advisor

A local-first health analytics app for Android Health Connect sync, manual blood-test results, profile metrics, deterministic analytics, and guarded AI recommendations from a configurable model runtime.

## Stack

- Frontend: React + Vite
- API: Node.js + TypeScript + Express
- Storage: one encrypted DuckDB database per profile on Windows x64; retained encrypted JSON rollback architecture
- AI: optional local Ollama runtime or cloud OpenAI-compatible Responses API endpoint

## Quick start

```powershell
npm install
npm run dev
```

On Windows x64, the normal development command verifies the pinned, signed DuckDB extension and selects encrypted DuckDB. The API binds to `127.0.0.1:4317`, and the Vite UI runs on `127.0.0.1:5173`.

On first use, existing encrypted JSON profiles are parity-checked and imported into encrypted DuckDB databases. Later launches open those databases directly; retained JSON files are no longer required by runtime startup. New profiles are created directly in DuckDB. The API startup record reports whether startup performed initial migration or reopened canonical storage.

See [Encrypted DuckDB Architecture](docs/ENCRYPTED_DUCKDB_ARCHITECTURE.md) for migration, key lifecycle, and platform limits.

The API generates and persists its owner credential automatically. A browser running on the same computer obtains an `HttpOnly` local session, so users never copy or enter a token.

When the API is exposed to the LAN, it also creates and reuses a private TLS certificate under the application data directory. The pairing QR code carries the certificate's public-key fingerprint. The Android app uses that fingerprint for every request, so no certificate generation, trust-store installation, configuration-file editing, or command-line setup is required.

Environment overrides (`LFA_OWNER_TOKEN`, `LFA_TLS_KEY`, and `LFA_TLS_CERT`) remain available for development and managed deployments.

### Packaged desktop installer

Build the Windows installer with:

```powershell
npm run package:desktop
```

The installer packages the API and web UI, configures private-network firewall access, and stores generated credentials, certificates, and health data in the user's application-data directory. Opening Local Fitness Advisor starts the local service and web UI together.

For signing, verification, checksums, and the protected Windows release process, see the [Windows release runbook](docs/WINDOWS_RELEASE.md).

## Privacy model

- Personal health data is stored locally in one encrypted DuckDB database per profile. Encrypted `health-store-*.enc` files are retained as activation baselines for explicit rollback.
- Raw imports are stored inside the encrypted local store and are omitted from normal API responses.
- No external telemetry, cloud sync, or vendor data upload paths are implemented. Storage lifecycle events are recorded locally without profile data.
- The only optional off-device path is model prompt text when you configure a cloud model provider yourself.
- Cloud prompts are blocked until explicit cloud consent is recorded for the active profile.
- Prompt payloads are minimized to de-identified query evidence. Direct identifiers (for example profile identity, source labels, file names, import metadata, free-form notes, and raw import payloads) are excluded from cloud prompt serialization.
- If you use a cloud provider, you are responsible for that provider's data retention, logging, and compliance settings.
- Local model mode (for example Ollama) keeps all processing on-device.
- Set `LFA_SECRET` to control the encryption passphrase for standalone use. The packaged desktop wraps its generated key with the operating system through Electron `safeStorage`.
- The packaged desktop also wraps saved cloud-model API keys with Electron `safeStorage`; existing plaintext keys migrate when the desktop next opens them. A standalone API has no OS credential wrapper, so manually saved model keys remain in its mode-`0600` settings file; use environment variables where that persistence model is unsuitable.
- Owner authentication protects all API data and administration routes. Companion tokens can be revoked from the paired-device list.
- Pairing codes and polling secrets expire and are delivered through the owner-authenticated QR flow.

## Safety boundaries

The app generates wellness-oriented summaries and questions to discuss with a clinician. It does not diagnose conditions, prescribe treatment, recommend medication changes, or handle urgent medical concerns.

## Clinician PDF export

Use the **Export** tab to download a PDF for the active profile. It includes profile details, data totals, recent
measurements, flagged lab results and reference ranges, trends, and imported-source provenance. The report is a
non-diagnostic summary intended to support a conversation with a healthcare professional.

## Model Runtime Configuration

The API supports two model providers for insight generation.

### Option A: Local Ollama

```powershell
$env:LLM_PROVIDER = "ollama"
$env:OLLAMA_ENDPOINT = "http://127.0.0.1:11434/api/generate"
$env:OLLAMA_MODEL = "qwen3:14b"
$env:MODEL_TIMEOUT_MS = "90000"
```

### Option B: Supported cloud model API

```powershell
$env:LLM_PROVIDER = "openai"
$env:OPENAI_RESPONSES_ENDPOINT = "https://azureai-demo-ben.services.ai.azure.com/openai/v1/responses"
$env:OPENAI_MODEL = "gpt-5.4-mini"
$env:OPENAI_API_KEY = "<your-api-key>"
$env:MODEL_TIMEOUT_MS = "30000"
```

If `LLM_PROVIDER` is omitted and `OPENAI_RESPONSES_ENDPOINT` plus `OPENAI_API_KEY` are set, the API auto-selects `openai`.

Cloud endpoints are restricted to HTTPS on the official host families for OpenRouter, OpenAI, Anthropic, Azure AI Foundry, Azure OpenAI, and AWS Bedrock Runtime. Anthropic uses its native Messages API. Foundry/Azure use API-key authentication, and Bedrock is supported through its OpenAI-compatible runtime endpoint with a Bedrock API key. Changing endpoint origin requires entering the API key again; redirects and destinations resolving to local, private, link-local, metadata, or reserved addresses are rejected.

Check active runtime configuration:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:4317/api/health"
```

## Android Companion App (Expo / Health Connect)

An Android MVP companion app lives at `apps/android-companion`.

It supports:

- QR-based pairing with the local API
- Manual "Sync now" action
- Optional Health Connect category selection (none selected by default) and a 30–365 day initial sync window (30 days by default)
- POST to `POST /api/import/health-connect` on your local API

See the [Android privacy policy](docs/PRIVACY_POLICY.md), [Health Connect data inventory](docs/HEALTH_CONNECT_DATA_INVENTORY.md), and release declaration instructions in [docs/ANDROID_RELEASE.md](docs/ANDROID_RELEASE.md).

The API import pipeline uses deterministic IDs so re-running sync keeps existing records deduplicated.

### Build an APK for sideloading

```powershell
cd apps/android-companion
npm install
npx eas login
npx eas build --platform android --profile preview
```

For a direct-to-phone install flow (no manual APK download and no adb), open the build URL/QR on your Android phone and install from Expo's internal distribution page.

Recommended commands from the repo root:

```powershell
npm run build:android:preview -w apps/android-companion
```

After the first install on your phone, publish most code changes over-the-air (OTA) without rebuilding the APK:

```powershell
npm run update:preview -w apps/android-companion -- --message "sync improvements"
```

This publishes to the `preview` EAS Update channel configured in `apps/android-companion/eas.json`.

When to rebuild instead of OTA:

- Rebuild (`build:android:*`) for native-code, permissions, Expo config, SDK, or dependency changes that affect native binaries.
- Use OTA (`update:*`) for JavaScript/TypeScript/UI/business-logic changes.

Install the generated APK, scan the short-lived QR code in the web app, approve the request, then tap **Sync now**. QR pairing pins the phone to that desktop server automatically.

Preview and production builds require HTTPS. For a development client that intentionally permits HTTP:

```powershell
npx eas build --platform android --profile development
```

The development profile sets `LFA_ALLOW_CLEARTEXT=1`; other profiles explicitly disable cleartext. Device tokens are stored with Android secure storage, and production HTTPS requests verify the server identity scanned from the pairing QR code.

For Play Store AAB signing, versioning, EAS environment separation, testing, staged rollout, and rollback, follow [the Android production release runbook](docs/ANDROID_RELEASE.md).

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

## Local Analytics (DuckDB)

Encrypted DuckDB is both the canonical profile store and analytics engine on Windows x64. Queries read the active encrypted profile directly through normalized tables and daily/weekly views.

Inspect the active analytics storage metadata and row counts with:

```powershell
Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:4317/api/analytics/storage"
```

The application does not create a separate plaintext analytics warehouse. JSON remains available as an explicit data export format, but it is not a runtime storage backend or profile migration source.

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
- Lab marker questions are not currently supported by the AI query endpoint; review lab results in the Labs and Summary views.

## Experimental Store-Grounded Query Fallback

`POST /api/query/ask-store` is an experimental diagnostic fallback for a warehouse that is unavailable or being refreshed. It is not used by the web app and may change or be removed without a compatibility guarantee.

```powershell
$body = @{ question = "What was my latest oxygen saturation?" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4317/api/query/ask-store" -ContentType "application/json" -Body $body
```

Current supported examples:

- "What was the last heart rate recorded?"
- "What was my latest oxygen saturation?"
