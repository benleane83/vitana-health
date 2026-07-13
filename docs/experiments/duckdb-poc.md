# Encrypted DuckDB Primary Store PoC

Status as of 2026-07-13: **Feature-gated Windows x64 productionization implemented, packaged, and activated for owner-authorized local development; soak deferred by owner decision**. The Windows x64 encryption, production installer, side-by-side activation, retained-JSON rollback, copied-data application validation, and local pilot telemetry paths are implemented. The original absolute import, setup-RSS, and forced-restart thresholds remain recorded below, but they are no longer release blockers after product review of their frequency, comparative behavior, and user impact.

## Scope and safety boundary

The isolated experiment follows GitHub Issue #45 and runs beneath a uniquely created, marked temporary root. Its databases, extension directory, temporary files, keys, and results are isolated from the application's live `data/` directory. The production activation path reads retained encrypted JSON sources for side-by-side hydration and parity validation but does not mutate, rename, delete, or replace those rollback artifacts.

The existing encrypted JSON store remains canonical for the isolated PoC. Productionization is a separate, feature-gated increment: it must build an encrypted DuckDB store side by side, prove canonical parity before activation, retain the original JSON artifact for rollback through the pilot, and never use permanent dual writes.

## Verified result

DuckDB 1.4.4 can create and reopen AES-256-GCM encrypted databases through the installed Node binding when the DuckDB core-signed `httpfs` extension is loaded explicitly. In this configuration, `httpfs` supplies the OpenSSL crypto provider; it is a local native runtime dependency and is not used for network access.

The following gates pass in both the API runtime and a packaged Electron 43.1.0 Windows x64 application:

1. The database does not contain the inserted unique plaintext marker.
2. Reopening with the correct 256-bit key returns the exact marker row.
3. Attaching without a key is rejected.
4. Attaching with an incorrect key is rejected.
5. A WAL is created during the test workload.
6. A constrained-memory external operation creates a temporary spill file.
7. Marker values and key material are absent from the database, WAL, and temporary spill artifacts inspected after close.
8. Missing-key and wrong-key attempts leave the database SHA-256 unchanged.

The final shared suite passes 53 tests, the full API suite passes 107 tests with 1 intentionally skipped, and the desktop secure-key suite passes 4 tests. Repository-wide TypeScript validation passes. The public API PoC command and packaged Electron PoC command pass all eight encryption gates.

## Extension supply-chain policy

The PoC stages a platform- and DuckDB-version-specific extension rather than relying on DuckDB's user extension cache or runtime installation.

| Property | Verified value |
| --- | --- |
| DuckDB version | `1.4.4` |
| Extension | `httpfs` |
| Platform | `windows_amd64` |
| SHA-256 | `21eea4547cf5aa5231f4838906e8935067c956f56a5efd09035a51189af8a77b` |
| Signature policy | DuckDB core-signed only; verified when loaded |
| Packaged location | `resources/duckdb-extensions/httpfs.duckdb_extension` |

Community extensions, unsigned extensions, automatic installation, and automatic loading are disabled. The extension is loaded from an explicit local path before the encrypted database is attached. External access is then disabled and the DuckDB configuration is locked.

Only the Windows x64 digest is currently pinned. macOS and Linux preparation must fail closed until authoritative digests are added and those platforms are tested.

## Runtime and packaging findings

- The published DuckDB binding uses N-API v6 and loaded directly in Electron 43.1.0 on Windows x64.
- The isolated Electron builder configuration uses `npmRebuild: false`; rebuilding DuckDB from source was unnecessary for this binding and made the proof slower and less reliable.
- Native `.node` files are ASAR-unpacked, while the extension is packaged as an external resource.
- The extension preparation step can stage and hash bytes outside Electron. Loading inside the target runtime performs the decisive signature and compatibility check.
- Windows holds active DuckDB, WAL, and spill files open more strictly than Unix-like systems. Leakage inspection therefore occurs after an explicit checkpoint, detach, connection close, and database close.

## Security configuration exercised

