# Encrypted DuckDB Architecture

## Decision

Local Fitness Advisor uses one encrypted DuckDB database per profile as the primary Windows x64 data architecture. The same database is the canonical health store and analytics engine. It replaces whole-store encrypted JSON rewrites and the derived plaintext analytics warehouse during normal operation.

The standalone API retains JSON as its conservative default because macOS and Linux packaging have not been approved. The supported Windows development and packaged desktop hosts select DuckDB explicitly. JSON remains available as a baseline-backed rollback mode, not as synchronized failover.

## Storage layout

Each profile has:

- `duckdb-storage/databases/health-store-<profile-id>.duckdb`: canonical AES-256-GCM DuckDB database.
- `health-store-<profile-id>.enc`: encrypted JSON snapshot retained at activation or profile creation for rollback.
- One entry in `storage-backend.json`, containing the source hash, canonical baseline digest, and database filename.

`profiles.json` and `active-profile.json` remain small routing metadata files. Profile databases contain normalized imports, sources, devices, measurement types, observations, groups, time-series samples, activities, insights, and audit events. Daily and weekly analytics views are compiled into the encrypted schema.

Successful DuckDB activation removes legacy `health-warehouse*.duckdb` and WAL artifacts. JSON mode may recreate the derived warehouse after an explicit rollback.

## Activation and reopen

Initial activation is side by side:

1. Verify Windows x64 and the pinned core-signed DuckDB 1.4.4 `httpfs` extension.
2. Read each encrypted JSON source without modifying it.
3. Hydrate a temporary encrypted DuckDB database.
4. Compare the complete canonical digest after round trip.
5. Recheck the source-file SHA-256.
6. Atomically promote the database and write `storage-backend.json`.

Startup fails closed if the extension, key, source hash, manifest, schema, or profile identity is invalid. Reopen validates every retained baseline before opening its corresponding encrypted database.

Profile creation while DuckDB is active creates a new encrypted JSON rollback baseline, hydrates the encrypted database, and then publishes registry and manifest metadata. Profile deletion removes the profile from registry and manifest, closes the database, and removes both storage representations. Restart reconciliation uses the manifest and successfully opened databases as the committed profile set.

## Encryption and keys

DuckDB uses AES-256-GCM with encrypted temporary spill files. Writable encryption requires the explicitly bundled core-signed `httpfs` OpenSSL provider. The approved Windows x64 extension SHA-256 is:

`21eea4547cf5aa5231f4838906e8935067c956f56a5efd09035a51189af8a77b`

The desktop generates a random 256-bit data key, wraps it with Electron `safeStorage`, and persists only the wrapped blob. The unwrapped passphrase is injected into the in-process API. A profile-specific database key is derived with a versioned SHA-256 domain separator and the profile ID. Packaged desktop model API keys use the same OS-backed storage: `ai-settings.json` contains a wrapped key blob rather than the plaintext key. Opening a legacy desktop settings file with a plaintext key migrates it atomically on first read.

Standalone production API use requires `LFA_SECRET`. It does not have Electron's OS credential wrapper, so manually saved model API keys remain in the mode-`0600` `ai-settings.json` file; environment-provided keys are not written there. A standalone server cannot open a desktop-wrapped model credential and fails closed rather than falling back to a default model configuration. Generated plaintext `local.key` material remains a development/test fallback only.

## Analytics

DuckDB mode executes compiled, SELECT-only queries directly against the active encrypted profile. Import and mutation responses report `encrypted-profile:<profile-id>` and do not build a second warehouse.

JSON fallback retains the existing warehouse implementation behind the analytics backend adapter. This isolates fallback behavior without permanent dual writes.

## Rollback

Rollback is explicit and destructive. It verifies every retained JSON file against both its stored SHA-256 and canonical activation digest, archives `storage-backend.json`, and starts JSON mode. All DuckDB changes made after each profile baseline was created are discarded.

For local development:

```powershell
npm run dev:rollback
```

For an installed desktop, stop the app and launch once with:

```powershell
$env:LFA_STORAGE_BACKEND = "json"
$env:LFA_DUCKDB_ROLLBACK = "discard-duckdb-changes"
& "C:\Program Files\Local Fitness Advisor\Local Fitness Advisor.exe"
```

Clear both environment variables after the rollback launch. Keep the archived manifest and DuckDB directory until the rollback is reviewed.

## Evidence

The retained experiment branch `copilot/evaluate-encrypted-duckdb-health-store` records the complete proof at commit `4ae71bd`. Validation on Windows x64 covered:

- Correct, missing, and wrong encryption keys.
- Encrypted WAL and forced temporary spill behavior.
- Rejected-key database immutability.
- Complete `HealthStoreData` round-trip parity.
- Atomic hydration, schema migration, interrupted writes, and forced restart recovery.
- Side-by-side copied-data activation, reopen, mutation, and rollback.
- Live Ben Leane profile activation and UI/analytics smoke testing.
- Packaged Electron 43.1.0 loading of the DuckDB N-API v6 binding.

The production branch retains behavior-protecting runtime, repository, activation, migration, recovery, key-lifecycle, analytics, and profile-lifecycle tests. It excludes synthetic benchmark workers, copied-data harnesses, standalone proof CLI/package configuration, and the raw experiment journal; those remain on the experiment branch.

## Compatibility and limits

The on-disk root marker `.lfa-duckdb-poc`, metadata table `poc_metadata`, and attached catalog alias `poc` are intentionally preserved so databases created during the validated activation can reopen without migration risk. They are compatibility identifiers, not current product status.

Current approval is Windows x64 only. macOS and Linux require platform-specific extension pins, packaged runtime validation, and secure-keyring policy before enablement. A longer soak and bulk-ingestion redesign remain deferred; the current implementation uses a bounded 256 MiB DuckDB memory limit and bounded insert payloads.
