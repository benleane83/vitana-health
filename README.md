# Vitana Health

<p align="center">
  <img src="apps/branding/vitana-icon.svg" alt="Vitana Health logo" width="120" />
</p>

Vitana Health is a local-first app that helps families track and understand personal health data with encrypted per-profile storage, deterministic analytics, and optional guarded AI insights.

## What Vitana Health does

- Keeps health records local on your own computer by default.
- Supports separate family-member profiles, including children and pets.
- Syncs Android Health Connect data and supports manual observations.
- Generates trend summaries and wellness-oriented questions to discuss with a clinician.
- Exports a clinician-ready, non-diagnostic PDF for the active profile.

## Privacy model

- Your health data stays on your own computer by default.
- Each family profile has its own encrypted local data store.
- Imported files and raw records stay inside that encrypted store.
- Vitana does not send analytics telemetry, sync your data to the cloud, or upload your records to vendor services.
- AI is optional. If you connect a cloud AI provider, only the minimum text needed for the question is sent.
- Cloud AI is blocked until you explicitly allow it for the active profile.
- Identifying details (such as profile identity, source names, file names, import metadata, notes, and raw payloads) are excluded from cloud prompt data.
- If you use a cloud provider, their retention and logging rules are controlled by that provider account.
- Local AI mode keeps processing on-device.
- Desktop app keys (including cloud API keys) are protected by your operating system when available.
- API access is protected by owner authentication, and companion-device access can be revoked.
- Pairing codes and polling secrets are short-lived and expire automatically.

## Safety boundaries

Vitana Health generates wellness-oriented summaries and questions to discuss with a clinician. It does not diagnose conditions, prescribe treatment, recommend medication changes, or handle urgent medical concerns.

## Clinician PDF export

Use the **Export** tab to download a PDF for the active profile. It includes profile details, data totals, recent measurements, flagged lab results and reference ranges, trends, and imported-source provenance. The report is a non-diagnostic summary intended to support a conversation with a healthcare professional.

## Android companion app

The Vitana Android companion app lives at `apps/android-companion`.

It supports:

- QR-based pairing with your PC
- Dashboard totals and latest metrics for the paired profile
- Tracking of health measurements and trends
- Manual Activity, Body, and Lab observations
- Camera/gallery report capture with OCR, editable row review, and approved-row commit
- Manual "Sync now" for Health Connect, with category selection and 30-365 day initial sync window (30 days by default)

Dashboard, Track, and Care data are retained in an encrypted read-only phone replica for immediate and offline viewing. The phone refreshes that replica from the paired PC in the background and when the user pulls to refresh. Unpairing removes the downloaded replica. Report images and OCR drafts remain in memory only and are cleared after commit, cancellation, disconnect, or app backgrounding. OCR, parsing, and the authoritative Connected health-data store remain on the paired PC.

See the [Android privacy policy](docs/PRIVACY_POLICY.md), [Health Connect data inventory](docs/HEALTH_CONNECT_DATA_INVENTORY.md), and release declaration instructions in [Android release](docs/ANDROID_RELEASE.md).

The API import pipeline uses deterministic IDs so re-running sync keeps existing records deduplicated.

## AI insights

Vitana Health includes an AI-assisted natural-language query endpoint (`/api/query/ai`) that uses a DSL-to-SQL compiler pipeline with validation and safety guardrails.

- Endpoint contract: [API contract](docs/API_CONTRACT.md)
- Deep dive (architecture, request/response, guardrails, limitations): [AI query guide](docs/AI_QUERY.md)

## Development

### Stack

- Frontend: React + Vite
- API: Node.js + TypeScript + Express
- Storage: one encrypted DuckDB database per profile on Windows x64
- AI: optional local Ollama runtime or cloud OpenAI-compatible Responses API endpoint

### Quick start

```powershell
npm install
npm run dev
```

On Windows x64, the normal development command verifies the pinned, signed DuckDB extension and selects encrypted DuckDB. The API binds to `127.0.0.1:4317`, and the Vite UI runs on `127.0.0.1:5173`.

On first use, the app creates its initial profile directly in an encrypted DuckDB database. Additional family-member profiles, including children and pets, receive separate encrypted databases. Runtime startup opens these canonical databases directly and does not load or migrate legacy JSON profiles.