- AES-256-GCM with a random in-memory 256-bit key.
- A private, allowlisted temporary directory beneath the marked root.
- `temp_file_encryption = true`.
- One DuckDB thread, a 64 MB memory limit, and a 256 MB temporary-directory limit.
- Forced external execution to prove encrypted spill behavior.
- Explicit detach and close before artifact inspection.
- Refusal to create a PoC database outside the marked root.

The PoC key is still process memory in this phase. The first productionization increment now wraps a random per-install key with Electron `safeStorage`, injects the unwrapped key directly into `startServer()`, rejects unavailable secure storage and Linux `basic_text`, wraps an existing generated `local.key` during upgrade, and removes that plaintext legacy key only after the API successfully opens. Standalone production API startup requires `LFA_SECRET` unless a host injects an OS-secure key.

## Phase status

### Completed or substantially proven

- Standalone API module and CLI.
- Native encrypted create, checkpoint, reopen, correct-key, missing-key, and wrong-key behavior.
- WAL and encrypted temporary spill creation.
- Plaintext/key leakage checks for database, WAL, and temporary artifacts.
- Versioned schema experiment covering the current v2 collections plus schema-only medication, symptom, and stress event tables.
- Hermetic extension staging with a pinned Windows x64 digest.
- Packaged Electron 43.1.0 execution on Windows x64.
- A strictly read-only copied-store loader that preserves raw source content, performs v1 migration only in memory, rejects resolved paths outside `input-copy/`, and leaves input bytes unchanged on wrong-key or corrupted-copy failures.
- Transactional hydration and ordered export of a deterministic fixture containing every current v2 collection and optional field shape.
- Exact deep equality and deterministic SHA-256 content-digest parity after checkpoint, close, and correct-key reopen, including raw source content, explicit JSON `null`, and collection order that differs from ID order.
- Missing-database open refusal plus unchanged database hashes after wrong-key and truncated-copy read failures.
- Transactional profile replacement, import merge/deduplication and limits, insight insertion, individual observation deletion, and deletion by measurement code with parity to the current encrypted JSON repository semantics.
- Concurrent isolation of two encrypted profile databases, including distinct content, independent mutations, and reciprocal wrong-key refusal.
- Crash-safe initial hydration: the repository builds and validates a uniquely named temporary encrypted database, closes it, and atomically renames it to the canonical PoC path only after deterministic digest parity succeeds.
- Real child-process termination immediately before hydration promotion leaves no canonical database; a subsequent clean hydration succeeds.
- Real child-process termination after an observation delete begins but before transaction commit reopens to the exact pre-transaction snapshot.
- Schema version 2 adds `v_daily_metrics` and `v_weekly_metrics` using the current warehouse aggregation SQL, plus fixed typed repository reads with bound metric filtering rather than a raw-SQL escape hatch.
- Deterministic analytical tests cover observation averaging, daily step summation, UTC day boundaries, DuckDB's Monday week boundary, empty metric filters, and encrypted reopen behavior inherited from the repository suite.
- Fixed typed activity-list and grouped-count reads cover the remaining allowlisted query table with bound date parameters, inclusive compiler-compatible day cutoffs, explicit sorting, positive limits capped at 200 rows, and no arbitrary SQL exposure.
- Boundary tests cover `00:00:00` inclusion, the current compiler's `23:59:59` inclusion and sub-second exclusion, sparse optional activity values, grouped counts, sorting, limits, invalid dates, and reversed ranges.
- The legacy warehouse and encrypted PoC now import one canonical pair of daily/weekly view definitions. The warehouse's internal sample table was aligned to `time_series_samples`, eliminating schema-name and copied-SQL drift.
- PoC analytical bucketing is now explicitly UTC. Every encrypted PoC connection executes `SET TimeZone = 'UTC'` before configuration is locked, matching the current persisted timestamp and warehouse behavior without prematurely adding a profile time-zone field.
- Repository open now inspects `poc_metadata` and applies ordered schema migrations in one transaction. A synthetic encrypted version-1 database upgrades to version 2, exposes both analytical views, records metadata history `[1, 2]`, and reopens idempotently.
- The legacy warehouse Windows lock was traced to opening the file as DuckDB's primary database. Build and query paths now use an in-memory primary database, explicitly attach the warehouse, and detach it before close; transient insert statements are also finalized explicitly.
- The tightened warehouse test now requires the native DuckDB result and passes a build, read-only query, second atomic rebuild, backup verification, and second query without entering fallback.
- Direct daily and weekly analytical output parity now passes between the plaintext warehouse and encrypted repository over the same deterministic full-domain fixture.
- Existing encrypted databases with missing, empty/noncontiguous, or future schema metadata now fail closed during repository open. Focused tests confirm each refusal leaves the encrypted database SHA-256 unchanged.
- A deterministic seeded benchmark generator now emits schema-valid synthetic fixtures with exactly 10k, 100k, or 250k observations plus multiple measurement codes and bounded samples, activities, imports, sources, devices, groups, insights, and audit events. The 1M-observation diagnostic scale is also supported.
- A fresh-process benchmark harness now prepares isolated DuckDB and encrypted-JSON templates, runs one warm-up plus configurable measured runs for each engine/operation, and writes sanitized aggregate JSON and Markdown beneath the marked temporary root.
- The initial benchmark operation set covers cold open, daily/weekly analytics, full export, one-row insert, one-row delete, and delete-by-type. It captures median/p95 wall time, peak process RSS, storage bytes, record scale, seed, platform, architecture, Node version, DuckDB version, and run counts.
- A 100-observation, one-run non-blocking smoke execution completed all template, child-process, operation, aggregation, and report-writing paths. Its timings are protocol validation only and are not performance evidence.
- The bounded performance pass replaced row-at-a-time hydration with bounded multi-row statements and high-volume observation loads with bound-JSON expansion. Exact repository fidelity and crash tests remain green. At 10k observations, encrypted setup fell from 65.1 seconds before tuning to 5.2 seconds in the official run.
- Slim transactional observation insert/delete/delete-by-type primitives now prove ordinary DuckDB mutations without a full snapshot response or dataset rewrite. Existing compatibility methods and return contracts remain unchanged.
- Fixed typed latest-measurement and measurement-detail reads now cover the remaining routine-read scenarios without exposing arbitrary SQL.
- Profile-switch, clean-restart, and forced-restart measurements now run for both engines. Forced restart terminates a real child process; the DuckDB victim is paused inside an uncommitted delete before termination, and recovery timing includes reopen, typed read, and close.

