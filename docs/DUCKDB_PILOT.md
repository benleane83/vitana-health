# Encrypted DuckDB Windows Pilot

This runbook applies only to the opt-in Windows x64 encrypted DuckDB pilot. JSON remains the default storage backend. macOS and Linux are not approved.

## Safety boundary

- Stop the application and make an independent backup before activation.
- Validate a copied data directory first. Do not point automated validation at the repository `data/` directory or an installed application's live data directory.
- Keep the retained encrypted JSON files and `storage-backend.json` together for the entire pilot.
- Do not edit, replace, or restore an individual retained JSON file while DuckDB is active.
- Rollback intentionally discards every change made after DuckDB activation.

The pinned Windows x64 DuckDB 1.4.4 `httpfs` extension must have SHA-256 `21eea4547cf5aa5231f4838906e8935067c956f56a5efd09035a51189af8a77b`.

The application activation path uses a bounded 256 MiB DuckDB allocator so large retained imports can be hydrated. The isolated benchmark harness remains constrained to its 64 MiB default.

## Activation

Use a dedicated PowerShell session so the feature flag applies only to the pilot launch:

```powershell
$env:LFA_STORAGE_BACKEND = "duckdb"
& "C:\Program Files\Local Fitness Advisor\Local Fitness Advisor.exe"
```

The packaged host supplies the pinned extension path and unwraps the database key through Electron `safeStorage`. Activation must stop without promotion if the extension, key, source hash, schema, or canonical parity check fails.

After activation, confirm the application opens the expected profile and that `storage-backend.json`, `duckdb-storage\databases\`, and `storage-pilot.ndjson` exist in the application data directory. Do not delete the retained `health-store-*.enc` files.

## Soak checks

Use an initial seven-day opt-in soak. Exercise normal reads plus at least one representative import, profile update, export, observation deletion, clean restart, and forced process restart.

The seven-day soak is deferred as of 2026-07-13 by owner decision and is not a prerequisite for the current local development cutover. This does not relax the stop conditions, retained-JSON requirement, rollback procedure, or Windows x64 platform boundary below.

Review `storage-pilot.ndjson` daily. It contains only timestamp, event code, backend, profile count, and duration. Expected codes are:

- `storage-duckdb-activated` once at initial promotion.
- `storage-duckdb-reopened` once per successful DuckDB startup.
- `storage-duckdb-rolled-back` only after an explicit rollback.

Stop the pilot on any unexpected empty profile, integrity or schema refusal, key unwrap failure, extension failure, repeated startup failure, missing retained JSON artifact, or unexplained data-count change. Preserve the application data directory and logs before investigation.

Promotion requires seven days without integrity, recovery, key-lifecycle, or parity regressions; successful clean and forced restarts; acceptable import behavior; and a completed rollback drill against a disposable copied data directory.

## Rollback

Rollback restores the exact JSON baseline retained at activation and permanently discards post-activation DuckDB changes. Stop the application, then launch once with both explicit values:

```powershell
$env:LFA_STORAGE_BACKEND = "json"
$env:LFA_DUCKDB_ROLLBACK = "discard-duckdb-changes"
& "C:\Program Files\Local Fitness Advisor\Local Fitness Advisor.exe"
```

Rollback verifies every retained file's SHA-256 and canonical baseline digest before atomically archiving `storage-backend.json`. If validation fails, it leaves the manifest active and stops.

After a successful JSON startup, close the application and clear the one-time acknowledgement before launching again:

```powershell
Remove-Item Env:LFA_DUCKDB_ROLLBACK
Remove-Item Env:LFA_STORAGE_BACKEND
```

Retain the timestamped `storage-backend.json.rolled-back-*` file and DuckDB directory until the rollback is reviewed. Do not reactivate from the old DuckDB database after JSON receives new writes.