See [Encrypted DuckDB architecture](docs/ENCRYPTED_DUCKDB_ARCHITECTURE.md) for initialization, key lifecycle, and platform limits.

The API generates and persists its owner credential automatically. A browser running on the same computer obtains an `HttpOnly` local session, so users never copy or enter a token.

When the API is exposed to the LAN, it also creates and reuses a private TLS certificate under the application data directory. The pairing QR code carries the certificate's public-key fingerprint. The Android app uses that fingerprint for every request, so no certificate generation, trust-store installation, configuration-file editing, or command-line setup is required.

Environment overrides (`VITANA_OWNER_TOKEN`, `VITANA_TLS_KEY`, and `VITANA_TLS_CERT`) remain available for development and managed deployments.

### Packaged desktop installer

Build the Windows installer with:

```powershell
npm run package:desktop
```

The installer packages the API and web UI, configures private-network firewall access, and stores generated credentials, certificates, and health data in the user's application-data directory. Opening Vitana Health starts the local service and web UI together.

For signing, verification, checksums, and the protected Windows release process, see the [Windows release runbook](docs/WINDOWS_RELEASE.md).

The packaged desktop can remain available for companion sync after its window closes. In **Settings > App**, enable **Keep the service running in the background**. This opt-in setting also starts the app hidden at user login. Reopen it from the tray or Start menu, and use **Quit** in the tray menu to stop the API completely. Disabling the setting removes login startup and restores foreground-only behavior, where closing the window stops companion access.

### Model runtime configuration

The API supports two model providers for insight generation.

#### Option A: Local Ollama

```powershell
$env:LLM_PROVIDER = "ollama"
$env:OLLAMA_ENDPOINT = "http://127.0.0.1:11434/api/generate"
$env:OLLAMA_MODEL = "qwen3:14b"
$env:MODEL_TIMEOUT_MS = "90000"
```

#### Option B: Supported cloud model API

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

### Local analytics (DuckDB)

Encrypted DuckDB is both the canonical profile store and analytics engine on Windows x64. Queries read the active encrypted profile directly through normalized tables and daily/weekly views.

Inspect the active analytics storage metadata and row counts with:

```powershell
Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:4317/api/analytics/storage"
```

The application does not create a separate plaintext analytics warehouse. JSON remains available as an explicit data export format, but it is not a runtime storage backend or profile migration source.

### Android companion development and release

#### Preview the companion on Windows

Use the watcher-free Expo Web preview before publishing an EAS Update:

```powershell
npm run preview:web -w apps/android-companion
```

Open `http://127.0.0.1:8082` and use the browser's responsive device toolbar to test phone-sized layouts. The command creates a fresh static export before serving it, avoiding Metro's unreliable recursive file watcher on Windows mapped drives. Restart the command after source changes to rebuild the preview.

For hot reload on a local drive or a system with Watchman, use `npm run web -w apps/android-companion` instead.

For a deterministic preview that starts with read-only sample data and does not require a paired PC:

```powershell
npm run preview:mobile:demo
```

After starting the mobile demo:

1. Wait for Expo to report that the web bundle is ready.
2. Run `npm run preview:mobile:health` in another terminal.
3. Open `http://127.0.0.1:8082`.

For the PC app, run `npm run dev`, then use `npm run dev:health` to verify its API and web UI before browser inspection.

This is a rendering preview rather than a second companion client. The Android pairing flow is unchanged, and camera capture, Health Connect, native secure storage, certificate pinning, and Android permission behavior still require an Android development or preview build. Use the web preview for navigation, layout, forms, dashboard and Track presentation, loading states, and other platform-neutral UI work.

#### Build an APK for sideloading

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

The development profile sets `VITANA_ALLOW_CLEARTEXT=1`; other profiles explicitly disable cleartext. Device tokens are stored with Android secure storage, and production HTTPS requests verify the server identity scanned from the pairing QR code.

For Play Store AAB signing, versioning, EAS environment separation, testing, staged rollout, and rollback, follow [the Android production release runbook](docs/ANDROID_RELEASE.md).

#### Health Connect import endpoint

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

## License

Copyright 2026 Ben Leane. Vitana Health is source-available under the
[Elastic License 2.0](LICENSE) (`Elastic-2.0`). It is not licensed as Open Source
under the Open Source Initiative definition. The terms in [LICENSE](LICENSE)
govern use, copying, modification, and distribution.