The focused repository behavior suite passes 12 of 12 tests on Windows x64 with the prepared signed extension. The focused warehouse lifecycle and analytical parity suite passes 2 of 2 without fallback. The deterministic benchmark fixture suite passes 2 of 2.

### Phase 3 benchmark evidence

The first official 10k-observation matrix completed on Windows x64 with seed 45, one warm-up, five measured fresh-process runs, Node 22.14.0, and DuckDB 1.4.4. Values below are sanitized aggregates; raw per-run artifacts remained beneath the marked OS temporary root and were not committed.

| Operation | DuckDB median / p95 | JSON + current warehouse median / p95 |
| --- | ---: | ---: |
| Cold open | 382.56 / 387.13 ms | 348.42 / 372.41 ms |
| Daily + weekly | 35.69 / 39.58 ms | 4,433.13 / 5,128.38 ms |
| Latest measurement | 9.36 / 11.38 ms | 36.18 / 42.75 ms |
| Detail query | 22.16 / 24.70 ms | 35.82 / 38.18 ms |
| 100k observation import | 10,153.54 / 12,108.19 ms | 2,803.41 / 3,066.81 ms |
| Full export | 503.74 / 623.88 ms | 490.98 / 500.14 ms |
| One-row core insert | 33.85 / 36.07 ms | 504.60 / 509.11 ms |
| One-row core delete | 29.11 / 29.95 ms | 503.23 / 511.66 ms |
| Delete by type | 77.87 / 92.26 ms | 493.99 / 511.12 ms |

Encrypted DuckDB setup used 9,711,616 bytes; the current encrypted JSON plus warehouse setup used 8,042,164 bytes at this small scale. Both reported exactly 10,000 observations. The highest DuckDB peak RSS in the matrix was 234,450,944 bytes during the 100k import; the current JSON import peaked at 533,389,312 bytes.

