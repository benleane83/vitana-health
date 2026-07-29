# Encrypted DuckDB Architecture

## Decision

Vitana Health uses one encrypted DuckDB database per profile as the Windows x64 data architecture. The same database is the canonical health store and analytics engine.

DuckDB is the only runtime backend. Existing encrypted JSON profiles are not loaded or migrated by the application. JSON is available only as an explicit export format for future backup and restore work.

## Storage layout

Each profile has:

- `duckdb-storage/databases/health-store-<profile-id>.duckdb`: canonical AES-256-GCM DuckDB database.
- One entry in `storage-backend.json`, containing the profile ID and database filename.

`profiles.json` and `active-profile.json` remain small routing metadata files. Profile databases contain normalized imports, sources, devices, measurement types, observations, groups, time-series samples, activities, insights, and audit events. Daily and weekly analytics views are compiled into the encrypted schema.

## Initialization and reopen

Initial startup:

1. Verify Windows x64 and the pinned core-signed DuckDB `httpfs` extension.
2. Sweep temp files left by processes that are no longer running (see "Temporary files" below).
3. Create an empty encrypted `self` profile directly in DuckDB.
4. Write `storage-backend.json`, `profiles.json`, and `active-profile.json`.

Startup fails closed if the extension, key, manifest, schema, profile identity, or manifest-listed database is invalid. Reopen reads canonical encrypted databases directly and never consults legacy JSON files.

Profile creation builds an empty in-memory seed, hydrates the encrypted database atomically, and then publishes registry and manifest metadata. It does not create an encrypted JSON store. Profile deletion removes the profile from registry and manifest, closes the database, and removes its database files. Restart reconciliation uses the manifest and successfully opened databases as the committed profile set.

## Encryption and keys

DuckDB uses AES-256-GCM with encrypted temporary spill files. Writable encryption requires the explicitly bundled core-signed `httpfs` OpenSSL provider.

The DuckDB version and the approved extension digest are declared once, in `packages/shared/src/duckdbPin.ts`. The runtime verification (`profileStoreManager.ts`), the download/packaging step (`scripts/prepare-duckdb-httpfs.mjs`), and the npm dependency all derive from it, and `apps/desktop/package-config.test.cjs` fails the build if `apps/api` stops pinning the exact version. The dependency must not use a caret range: a digest is only valid for one DuckDB build, so a resolved patch upgrade would turn into a startup failure.

When bumping DuckDB, change `PINNED_DUCKDB_VERSION`, run the prepare script, and replace the digest with the one it reports.

## Temporary files

Atomic writes stage bytes in a sibling temp file and rename it into place, cleaning up in a `finally`. A hard kill skips that cleanup, and for database copies the orphans are full size. On open, `sweepOrphanedTempFiles` removes staged files whose embedded process ID is no longer running and which are older than five minutes. Three naming schemes are recognised: `<name>.tmp-<pid>-<timestamp>[-<hex>]`, `<name>.<pid>.<hex>.tmp`, and `<name>.hydrating-<pid>-<hex>`.

The desktop generates a random 256-bit data key, wraps it with Electron `safeStorage`, and persists only the wrapped blob. The unwrapped passphrase is injected into the in-process API. A profile-specific database key is derived with a versioned SHA-256 domain separator and the profile ID. Packaged desktop model API keys use the same OS-backed storage: `ai-settings.json` contains a wrapped key blob rather than the plaintext key. Opening a legacy desktop settings file with a plaintext key migrates it atomically on first read.

Standalone production API use requires `VITANA_SECRET`. It does not have Electron's OS credential wrapper, so manually saved model API keys remain in the mode-`0600` `ai-settings.json` file; environment-provided keys are not written there. A standalone server cannot open a desktop-wrapped model credential and fails closed rather than falling back to a default model configuration. Generated plaintext `local.key` material remains a development/test fallback only.

## Analytics

DuckDB mode executes compiled, SELECT-only queries directly against the active encrypted profile. Import and mutation responses report `encrypted-profile:<profile-id>` and do not build a second warehouse.

The legacy warehouse implementation remains only for migration-era tests and is not reachable from supported runtime startup.

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

The on-disk root marker `.vitana-duckdb-poc`, metadata table `poc_metadata`, and attached catalog alias `poc` are intentionally preserved so databases created during the validated activation can reopen without migration risk. They are compatibility identifiers, not current product status.

Current approval is Windows x64 only. macOS and Linux require platform-specific extension pins, packaged runtime validation, and secure-keyring policy before enablement. A longer soak and bulk-ingestion redesign remain deferred; the current implementation uses a bounded 256 MiB DuckDB memory limit and bounded insert payloads.