These are not blocking gate results because the gates apply at 250k observations. They establish that reads and slim mutations have substantial margin, while the 100k import currently misses the eventual 10-second p95 gate by 2.11 seconds and needs explicit attention before a final go decision.

The initial 100-row import configuration subsequently produced malformed native `DUCKDB_NODEJS_ERROR` failures intermittently during two official 100k matrices, even though the exact failed artifact succeeded when rerun alone with matching count and digest. A bounded chunk study found:

| Bound JSON rows per statement | Stability result | Observed import duration |
| ---: | --- | ---: |
| 100 | Intermittent failure across repeated matrices | 10.15-second median in the completed 10k matrix |
| 75 | Failed immediately with the same malformed native error | Not usable |
| 60 | 6 of 6 isolated 100k imports passed with identical digest | 13.09-14.78 seconds |
| 50 | 6 of 6 isolated 100k imports passed with identical digest | 14.94-18.72 seconds |

The 60-row configuration later failed in the first measured import of the initial blocking 250k matrix, and that exact failed artifact again succeeded when rerun alone with matching count and digest. The PoC therefore reverted to the more conservative 50-row point. It does not retry failed imports or select an unstable chunk merely to improve the benchmark. This makes both import reliability and the 10-second import gate open risks under the locked 64 MiB DuckDB memory limit.

A deterministic multi-row parameter fallback was also tested at 50 and 200 observations per statement. Both preserved exact count and digest but took 48.91 and 47.42 seconds respectively for 100k observations, so that path was rejected as non-viable rather than used to conceal the native JSON-binding instability.

The official 100k-observation matrix then completed with the stable 60-row configuration, one warm-up, and five fresh-process measurements:

| Operation | DuckDB median / p95 | JSON + current warehouse median / p95 |
| --- | ---: | ---: |
| Cold open | 364.93 / 374.84 ms | 1,309.23 / 1,437.69 ms |
| Profile switch | 343.58 / 386.69 ms | 1,425.59 / 1,445.60 ms |
| Clean restart (pre-correction) | 3,485.84 / 3,593.39 ms | 1,345.49 / 1,356.68 ms |
| Forced restart | 434.72 / 449.01 ms | 1,728.62 / 1,987.28 ms |
| Daily + weekly | 56.93 / 62.21 ms | 32,238.52 / 34,464.19 ms |
| Latest measurement | 14.64 / 16.23 ms | 64.92 / 66.80 ms |
| Detail query | 147.52 / 151.14 ms | 62.78 / 64.84 ms |
| 100k observation import | 14,634.73 / 16,554.92 ms | 2,649.27 / 2,707.02 ms |
| Full export | 3,214.64 / 3,922.79 ms | 2,487.36 / 2,691.24 ms |
| One-row core insert | 29.20 / 34.21 ms | 2,545.46 / 2,577.34 ms |
| One-row core delete | 31.40 / 32.51 ms | 2,539.76 / 2,671.57 ms |
| Delete by type | 1,545.07 / 1,697.83 ms | 1,974.56 / 1,997.54 ms |

The clean-restart operation in this matrix inadvertently included a full snapshot and is labeled accordingly; it was corrected before the blocking run to measure open, typed read, and close. DuckDB setup took 36.52 seconds, occupied 15,740,928 bytes, and peaked at 610,668,544 process RSS bytes. The current JSON plus warehouse setup took 96.46 seconds, occupied 69,040,568 bytes, and peaked at 557,559,808 RSS bytes. The import values in this table include post-import digest verification; the timer was corrected before the blocking rerun so digest parity remains mandatory evidence but is outside import latency.

Both engines produced exactly 100,000 observations. Their original setup hashes differed because the first helper hashed array order and the JSON setup groups observations by source import while DuckDB preserves fixture order. The helper now sorts observations by ID and recursively canonicalizes object keys; the corrected smoke produces equal content digests. The old 100k hashes are not treated as content-parity evidence, and the blocking 250k run must establish canonical digest parity.

The benchmark runner now records warm-up and measured worker failures per operation instead of aborting the entire matrix. A blocking timing gate requires its warm-up and all five measured runs to succeed; partial successful timings cannot produce a pass. Failure messages are sanitized before report persistence.

### Blocking 250k result

The final 250k-observation matrix completed every warm-up and all five measured runs for all 12 operations on both engines, with no worker failures. Canonical observation digests were equal at exactly 250,000 observations.

| Operation | DuckDB median / p95 | JSON + current warehouse median / p95 |
| --- | ---: | ---: |
| Cold open | 340.08 / 343.57 ms | 2,864.74 / 2,950.64 ms |
| Profile switch | 356.78 / 392.85 ms | 3,447.85 / 3,558.58 ms |
| Clean restart | 399.56 / 424.54 ms | 3,179.33 / 3,797.39 ms |
| Forced restart | 421.27 / 565.42 ms | 3,111.56 / 3,385.79 ms |
| Daily + weekly | 86.44 / 93.14 ms | 74,420.33 / 75,552.99 ms |
| Latest measurement | 27.38 / 29.05 ms | 121.87 / 206.95 ms |
| Detail query | 420.69 / 443.37 ms | 125.82 / 127.97 ms |
| 100k observation import | 11,672.73 / 12,389.79 ms | 2,336.98 / 2,376.44 ms |
| Full export | 7,154.77 / 7,275.41 ms | 5,695.41 / 6,343.71 ms |
| One-row core insert | 34.58 / 36.24 ms | 6,247.79 / 6,467.18 ms |
| One-row core delete | 23.21 / 32.52 ms | 5,567.68 / 5,966.42 ms |
| Delete by type | 4,373.45 / 4,491.23 ms | 4,589.49 / 4,884.27 ms |

DuckDB setup took 81.34 seconds, occupied 26,226,688 bytes, and peaked at 1,248,309,248 RSS bytes. The current JSON plus warehouse setup took 399.80 seconds, occupied 162,790,496 bytes, and peaked at 1,237,966,848 RSS bytes.

| Blocking gate | Result | Evidence |
| --- | --- | --- |
| Canonical observation parity | Pass | Equal count and SHA-256 content digest |
| Cold open under 500 ms p95 | Pass | 343.57 ms |
| Routine reads under 500 ms p95 | **Fail** | Forced restart 565.42 ms; all other routine scenarios pass individually |
| 100k import under 10 seconds p95 | **Fail** | 12.39 seconds |
| Full export under 10 seconds p95 | Pass | 7.28 seconds |
| One-row insert under 250 ms p95 | Pass | 36.24 ms |
| One-row delete under 250 ms p95 | Pass | 32.52 ms |
| Peak RSS under 512 MiB | **Fail** | Setup 1.16 GiB; routine measured operations remain below 367 MiB |
| Footprint no larger than current baseline | Pass | 25.01 MiB versus 155.25 MiB |

**Original strict-gate result: no-go under the initial protocol. Product decision: conditional go for feature-gated Windows x64 productionization.** The storage model, encryption, packaging, parity, crash recovery, query performance, slim mutations, export, and footprint are proven. The 12.39-second 100k import p95 is accepted because imports at that scale are infrequent and can run as an explicit progress-bearing operation. Setup RSS is comparable to the current JSON-plus-warehouse baseline at the same 250k fixture (1.16 GiB versus 1.15 GiB), so the original absolute 512 MiB fixture-construction gate is not representative of steady-state operation. The 565.42 ms forced-restart p95 is accepted because it is a recovery path, remains substantially faster than the current 3.39-second baseline, and all runs recovered with exact parity. These exceptions do not relax encryption, extension verification, key handling, canonical parity, transactional integrity, rollback, or fail-closed requirements.

Final regression validation after the blocking run:

- Full shared suite: 5 files, 53 tests passed.
- Full API suite: 14 files, 107 tests passed, 1 intentionally skipped.
- Desktop secure-key lifecycle suite: 4 tests passed.
- Repository-wide TypeScript check: shared, API, and web passed.
- Production Electron 43.1.0 Windows x64 NSIS packaging: passed. The installer is 219,387,056 bytes with SHA-256 `3ef897020a57ef3c5222c71d6ff55e60a4cf18dad894cafcb06957a72be403ac`.
- Final packaged Electron 43.1.0 Windows x64 PoC: all eight encryption, key-rejection, WAL/spill, plaintext-absence, and rejected-key file-preservation gates passed.
- Prepared packaged extension SHA-256: `21eea4547cf5aa5231f4838906e8935067c956f56a5efd09035a51189af8a77b`.
- The production bundle contains the DuckDB native addon outside ASAR and the pinned extension under `resources/duckdb-extensions/`.
- No validation or packaging command accessed or modified the repository `data/` directory.

### Still open

- Profile-local day-boundary semantics remain a future product-contract decision. For this PoC, analytics are explicitly UTC because the current profile schema has no time-zone field.
- Production activation remains limited to an opt-in Windows x64 pilot. The documented seven-day soak is deferred by owner decision and is not a prerequisite for the current local development cutover.
- Bulk-ingestion redesign is deferred. Revisit the native appender or another client only if real operational evidence shows the accepted import latency is materially harmful.
- Recovery-backup and key-loss UX beyond fail-closed startup.
- macOS and Linux extension pins, native tests, packaging, and secure-key-store behavior.
- Paths containing spaces and non-ASCII characters on every target platform.

## Decision

The original encryption no-go is overturned for Windows x64: writable encrypted DuckDB is feasible with a bundled, signed, version-pinned native extension. Product review accepts the measured bulk-import, setup-memory, and forced-restart tradeoffs. Proceed with a conditional, feature-gated Windows x64 productionization path, provided the implementation preserves route/domain behavior, performs side-by-side parity-checked migration, retains rollback artifacts during the pilot, and fails closed on extension, key, schema, or integrity errors.

Do not enable DuckDB by default or migrate live data directly. macOS and Linux remain separate no-go platforms until their extension digests, packaged runtime checks, and secure-storage behavior pass.

## Recommended next increment

The read-only legacy loader, deterministic encrypted round trip, repository mutations, profile isolation, representative crash recovery, versioned daily/weekly views, activity queries, canonical shared view SQL, transactional version-1 upgrade, schema refusal, explicit UTC contract, Windows warehouse close/rename repair, direct analytical parity, and benchmark harness are implemented and tested. Productionization proceeds in this order:

1. Keep JSON as the default backend and add an explicit DuckDB feature flag beneath unchanged HTTP/domain contracts.
2. Complete the Electron `safeStorage` lifecycle and standalone production-secret refusal. This work has started and is covered by focused tests.
3. Add side-by-side, one-way migration with source hashing, canonical parity, checkpoint/close, atomic backend activation, and retained JSON rollback artifacts. Do not add permanent dual writes.
4. Implement the Phase 0 manifest/copy/junction/source-rehash harness and run disposable full-application validation only against copied profile data.
5. Run an opt-in Windows x64 pilot with rollback instructions and operational telemetry, then promote only after the soak period shows no integrity, recovery, or key-lifecycle regressions.
6. Treat macOS and Linux as independent supply-chain, packaging, and secure-storage gates.

The accepted 50-row bound-JSON batching remains unchanged unless pilot evidence justifies a separate ingestion project.

Steps 1 through 4 are complete. Step 5 is implemented and documented in `docs/DUCKDB_PILOT.md`; the opt-in soak is deferred by owner decision. Copied-data validation completed before the separately authorized live repository activation, which preserved the retained encrypted JSON rollback artifacts.

## Reproduction

From the repository root on Windows x64:

```powershell
npm run poc:duckdb -w apps/api
npm run poc:duckdb:electron
npm run poc:duckdb:benchmark -w apps/api -- --scale 10000 --runs 5
npm run poc:duckdb:benchmark -w apps/api -- --scale 100000 --runs 5
npm run poc:duckdb:benchmark -w apps/api -- --scale 250000 --runs 5
```

These commands prepare or package the pinned extension before running. A platform without a configured digest is expected to stop during preparation rather than download or load an unpinned artifact.