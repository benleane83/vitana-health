# Pre-Beta Codebase Review

**Reviewed:** 2026-07-29
**Scope:** `apps/api`, `apps/web`, `apps/android-companion`, `apps/desktop`, `packages/shared`, `packages/api-client`, `scripts/`, `.github/workflows/`, root build & test config
**Goal:** identify maintainability, performance, stability and tech-debt issues that become expensive or impossible to fix once beta testers have real data on their machines.

## Method and limitations

This is a **static review**. The terminal in the review environment returned no output, so no build, typecheck, or test run was performed and no line counts were produced by `wc`. All findings were derived by reading source files; every finding cites `file:line` evidence. Line counts were derived by end-of-file probing and are accurate to within ~20 lines.

The highest-impact findings (release workflow gating, CI job gating, whole-store replica snapshot, no-op response schemas, unit handling at ingest, desktop user-data migration ordering, undeclared mobile dependencies) were each re-verified directly against the source before publication.

Previous reviews (`CODEBASE_REVIEW_20260723.md` and earlier) were treated as background only — every finding below was re-derived from current code.

---

## Executive assessment

The architecture is sound and the security posture is genuinely good. Storage sits behind repository interfaces, backups use authenticated AES-256-GCM with a versioned format, companion access is capability-scoped, Electron is hardened, and the restore path has a real journal with compensation. There are **zero `TODO`/`FIXME` comments in `apps/api/src`** and the desktop layer is unusually well-factored. This is not a codebase in trouble.

The risk is concentrated in a different place: **the things that are cheap to change today and permanent tomorrow.** Three clusters matter before you onboard anyone.

1. **There is no way back.** No pre-update backup, no down-migrations, and a hard throw when the on-disk schema is newer than the binary — on both desktop and mobile. A single bad release plus a rollback request leaves a tester with an unopenable encrypted database. On Android the OTA `runtimeVersion` never changes, so a JS bundle can be pushed to a device whose native binary can't support it.
2. **Data-shape decisions are still open, and some are actively corrupting.** Units are stored as free text per row and never canonicalized at ingest, then summed and averaged across mixed units. There are no indexes on any query column, no foreign keys, and no retention policy on tables that grow forever. Every one of these is a five-line change now and a data-repair migration after beta.
3. **The release pipeline has no test gate.** A tagged push builds, smoke-tests, and immediately publishes a non-draft GitHub Release — which `electron-updater` picks up — without running `typecheck`, `test:core`, or `test:desktop`. Meanwhile a push to `main` runs *only* a durability job whose tests all silently skip on the runner OS.

Everything else on this list stays cheap to fix after users exist. These three do not.

### Do these first

| # | Finding | Why now |
|---|---|---|
| 1 | [Gate the release workflow on tests; publish as draft](#p1-1) | A broken build reaches every tester automatically |
| 2 | [Take an automatic backup before every desktop update](#p1-2) | The only recovery path from a bad schema migration |
| 3 | [Canonicalize units at ingest](#p1-3) | Silently and permanently corrupts health values |
| 4 | [Add indexes + foreign keys + `TIMESTAMPTZ` in one baseline schema](#p1-4) | Free today; a long blocking migration later |
| 5 | [Stop snapshotting and JSON-diffing the whole store on every write](#p1-5) | O(store size) per write; catastrophic at real volumes |
| 6 | [Fix the mobile migration N+1](#p1-6) | ~6 queries per observation on the *first thing a tester does* |
| 7 | [Stream Health Connect sync; add a per-category cursor and per-chunk checkpoints](#p1-7) | First sync OOMs or silently skips backfill |
| 8 | [Bump Android `version` per native/schema change; handle downgrade without throwing](#p1-8) | An OTA rollback permanently bricks a migrated device |
| 9 | [Define retention for `companion_sync_changes` and `audit_events`](#p1-9) | Can't prune later without a protocol version bump |
| 10 | [Isolate reads from write transactions](#p1-10) | Concurrent reads currently see uncommitted rows |

---

## Remediation progress

**Branch:** `code-review-20260729`. Findings are being worked in phases, each verified before the next begins. Every finding below carries its own **Status** line; this table is the roll-up.

| Phase | Findings | Status |
|---|---|---|
| 0 — CI and release gating | P1-1, P1-16, P1-18 | Done |
| 1 — Profile export tooling | (enabler for Phase 2) | Done |
| 2 — Schema baseline, units, retention | P1-3, P1-4, P1-9 | Done |
| 3 — Write and read path | P1-5, P1-6, P1-10 | Done |
| 4 — Backups and recovery | P1-2, P1-12 | Done |
| 5 — API contracts | P1-11 | Done |
| 6 — Web stability and performance | P1-13, P1-14, P1-15 | Done |
| 7 — Android core | P1-8, P1-19 | Done |
| 8 — Health Connect sync | P1-7 | Done |
| 9 — Desktop lifecycle | P1-17 | Done (LAN bind deferred) |
| 10 — Final validation and docs | — | Done |

**All 19 P1 findings are resolved.** `npm run validate:all` passes end to end (typecheck, build, 94 core test files / 592 cases, the desktop `node --test` suite, 7 integration files / 99 cases, 1 durability file / 2 cases, and `audit:ci` with no blocking high/critical advisories).

Two P1-adjacent items were deliberately carried forward rather than closed:

- **Desktop LAN bind** (P1-17 neighbourhood) — the server still binds `0.0.0.0` unconditionally. Deferred by decision; it is item 4 of Tier 0 in the updated backlog below.
- **Kotlin pinned-HTTP cancellation** (P1-7) — implemented but **compile-unverified**, because no Kotlin build runs in the Windows validation stack. It needs one real Android build to confirm.

The P2 and P3 sections below were re-audited against current code at the end of Phase 10: findings the phases resolved are annotated inline, and the remaining ones are re-ordered under [Suggested sequencing](#suggested-sequencing).

Phase 1 added `npm run export:profiles` / `npm run import:profiles` (`apps/api/src/dev/`), a developer-only capture-and-replay pair used to rebuild the author's local test profiles onto the new baseline. It is not an end-user migration path.

---

# P1 — Fix before beta testers have data

<a id="p1-1"></a>
## 1. A tagged push publishes an auto-update to every tester without running a single test

`.github/workflows/release-windows.yml` triggers on `v*` tags. The steps are checkout → setup-node → version check → `npm ci` → `npm rebuild duckdb` → `npm run package:desktop` → artifact validation → `Fast` smoke → publish. There is **no `npm run typecheck`, no `npm run test:core`, no `npm run test:desktop`** anywhere in the file.

The publish step at [.github/workflows/release-windows.yml](.github/workflows/release-windows.yml#L113-L126) runs:

```
gh release create $env:GITHUB_REF_NAME $files --verify-tag --generate-notes --title "..."
```

with no `--draft`, so the release is live the moment it is created and immediately visible on the `latest` channel that `electron-updater` polls ([apps/desktop/package.json](apps/desktop/package.json#L89-L96)).

Worse, the same workflow *rejects* a pre-existing draft release — [release-windows.yml](.github/workflows/release-windows.yml#L120) throws `"The matching GitHub Release must not be a draft."` — so the safe path is actively blocked.

**Why hard later:** once testers auto-update, a broken release is on their machines before you can react, and there is no rollback path (see P1-2 and P1-8).

**Action:** insert `npm run validate:fast` before the packaging step. Publish with `--draft` and promote manually after reviewing the smoke evidence, and invert the draft check so a draft is expected rather than fatal.

**Status: resolved (phase 0).** `release-windows.yml` runs `npm run validate:fast` plus the DuckDB-backed suites before packaging, `gh release create` now passes `--draft`, and the draft check was inverted so a pre-existing draft is expected rather than fatal.

---

<a id="p1-2"></a>
## 2. No backup before an update, no down-migrations, and a downgrade hard-bricks the database

Three facts combine into the worst failure mode in the product:

- The schema is at **v14** with 14 forward-only migrations and **zero** down-migrations ([apps/api/src/storage/duckdbRuntime.ts](apps/api/src/storage/duckdbRuntime.ts#L472-L485)).
- Opening a database whose schema is *newer* than the binary throws outright — [duckdbRuntime.ts](apps/api/src/storage/duckdbRuntime.ts#L89-L91): `Encrypted DuckDB schema version N is newer than supported version M`.
- The update path — [apps/desktop/desktop-updater.cjs](apps/desktop/desktop-updater.cjs#L131-L134) → `prepareToInstall()` → [apps/desktop/main.cjs](apps/desktop/main.cjs#L50-L68) — **only shuts the API down. It takes no backup.** Backups are manual-only; the sole creation route is `POST /create` at [apps/api/src/routes/backupRoutes.ts](apps/api/src/routes/backupRoutes.ts#L56), and there is no scheduler or pre-upgrade hook anywhere in the repo.

Ship an update that lands schema v15 → a tester hits a bug → you ask them to reinstall the previous build → their database now refuses to open, permanently, with no backup.

The migration runner has two further gaps: it runs **all** pending migrations inside a single `BEGIN`…`COMMIT` ([duckdbRuntime.ts](apps/api/src/storage/duckdbRuntime.ts#L66)), so a v1→v15 upgrade on a large database is one long unresumable lock; and it takes no copy of the file before attempting.

**Action:**
1. In `shutdownApiForUpdate`, copy each `*.duckdb` to `userData/pre-update-backups/<fromVersion>-<toVersion>/` before `quitAndInstall`, pruning to the last 2–3.
2. Copy the database inside `migrateDuckDbSchema` before the first statement and restore it on failure.
3. Commit per migration version rather than one transaction for all.
4. Turn "schema newer than binary" into a distinct, user-facing error code with recovery guidance, not a raw throw.

**Status — Resolved (Phase 4).** All four parts landed, though the schema baseline collapse in Phase 2 took the v14 chain down to a single v1, so parts 2 and 3 are now insurance for the next migration rather than a fix for an existing one.

`apps/desktop/pre-update-backup.cjs` copies every `*.duckdb` and `*.duckdb.wal` from `<userData>/duckdb-storage/databases` into `<userData>/pre-update-backups/<from>-to-<to>-<timestamp>/`, keeping the newest three. It is called from `shutdownApiForUpdate` **after** the embedded API has closed — before that point the files are still attached and mid-checkpoint. `desktop-updater.cjs` now passes `{ fromVersion, toVersion }` through `prepareToInstall` so the directory name says what the update was. A backup failure is logged and swallowed: refusing to install an update because a copy failed would be a worse outcome than installing it.

`migrateDuckDbSchema` takes a `CHECKPOINT`-flushed copy of the attached file before the first migration statement, but only when `currentVersion > 0` — a file being bootstrapped has nothing worth preserving. Each pending version now gets its own `BEGIN`/`COMMIT`, so a failure part-way through a multi-step upgrade leaves the store at a version that actually exists. The copy cannot be restored from inside the migrator because the file is still attached, so failure raises `SchemaMigrationError` carrying `backupPath` and `DuckDbRepository.open` restores it in the catch that already closes the handle. On success the copy is deleted.

The future-version throw is now `SchemaVersionTooNewError` with `code: "SCHEMA_VERSION_TOO_NEW"` and a message written for a human — `This profile was written by a newer version of Vitana (database schema N, this build supports M). Reinstall the newer version, or restore a backup.` The desktop shell already surfaces startup failures verbatim through `dialog.showErrorBox`, so no extra plumbing was needed. `apps/api/src/storage/profileStoreManager.ts` also stamps `lastWrittenByAppVersion` and `lastWrittenAt` into the storage backend manifest on every write, which is the only record of which build last touched a store when a user reports a broken profile.

---

<a id="p1-3"></a>
## 3. Units are stored as free text per row and never canonicalized — then summed and averaged

`observations` and `time_series_samples` each carry a per-row `unit VARCHAR`, *alongside* `measurement_types.canonical_unit`. Nothing in the ingest path converts. [apps/api/src/storage/duckdbRows.ts](apps/api/src/storage/duckdbRows.ts#L82-L100) inserts `entry.unit` verbatim.

The aggregation path then does this — [apps/api/src/storage/duckdbProjections.ts](apps/api/src/storage/duckdbProjections.ts#L525): `MIN(unit) AS unit` next to `SUM(value)` / `AVG(value)` over a UNION of observations, samples, and activities. **Values recorded in different units are added together and labelled with whichever unit sorts first.**

This is provably already a problem: migration v5 exists *solely* to retroactively repair unit mistakes — [duckdbRuntime.ts](apps/api/src/storage/duckdbRuntime.ts#L355) contains `UPDATE observations SET value = value/100 WHERE measurement_code='oxygen_saturation' AND unit='%'` and a `value/1000` for calories.

The correct pattern already exists in the codebase but is used in only three places: `convertMeasurementValue` is called for personal reference ranges ([apps/api/src/storage/duckdbCommands.ts](apps/api/src/storage/duckdbCommands.ts#L190-L193)), the clinician report, and migration dedupe comparison — never on the write path.

Compounding this, the registry's unit alias coverage is limited to canonical + imperial ([packages/shared/src/registry.ts](packages/shared/src/registry.ts#L1240-L1262)) and imperial mapping is a hand-maintained `if (type.code === "glucose" || …)` chain ([registry.ts](packages/shared/src/registry.ts#L1265-L1275)). A lab result arriving in a *third* unit — `mmol/L` where canonical is `mg/dL` — has no alias mapping, so the value is stored against the wrong unit rather than rejected.

**Why hard later:** once mixed-unit rows exist in a tester's database you can never reliably distinguish "5 kg" from "5 lb" recorded as `5`. Every future fix is another guess-based v5-style `UPDATE`. **This is the single most irreversible issue in the codebase.**

**Action:** canonicalize at ingest. Apply the `convertMeasurementValue` path to `insertObservationRows` and the sample/activity inserts; store canonical value + canonical unit and keep the original in a separate `source_unit` column. Make an unrecognised unit a hard import error, not a silent pass-through. Move unit conversion into per-measurement declarative data (`units: [{ unit, aliases, toCanonical }]`) rather than a hardcoded code list.

**Status: resolved (phase 2).** `canonicalizeMeasurement` in `packages/shared/src/measurementRegistry.ts` is now applied by `insertObservationRows`, `insertTimeSeriesSampleRows`, and `updateObservation`; `observations` and `time_series_samples` gained a `source_unit` column holding the original. A row whose unit cannot be converted is **rejected** rather than stored, counted in the new `rejected` field of the import outcome, and the reason is appended to `imports.diagnostics`. Codes with no registry entry — the synthetic `manual_*` / `body_comp_*` codes the manual-entry UI mints — pass through verbatim by design. The alias and conversion tables were widened (dimensional `mg/dL`↔`mg/L`, nmol↔µmol, body-water kg↔L, `L/L`↔`%`, and ~20 unit aliases), which relabelled 143,738 of the author's ~152,000 existing rows and left just 2 genuinely unconvertible. Migration v5's retroactive repair is gone with the rest of the chain (P1-4).

---

<a id="p1-4"></a>
## 4. The schema has two indexes, no foreign keys, and naive `TIMESTAMP`

**Indexes.** A search for `CREATE INDEX` across [duckdbRuntime.ts](apps/api/src/storage/duckdbRuntime.ts) returns exactly two hits — `companion_migration_identity_idx` ([L418](apps/api/src/storage/duckdbRuntime.ts#L418)) and `companion_sync_changes_revision_idx` ([L451](apps/api/src/storage/duckdbRuntime.ts#L451)). There is **no index on** `observations.measurement_code`, `observations.observed_at`, `time_series_samples.measurement_code`, `time_series_samples.end_at`, or `activities.start_at` — the filter and sort columns for virtually every read: `measurementChartSeries` ([duckdbProjections.ts:423](apps/api/src/storage/duckdbProjections.ts#L423)), `measurementDetails` (L631), `summary` (L281), `latestMeasurement` (L624), and the duplicate-detection JOIN at [duckdbMigrationPersistence.ts:197](apps/api/src/storage/duckdbMigrationPersistence.ts#L197).

**Foreign keys.** The v1 DDL ([duckdbRuntime.ts:251-330](apps/api/src/storage/duckdbRuntime.ts#L251)) declares relation columns (`source_id`, `import_id`, `observation_group_id`, `completed_health_event_id`) with **no `REFERENCES` clause anywhere**. Referential integrity is enforced entirely in application code.

**Timestamps.** Every timestamp column is bare `TIMESTAMP`, not `TIMESTAMPTZ`; correctness depends on `SET TimeZone = 'UTC'` being executed per connection at [duckdbRuntime.ts:161](apps/api/src/storage/duckdbRuntime.ts#L161). Any future code path that opens a connection without that `SET` shifts stored instants. In a health app, timestamps are load-bearing.

**Raw import content inline.** `imports.raw_content VARCHAR` holds whole uploaded files ([duckdbImportPersistence.ts:175](apps/api/src/storage/duckdbImportPersistence.ts#L175)). The read path already works around it — [duckdbExport.ts:44](apps/api/src/storage/duckdbExport.ts#L44) uses `SELECT * EXCLUDE (ordinal, raw_content)` — but `snapshot()` defaults to `includeRaw: true`. A multi-MB Health Connect export lands as a single row value, duplicating data already present in `observations`.

**Why hard later:** each fix is individually trivial, but each requires a migration that runs against every tester's existing database, on the largest tables you have, as a long blocking operation at startup with no progress reporting.

**Action:** since you have no backwards-compatibility obligation, **collapse v1–v14 into a single clean v1 baseline** that includes indexes on `observations(measurement_code, observed_at)`, `time_series_samples(measurement_code, end_at)`, `activities(start_at)` and `imports(source_kind, checksum)`; foreign keys; `TIMESTAMPTZ`; canonical units (P1-3); and `raw_content` either dropped or moved to a sidecar file. Migrate your local test profiles once, by hand. This single change removes the majority of the "painful later" surface and makes migrations v5 and v10 disappear entirely.

**Status: resolved (phase 2), with one deliberate deviation.** `duckdbRuntime.ts` is now a single `schemaVersion = 1` baseline with all 14 historical migrations deleted. It declares the four requested indexes plus the two pre-existing companion ones, 13 foreign keys, and `TIMESTAMPTZ` on every timestamp column. Analytical views moved out of the migration chain into `applyAnalyticalViews()`, which diffs definitions against a new `schema_objects` fingerprint table so reopening a database is a no-op. The five local test profiles were rebuilt through `npm run import:profiles` with exact row-count parity against the pre-collapse export.

Two things were deliberately *not* done:

- **`imports.raw_content` stays in the database.** Moving original import payloads to plaintext sidecar files beside an encrypted database is a privacy regression for a local-first health app. The blob-bloat concern is addressed instead by explicit column lists — `raw_content` is now only read when a caller names it, and the wildcard `SELECT *` on `imports` is gone. Wildcard selects on the remaining blob-free tables were left alone.
- **`measurement_code` is not a foreign key onto `measurement_types`.** The manual-entry flows mint synthetic codes (`manual_*`, `body_comp_*`) that never get a measurement-type row, so the constraint would reject legitimate user data.

---

<a id="p1-5"></a>
## 5. Every tracked mutation materializes and JSON-diffs the entire store, twice

[apps/api/src/storage/duckdbRepository.ts:627-650](apps/api/src/storage/duckdbRepository.ts#L627) — when `trackReplica === true`, `transaction()` calls `this.replicaSnapshot()` *before* the operation and again after, then `recordReplicaChanges(before, after)`.

`replicaSnapshot()` ([duckdbRepository.ts:652](apps/api/src/storage/duckdbRepository.ts#L652)) calls `snapshotDuckDb`, which is ~18 sequential `SELECT *` full-table reads followed by `healthStoreDataSchema.parse()` over the whole store. The diff at [duckdbReplicaSync.ts:70-93](apps/api/src/storage/duckdbReplicaSync.ts#L70) then runs `JSON.stringify(previous.payload) !== JSON.stringify(entity.payload)` for **every entity in the store**, after building and `.sort()`ing the full entity array.

The code documents its own problem — [duckdbSchema.ts:57-58](apps/api/src/storage/duckdbSchema.ts#L57): *"that transaction snapshots and parses the whole store to capture companion replica changes."*

Nine callers use it: `replaceProfile` (L263), `resetMeasurementTypeMetadataFromRegistry` (L283), `mergeImport` (L288), `applyMobileMigrationBatch` (L305), `deleteObservationRecordsByMeasurementCode` (L467), `deleteObservationsByMeasurementCode` (L503), `deleteDailyAggregateStepSamples` (L508), `upsertPersonalReferenceRange` (L530), `deletePersonalReferenceRange` (L541).

**Why hard later:** this is O(store size) per write — invisible at 5k rows, catastrophic at 500k. Once a tester has a year of Health Connect data, an import becomes a multi-minute blocking operation.

**Action:** the cheap path already exists. `transaction()` accepts a `(result) => ReplicaChangeInput[]` overload, which `updateObservation` ([duckdbRepository.ts:481](apps/api/src/storage/duckdbRepository.ts#L481)) already uses correctly. Convert all nine callers, then delete `recordReplicaChanges` and the whole-store diff path.

**Status: resolved (phase 3).** `transaction()` now takes only the mapper form — the `boolean` overload, `replicaSnapshot()` and `recordReplicaChanges` are gone, as is the `beforeReplicaSnapshot` test hook that existed to police them. All nine callers declare the entities they touched. The shared constructors live in a new `duckdbReplicaChanges.ts`, so the import, migration and mutation paths build changes the same way. Because insert helpers now use `INSERT OR IGNORE … RETURNING id`, a change is emitted only for rows that were genuinely written rather than for everything that was attempted.

---

<a id="p1-6"></a>
## 6. `applyMobileMigrationBatch` runs roughly six queries per observation

[apps/api/src/storage/duckdbMigrationPersistence.ts:179](apps/api/src/storage/duckdbMigrationPersistence.ts#L179) — `for (const entry of batch.observations)`, and inside the loop: `resolveAlias(dataSource)` ([L342](apps/api/src/storage/duckdbMigrationPersistence.ts#L342)), an optional second `resolveAlias`, `SELECT * FROM observations WHERE id = ? LIMIT 1`, a four-way duplicate-candidate JOIN ([L197](apps/api/src/storage/duckdbMigrationPersistence.ts#L197)) filtered on `measurement_code` + `observed_at` — **all unindexed** (P1-4) — and finally [L229](apps/api/src/storage/duckdbMigrationPersistence.ts#L229) `insertObservationRows(..., await nextOrdinal(connection, "observations"))`: a `MAX(ordinal)` aggregate scan **plus a single-row insert, per observation**. The same per-entry `nextOrdinal()` pattern repeats for imports (L113), sources (L141) and observation groups (L171).

The whole batch is then wrapped in `transaction(..., true)` ([duckdbRepository.ts:305](apps/api/src/storage/duckdbRepository.ts#L305)), so P1-5 stacks on top.

**Why hard later:** this is the *first thing a beta tester does* — pair a phone and migrate its history. A 50k-record migration is ~300k queries plus two whole-store snapshots. A hang on first use is the worst possible first impression, and the fix requires restructuring the batch contract, not a tweak.

**Action:** hoist `nextOrdinal` out of the loop and increment in JS (as [duckdbSchema.ts:63](apps/api/src/storage/duckdbSchema.ts#L63) already does); pre-load alias maps once per batch; replace the per-row duplicate JOIN with one set-based query per batch; use a single multi-row `insertObservationRows`.

Two related scan-per-write patterns should go at the same time:
- `importObservationRecords` loads **every observation ID in the database** into a JS `Set` ([duckdbImportPersistence.ts:148](apps/api/src/storage/duckdbImportPersistence.ts#L148)) purely to filter incoming rows — despite `id VARCHAR PRIMARY KEY` and `INSERT OR IGNORE` already handling it.
- `measureInsert` runs **12 full-table `COUNT(*)`** per import ([duckdbImportPersistence.ts:190-202](apps/api/src/storage/duckdbImportPersistence.ts#L190)) just to compute `accepted`/`duplicates`.

**Status: resolved (phase 3).** `applyMobileMigrationBatch` now issues a fixed number of queries per batch rather than per row: the session's alias table is loaded once into a `Map`, existing rows are probed with one `id IN (…)` query per entity type, the duplicate-candidate JOIN became a single query over the batch's measurement codes and instants (matched in JS against the incoming source's provenance), accepted observations go in through one `insertObservationRows` call, and new aliases are written in one statement.

`nextOrdinal` also changed shape. It now seeds a per-connection counter once and hands out reserved blocks in memory, so no insert path pays a `MAX(ordinal)` aggregate scan any more. The bounds only ever move outwards, so a rolled-back transaction or a retention prune leaves a harmless gap. `prependOrdinal` works the same way for the descending tables.

Both related patterns are gone: the full observation-id preload was replaced by `INSERT OR IGNORE … RETURNING id`, and `measureInsert`'s 12 `COUNT(*)` scans were replaced by counting the returned ids.

---

<a id="p1-7"></a>
## 7. Health Connect sync buffers all history in memory, can't resume, and silently skips backfill

Four defects in the same path, all of which surface on a tester's first real sync.

**Whole history in one array.** [apps/android-companion/src/syncHealthConnect.ts:555-563](apps/android-companion/src/syncHealthConnect.ts#L555) — `readAllRecords` loops pages doing `records.push(...page.records)` with `pageSize: 1000`; all 14 descriptors are read into one object at [L284](apps/android-companion/src/syncHealthConnect.ts#L284) before any chunking. A tester with a Wear OS watch and a year of history has millions of HeartRate samples.

**Then copied again.** `chunkPayload` at [syncHealthConnect.ts:330-334](apps/android-companion/src/syncHealthConnect.ts#L330) `flatMap`s every collection into a *new* array, then `JSON.stringify`s each row individually and measures it with a hand-written char-by-char `utf8ByteLength`. Peak memory doubles. A third full pass at [L530](apps/android-companion/src/syncHealthConnect.ts#L530) walks everything again to find the oldest timestamp.

**No per-chunk checkpoint.** [syncHealthConnect.ts:296-307](apps/android-companion/src/syncHealthConnect.ts#L296) uploads chunks sequentially and only advances the cursor afterwards. Chunk 40 of 41 failing on a flaky LAN discards all prior progress and re-reads the whole history.

**A single global cursor.** The cursor is one timestamp with `OVERLAP_MS` slack ([syncHealthConnect.ts:20](apps/android-companion/src/syncHealthConnect.ts#L20)), stored as `healthConnectSyncCursor`; categories are stored separately as `healthConnectCategories` and updated independently from the settings flow at [ImportScreen.tsx:636](apps/android-companion/src/screens/ImportScreen.tsx#L636). Enabling a new category does **not** reset the cursor — so a tester who syncs Steps for a month then enables Sleep gets Sleep only from today forward. The missing month is silently absent and indistinguishable from "the watch had no data."

**Also:** sync cannot be cancelled — there is no `AbortController` in the file, and the transport timeout only races a `setTimeout`; the native OkHttp call at [VitanaPinnedHttpModule.kt:39-56](apps/android-companion/modules/vitana-pinned-http/android/src/main/java/app/vitanahealth/pinnedhttp/VitanaPinnedHttpModule.kt#L39) keeps running. And concurrent syncs are prevented only by component-local `syncing` state ([ImportScreen.tsx:585-593](apps/android-companion/src/screens/ImportScreen.tsx#L585)), which resets on remount while the previous promise is still running — two runs can race the cursor write backwards.

**Why hard later:** the per-category cursor is a stored-shape change on every paired device; per-chunk resumption needs a server-side ack contract. Both are protocol changes once devices are in the field.

**Action:**
1. Stream: read one page, convert, append to the current chunk, upload when it hits `MAX_UPLOAD_BYTES`. Never hold more than one chunk plus one page. Track the minimum timestamp during conversion.
2. Persist a high-water mark after each acked chunk and resume from it.
3. Make the cursor a `Record<category, string>` **now**, and reset the entry for any newly-enabled category.
4. Add a `signal` parameter through `syncHealthConnect` and `VitanaPinnedHttp.request` (OkHttp `Call.cancel()`); abort on `AppState` background.
5. Move the in-flight guard to module scope, matching the single-flight pattern already in [syncCoordinator.ts:22](apps/android-companion/src/connected/syncCoordinator.ts#L22).

### Status — Resolved (Phase 8)

**Wire protocol.** `packages/shared/src/healthConnectSync.ts` owns the versioned session/chunk/acknowledgement schemas and the version negotiator; an unsupported `protocolVersion` returns `409 SYNC_PROTOCOL_UNSUPPORTED`. Both new endpoints are documented in `docs/API_CONTRACT.md`.

**Server-side ack contract.** `health_connect_sync_sessions` is idempotent on `(pairing, sessionKey)` and `health_connect_sync_batches` stores one acknowledgement per `(sessionId, batchId)`. A chunk and its acknowledgement commit in the same transaction, so a replayed batch returns the original counts without importing twice, and a resumed session reports `processedBatchIds` for the phone to skip. The import identity check also became a single `INSERT OR IGNORE` backed by `imports_identity_idx`, replacing a non-atomic SELECT-then-INSERT.

**Streaming.** `readAllRecords` is now the `readRecordPages` generator and each descriptor exposes `readPages`, converting one page at a time into a single `ChunkBuilder`. The `flatMap` copy and the third oldest-timestamp pass are gone — the minimum timestamp is tracked during conversion. Peak memory is one chunk plus one page regardless of history length.

**Per-chunk resumption.** Batch ids are `<sessionKey>:<ordinal>` in a deterministic read order, so a resumed run mints the same ids. The in-progress session key is persisted as `healthSourceSessionKey` and cleared only on completion, which is also why cursors do not advance mid-session.

**Per-category cursors.** `healthConnectSyncCursor` / `healthConnectCategories` became `healthSourceCursors` (a `Partial<Record<HealthConnectCategory, string>>`) / `healthSourceCategories`, with a stored-blob migration in `loadConnection` that fans the old scalar out across the categories it had covered. A newly-enabled category has no entry and therefore backfills the full window; a category whose permission was denied keeps its old entry, which retired `canAdvanceCursor`.

**Cancellation.** `signal` flows from `ImportScreen` through `syncHealthConnect`, `pinnedFetch`, and into `VitanaPinnedHttp.request`, which now registers each `Call` by request id so `cancel(requestId)` reaches OkHttp. The screen aborts on `AppState` leaving `active`.

**Single flight.** `healthSourceSyncCoordinator` is a module-scope single-flight guard modelled on `syncCoordinator.ts`, replacing the component-local `syncing` check.

**Shared retry policy.** `packages/shared/src/networkRetry.ts` provides full-jitter backoff and retryability classification; both duplicated regexes are gone, and the Kotlin module now throws `CodedException`s carrying `network-timeout`, `network-unreachable`, `network-connect-failed`, `network-interrupted`, and `cancelled`.

---

<a id="p1-8"></a>
## 8. An OTA rollback permanently bricks a migrated Android device

[apps/android-companion/src/standalone/migrations.ts:25](apps/android-companion/src/standalone/migrations.ts#L25) throws `Database schema ${currentVersion} is newer than supported schema` with no recovery. `LOCAL_SCHEMA_VERSION` is compiled into the JS bundle ([localStore.ts:17](apps/android-companion/src/standalone/localStore.ts#L17)).

Meanwhile OTA is live and rollback-capable: [app.config.js:66](apps/android-companion/app.config.js#L66) sets `runtimeVersion: { policy: "appVersion" }` against a static `version: "0.1.0"` ([app.config.js:7](apps/android-companion/app.config.js#L7)), with `updates.enabled: true` and `fallbackToCacheTimeout: 0` ([app.config.js:67-71](apps/android-companion/app.config.js#L67)).

Two consequences:

- Ship a schema-5 bundle, find a bug, republish the schema-4 bundle — **every device that already migrated throws on open forever**, with no in-app path back.
- Because `runtimeVersion` never changes, a JS bundle calling a *new native method* can be pushed to devices running the old binary. The native surface does change independently: SQLCipher ([app.config.js:49](apps/android-companion/app.config.js#L49)), the pinned-HTTP module, `expo-health-connect` ([app.config.js:47](apps/android-companion/app.config.js#L47)). That is crash-on-launch for every tester, recoverable only by manual APK reinstall.

There is also **no backup or integrity check around migrations**: [sqliteLocalStore.ts:101](apps/android-companion/src/standalone/sqliteLocalStore.ts#L101) calls `migrate(database)` directly on the live file, and nothing runs `PRAGMA integrity_check` afterwards.

And the migration loop trusts each SQL literal to bump `user_version` itself ([migrations.ts:13](apps/android-companion/src/standalone/migrations.ts#L13), with hand-written PRAGMAs at [L103](apps/android-companion/src/standalone/migrations.ts#L103), [L126](apps/android-companion/src/standalone/migrations.ts#L126), [L151](apps/android-companion/src/standalone/migrations.ts#L151), [L158](apps/android-companion/src/standalone/migrations.ts#L158)). Forget one and the loop "succeeds" while the version stays put — every launch replays the migration, and with `ALTER TABLE ... ADD COLUMN` steps ([L154-155](apps/android-companion/src/standalone/migrations.ts#L154)) the replay throws "duplicate column" and bricks the device.

### Status — Resolved (Phase 7)

- `runtimeVersion` is now the explicit string `"1"` in `app.config.js`, decoupled from `expo.version`. The bump rule (native module change, Expo SDK upgrade, `expo-build-properties`/permission change, or a schema an older binary cannot read) is documented under "Versioning" in `docs/ANDROID_RELEASE.md` and is a line item in the every-release checklist. `nativeConfig.test.ts` asserts the value is a string and differs from the marketing version.
- `migrations.ts` is an ordered `migrations` array of `{ version, sql }`. The runner applies each step in its own transaction, sets `user_version` **inside that same transaction**, then reads it back and throws `did not take effect` if the bump did not stick. The hand-written `PRAGMA user_version` literals are gone, and a test asserts no migration SQL contains one.
- A newer-than-supported schema no longer throws. `migrate` returns `{ schemaVersion, readOnly, appliedVersions }`; on downgrade it skips migrations, returns `readOnly: true`, and `sqliteLocalStore` pins the connection with `PRAGMA query_only = ON` so writes fail at the engine rather than relying on every call site checking a flag. `localDatabaseMode()` exposes the state.
- Migrations now run behind a backup. `migrateWithBackup` checkpoints the WAL, copies `.db`/`-wal`/`-shm` to `<name>.pre-v{N}.bak`, then runs `PRAGMA integrity_check` and a per-table row-count assertion afterwards; any failure closes the connection, restores the captured files, and removes files the failed migration created. `databaseBackup.ts` keeps the decision logic behind an injectable `DatabaseFileStore` so it is unit-tested without a device.
- Coverage: a per-migration test applying each step to a fixture at `N-1`, a transaction-rollback test, a bump-did-not-stick test, a downgrade test asserting read-only rather than a throw, and backup capture/restore/discard tests.

**Action:**
1. Bump `version` on every native or schema change so `runtimeVersion` isolates generations — or switch to an explicit `runtimeVersion` string you control independently of the marketing version. Make this a mandatory release-checklist item.
2. Replace the throw at [migrations.ts:25](apps/android-companion/src/standalone/migrations.ts#L25) with a read-only "this data was written by a newer app version — update or export" state.
3. Copy the `.db`/`-wal` to `<name>.pre-v{N}.bak` before the loop, run `PRAGMA integrity_check` and a row-count assertion after, restore on failure.
4. Re-read `user_version` after each step and assert it equals `version + 1`; better, drop the in-SQL PRAGMA and have the runner set it in the same transaction.
5. Convert to an ordered array of `{ version, up(db) }` modules with a per-migration test that applies it to a fixture at version N-1.

---

<a id="p1-9"></a>
## 9. Sync and audit tables grow forever and duplicate every payload

`recordReplicaEntityChanges` ([duckdbReplicaSync.ts:95](apps/api/src/storage/duckdbReplicaSync.ts#L95)) inserts a row containing a **full JSON copy of the entity payload** for every change. `insertAudit` ([duckdbCommands.ts:634](apps/api/src/storage/duckdbCommands.ts#L634)) writes an `audit_events` row on every mutation. The v13 DDL around [duckdbRuntime.ts:451](apps/api/src/storage/duckdbRuntime.ts#L451) contains **no retention, TTL, or pruning statement**, and no pruning exists anywhere in `duckdbReplicaSync.ts`. `createReplicaSnapshot` ([L133](apps/api/src/storage/duckdbReplicaSync.ts#L133)) writes one `companion_sync_snapshot_entries` row per entity — **a complete second copy of the store, per paired device**.

**Why hard later:** you cannot retroactively prune data a synced device might still need without a protocol version bump on the mobile side — which means an app-store submission and review wait. Deciding retention *now*, before any device has synced, is free.

**Action:** prune `companion_sync_changes` below `min(companion_sync_state.acknowledged_revision)` across pairings; cap `audit_events` by age or count; delete superseded `companion_sync_snapshots`. Run it as an on-open maintenance step.

**Status: resolved (phase 2), by a different mechanism.** `duckdbRetention.ts` now runs `pruneRetention()` as an on-open maintenance step: `audit_events` are capped at 20,000 rows and 365 days, and snapshots abandoned for more than 24 hours are deleted along with their entries.

Pruning `companion_sync_changes` below an acknowledged revision turned out to be impossible as written — **there is no server-side acknowledgement cursor.** `companion_sync_state` is a singleton with no per-device column, and the phone's cursor lives client-side in AsyncStorage. Retention is therefore a bounded window of the most recent 50,000 changes; a device that asks for a sequence older than the window gets a `ReplicaDeltaGapError`, surfaced as HTTP 409 *"The change log no longer covers this cursor. Restart from a snapshot."* — which mirrors the existing expired-snapshot-cursor behaviour the client already handles. A per-device acknowledgement cursor is worth adding when the sync protocol is next versioned, but it is not needed to make retention safe.

---

<a id="p1-10"></a>
## 10. Reads share one connection with open write transactions and are not serialized

There is exactly one connection per database — `EncryptedDuckDbDatabase { database, connection }` at [duckdbRuntime.ts:24](apps/api/src/storage/duckdbRuntime.ts#L24), exposed via `private get connection()` at [duckdbRepository.ts:616](apps/api/src/storage/duckdbRepository.ts#L616).

Mutations are serialized by `mutationTail` / `enqueueMutation` ([duckdbHealthStore.ts:53](apps/api/src/storage/duckdbHealthStore.ts#L53), [L285](apps/api/src/storage/duckdbHealthStore.ts#L285)) — but **read methods bypass the queue entirely** and delegate straight through (e.g. `measurementDetail` at [L117](apps/api/src/storage/duckdbHealthStore.ts#L117)). Meanwhile `transaction()` issues a bare `BEGIN TRANSACTION` ([duckdbRepository.ts:630](apps/api/src/storage/duckdbRepository.ts#L630)) on that same shared connection.

A concurrent HTTP read arriving mid-mutation therefore executes **inside the open write transaction** and returns uncommitted data. If that transaction later rolls back, the client has been served rows that never existed. `runCompiledQuery` — the AI query path — has the same exposure.

**Why hard later:** the fix is either a read connection or extending the queue to reads; both change the concurrency contract of every method in `duckdbHealthStore.ts`. Chasing "the chart briefly showed wrong data" from user reports is a heisenbug hunt.

**Action:** open a second read-only `duckdb.Connection` per database for all read paths (DuckDB supports multiple connections per `Database`). This also removes reads from behind long imports.

**Status: resolved (phase 3).** `EncryptedDuckDbDatabase` now carries a `readConnection` alongside the write connection. Both are opened before the database is attached, because `SET lock_configuration = true` closes the door on per-connection settings; `USE poc` is issued on the read connection in the same window. Every read method on the repository, plus `runCompiledQuery` and `snapshot`, go through `private get reader()`, while anything that reads its own writes — the bodies of `transaction` callbacks — deliberately stays on the write connection.

`exportData` was split as part of this: the `"export-created"` audit row is now a small queued write, and the snapshot that follows is read off the read connection instead of holding the mutation queue for the length of a full-store read.

An integration test covers the contract directly — a read taken from inside `beforeTransactionCommit` still sees the pre-transaction profile name.

---

<a id="p1-11"></a>
## 11. The API "contract" performs no runtime validation on 21 of 24 response types

[packages/shared/src/apiContract.ts:285-289](packages/shared/src/apiContract.ts#L285):

```ts
function objectResponseSchema<T>(): z.ZodType<T> {
  return z.custom<T>((value) => typeof value === "object" && value !== null && !Array.isArray(value), {
    message: "Expected an API response object."
  });
}
```

This accepts `{}` as a valid `AppBootstrap`, `AnalyticsSummary`, `HealthDataDetail`, and so on. It backs 21 exported schemas at [L291-L310](packages/shared/src/apiContract.ts#L291) and [L461-L465](packages/shared/src/apiContract.ts#L461). Only `measurementPinStateResponseSchema` ([L298](packages/shared/src/apiContract.ts#L298)) and the paginated care schemas are real. A search for these schema names across `apps/api/src/**` returns **zero matches** — the server never validates its own responses either.

Related contract gaps in the same package:
- `healthEventSchema` ends with `.transform((value) => value as HealthEvent)` ([apiContract.ts:365](packages/shared/src/apiContract.ts#L365)), casting away the discriminated union declared at [types.ts:117](packages/shared/src/types.ts#L117).
- Replica sync payloads are `payload: z.record(z.unknown())` ([replicaSync.ts:73](packages/shared/src/replicaSync.ts#L73)) across all 13 entity types, and the handshake is pinned to `z.literal(2)` ([replicaSync.ts:84-89](packages/shared/src/replicaSync.ts#L84)) with **no version negotiation**. Once the companion is in the Play Store you cannot force-update it; a phone on protocol 2 talking to a desktop on protocol 3 hard-fails instead of degrading.
- Query and input types are written twice — hand-written interfaces at [types.ts:237-275](packages/shared/src/types.ts#L237) mirrored by zod schemas at [apiContract.ts:395-452](packages/shared/src/apiContract.ts#L395) with no `z.infer` connecting them.
- `CareItem` has three disagreeing definitions: `kind` is `string` in all three ([types.ts:212](packages/shared/src/types.ts#L212), [apiContract.ts:368](packages/shared/src/apiContract.ts#L368), [storeSchema.ts:149](packages/shared/src/storeSchema.ts#L149)) despite `careItemKindCodes` existing at [types.ts:118-130](packages/shared/src/types.ts#L118); and `completedHealthEvent` exists in the type and the wire schema but is **absent from the `.strict()` persisted schema** ([storeSchema.ts:148-155](packages/shared/src/storeSchema.ts#L148)) — so it cannot round-trip to disk.

**Why hard later:** every shipped client assumes the shape holds. After beta, a server-side field rename produces silent `undefined` propagation into charts rather than a loud parse error, diagnosed from user reports instead of a stack trace.

**Action:** replace `objectResponseSchema` with real `z.object({...}).strict()` schemas and derive TS types via `z.infer` so type and validator cannot diverge. Validate on the server response path with a single `res.json(schema.parse(payload))` helper. Make `kind` a `z.enum(careItemKindCodes)`. Replace the `z.literal` handshake with min/max supported-version negotiation **before any client is published**.

**Status — Resolved (Phase 5).** `objectResponseSchema` is deleted. All 21 call sites are now real `z.object({...}).strict()` schemas, and every response type that was previously hand-written twice is derived once — query and input types come from `z.infer`/`z.input` on the contract schemas, and the duplicated interface blocks in `types.ts` and `apps/web/src/types.ts` are gone. `{}` is now rejected as an `AppBootstrap`, which a shared-package test asserts directly.

The server validates its own responses. `apps/api/src/routes/sendJson.ts` exposes `sendJson(response, schema, payload)`, which `safeParse`s and throws a `ResponseContractError` (HTTP 500) on drift — deliberately a server fault rather than a 400 blaming the caller. It is applied on every JSON route across `dataRoutes`, `companionSyncRoutes`, `importRoutes`, `profileRoutes`, `pairingRoutes`, `settingsRoutes`, `backupRoutes`, `companionMigrationRoutes`, and `queryRoutes`. Three routes stay raw by design: `GET /export` (a whole-store dump where re-validating every row on the way out is pure cost), `GET /analytics/storage` (a diagnostic blob with no stable shape), and the binary/HTML responses in `backupRoutes` and the OpenRouter callback, which are not JSON.

`healthEventSchema` is now a genuine `z.discriminatedUnion("kind", …)`, so the `.transform(v => v as HealthEvent)` cast is gone. `CareItem.kind` is `CareItemKind` in the TS type and `z.enum(careItemKindCodes)` in both wire schemas, and `completedHealthEvent` was added to the `.strict()` persisted schema so it round-trips to disk. One deliberate deviation: the *persisted* schema normalizes `kind` through `normalizedCareItemKind` rather than rejecting outright, so a store written by an earlier prototype still opens; the wire schemas remain strict.

Replica sync gained real negotiation. `COMPANION_REPLICA_MIN_PROTOCOL_VERSION`/`MAX` describe what this build speaks, the phone sends its own range on `/handshake`, and `negotiateReplicaProtocolVersion` picks the highest mutually supported version or fails with a 409 `REPLICA_PROTOCOL_UNSUPPORTED`. Legacy clients that send no range are treated as `{2,2}`. Payloads are no longer `z.record(z.unknown())` — each of the 13 entity types validates against its real schema via `superRefine`, using `.passthrough()` variants so a newer peer's extra fields survive version skew instead of being rejected.

Two related cleanups rode along: the duplicate request pipeline in `apps/web/src/api.ts` was deleted in favour of the shared `@vitana/api-client` transport, and `importHealthConnect`'s request body is now typed (the Health Connect request schema moved into `packages/shared`, with `apps/api` re-exporting it).

---

<a id="p1-12"></a>
## 12. Backup restore never migrates, and reports an old backup as a wrong passphrase

[apps/api/src/backupCrypto.ts:159](apps/api/src/backupCrypto.ts#L159) validates restored profile data with `healthStoreDataSchema.safeParse(profile.data)`. That schema is pinned to `z.literal(8)` ([storeSchema.ts:161-164](packages/shared/src/storeSchema.ts#L161)). A failure throws `BACKUP_DECRYPTION_ERROR` ([backupCrypto.ts:161](apps/api/src/backupCrypto.ts#L161)) — **the same error used for a wrong passphrase**.

So a backup taken at schemaVersion 7 and restored after a bump to 8 tells the user their passphrase is wrong. The migrating parser `parsePersistedHealthStore` exists but is not used on this path.

Two related problems:
- `BackupPayload` is a plain TypeScript interface with **no zod schema** ([backup.ts:40-45](packages/shared/src/backup.ts#L40)), so `apps/api` hand-writes validation with casts at [backupCrypto.ts:139-166](apps/api/src/backupCrypto.ts#L139). The most format-sensitive artefact you have is the only one without a schema.
- `schemaVersion: 3` is declared valid at [types.ts:551](packages/shared/src/types.ts#L551) but `parsePersistedHealthStore` has **no `version === 3` branch** ([storeSchema.ts:230-313](packages/shared/src/storeSchema.ts#L230)) — any v3 store falls through to a throw at [L313](packages/shared/src/storeSchema.ts#L313).

**Why hard later:** backups are the one artefact that legitimately crosses schema versions. Testers *will* restore an older file. Data loss plus a misleading error is the worst combination.

**Action:** route restore through `parsePersistedHealthStore`; split `BACKUP_DECRYPTION_ERROR` into "wrong passphrase" vs "unsupported format"; define `backupPayloadSchema` and derive `BackupPayload` from it; fix or remove the `3` literal and add a test asserting every literal in the union has a branch.

**Status — Resolved (Phase 4).** `decryptBackup` is now split at the point where the passphrase stops being in question. Only the AES-GCM decipher and gunzip sit inside the catch that raises the generic `BACKUP_DECRYPTION_ERROR`; everything after it runs on bytes the passphrase has already authenticated, so failures there raise `UnsupportedBackupFormatError` instead. That is not an oracle — an attacker cannot reach the format error without already knowing the passphrase. `backupRoutes.ts` maps the two onto distinct codes (`DECRYPT_FAILED` vs `BACKUP_UNSUPPORTED_FORMAT`) on both `/inspect` and `/restore`.

`backupPayloadSchema` and `backupProfileEntrySchema` now live in `packages/shared/src/backup.ts` and replace the hand-written validation, including the duplicate-profile check. The envelope is validated by zod; `data` is deliberately left as a passthrough object, because pinning it to the current version is what caused this finding. Each profile's data goes through `parsePersistedHealthStore`, so a backup taken at schemaVersion 7 restores cleanly after the bump to 8.

That migration would have invalidated the stored digest, since the digest covers the bytes as written. The digest is therefore checked *before* migration and, when it holds, re-stamped against the migrated data so the restore path keeps a real integrity check; when it does not hold the stale digest is left in place so `/restore` still refuses with `DIGEST_INVALID`.

`HealthStoreData.schemaVersion` is now the literal `8` rather than a union spanning every historical version — a value only ever produced by the parser, never consumed by it. The `3` is gone rather than given a branch, since no v3 store exists outside the unreleased build. `SUPPORTED_PERSISTED_SCHEMA_VERSIONS` is exported from `storeSchema.ts` and a test walks it to assert every advertised version has a parser branch, and that unlisted versions are rejected.

---

<a id="p1-13"></a>
## 13. Profile switching has no request cancellation — one profile's data can render under another's name

[apps/web/src/features/profiles/useProfileLifecycle.tsx:47-49](apps/web/src/features/profiles/useProfileLifecycle.tsx#L47):

```ts
async function refresh() {
  setSnapshot(await loadSnapshot());
}
```

No `cancelled` flag, no unmount guard, no request-generation token. `loadSnapshot` ([L226-236](apps/web/src/features/profiles/useProfileLifecycle.tsx#L226)) fires three parallel calls, and `refresh()` is invoked from `switchProfile` ([L91](apps/web/src/features/profiles/useProfileLifecycle.tsx#L91)), `createProfile`, `deleteProfile`, `replaceProfilePhoto`, `saveProfile`, and `editProfile`.

The mount effect immediately above it ([L37-45](apps/web/src/features/profiles/useProfileLifecycle.tsx#L37)) *does* guard with `cancelled` — the correct pattern is known and simply wasn't applied to the hot path.

The root cause is that cancellation is impossible app-wide: `ApiTransportRequest` ([packages/api-client/src/index.ts:62-75](packages/api-client/src/index.ts#L62)) has no `signal` field, and a search for `AbortController|AbortSignal` across `apps/web/src/**` returns **zero matches**.

**Why hard later:** switch from a child's profile to a pet's while the first request is in flight, and the slower response wins — you display one family member's health data under another's name. In a multi-profile health app that is a privacy defect, not a cosmetic bug, and it will be near-impossible to reproduce from beta feedback. Adding `signal` to the transport is a breaking change consumed by web, mobile, and desktop: cheap now, a coordinated three-app change once mobile ships.

**Action:** add `signal?: AbortSignal` to `ApiTransportRequest` and thread it through `createApiClient`. Add a request-generation token to `refresh`, and apply the same treatment to [TrackRoute.tsx:111-123](apps/web/src/features/track/TrackRoute.tsx#L111).

**Status — Resolved (Phase 6).**

- `ApiTransportRequest` gained `signal?: AbortSignal`, and `createApiClient`'s internal `request` forwards it to the transport.
- The read endpoints on the profile-switch hot path (`assignedProfiles`, `bootstrap`, `analytics`, `summary`, `healthDataDetail`, `healthDataChartSeries`, and the web-only `profiles.list`) now take an optional trailing signal.
- Both transports forward it: the web one via `fetchAsOwner`, which already spreads `RequestInit` into `fetch`; the companion one via `pinnedFetch`, which forwards it on the plain-HTTP path. Cancelling the *pinned* native call is Phase 8 work.
- `useProfileLifecycle` now holds a `{ generation, controller }` ref. `refresh()` increments the generation, aborts the previous controller, and only calls `setSnapshot` when its generation is still current; the mount effect aborts on unmount. Errors from a superseded or aborted load are swallowed rather than surfaced as a notice.
- `TrackRoute`'s three effects were converted from `cancelled` booleans to real `AbortController`s, so a superseded summary/detail/chart request is cancelled rather than merely ignored.
- Covered by `apps/web/src/features/profiles/useProfileLifecycle.test.tsx`: a slow load for profile A resolving after a switch does not overwrite profile B, and starting a new load aborts the in-flight one.

---

<a id="p1-14"></a>
## 14. No error boundary in either UI — one render throw blanks the app

**Web:** [apps/web/src/main.tsx:7-11](apps/web/src/main.tsx#L7) renders `<App/>` bare inside `StrictMode`. A search for `ErrorBoundary|componentDidCatch` across `apps/web/src/**` returns **zero matches**.

**Mobile:** same result across `apps/android-companion` — `App.tsx` renders providers and the navigator directly, and consumers throw freely (e.g. `requireCareService` at [MobileApiProvider.tsx:612](apps/android-companion/src/MobileApiProvider.tsx#L612)).

This compounds with P1-11 and P1-15: unvalidated `undefined` reaching `rawMin.toFixed(1)` at [Charts.tsx:311](apps/web/src/components/Charts.tsx#L311), or a `RangeError` from spreading a large array into `Math.min`, unmounts the whole tree — white screen, no recovery, no message.

**Why hard later:** testers will report "it went blank" with no diagnostic, and you will never learn what actually broke in the field.

**Action:** add a top-level boundary in `main.tsx` plus one per route panel in [App.tsx:315-415](apps/web/src/App.tsx#L315), and one in the mobile `App.tsx` with a "reset local data" escape hatch. Render the error text and log it.

**Status — Resolved (Phase 6).**

- New `apps/web/src/components/ErrorBoundary.tsx` — a class boundary that renders the error message in a `role="alert"` panel, logs the error and component stack to the console (health data never leaves the device, so nothing is reported anywhere), and offers a "Try again" reset with an optional `onReset` callback.
- `main.tsx` wraps `<App/>`; `App.tsx` wraps each of the seven route panel bodies (Dashboard, Settings, Import, Track, Care, Insights, Export) so a failure is contained to that panel and the rest of the data stays reachable.
- New `apps/android-companion/src/AppErrorBoundary.tsx` wraps the whole companion tree inside `SafeAreaProvider`. Its escape hatch calls `resetStandaloneStorage()` (platform-resolved to the SQLCipher reset on device, the in-memory reset on web preview) and `clearConnection()`, returning the app to first-run state without a reinstall. The copy is explicit that PC-side data is untouched.
- Covered by `apps/web/src/components/ErrorBoundary.test.tsx` (3 tests: catches a throwing child, recovers on retry once the cause is gone, passes children through untouched).

---

<a id="p1-15"></a>
## 15. Two crash-class performance bugs on the chart path

**`mergeHealthDataDetail` is O(n²) and sits on "load more".** [packages/shared/src/mobileFeatures.ts:79-93](packages/shared/src/mobileFeatures.ts#L79):

```ts
const chartPoints = [...current.chartPoints, ...nextPage.chartPoints]
  .filter((point, index, points) =>
    points.findIndex((candidate) => chartPointKey(candidate) === chartPointKey(point)) === index)
```

`findIndex` inside `filter` over the *accumulated* array, allocating a fresh key string per comparison. Called from [TrackRoute.tsx:257](apps/web/src/features/track/TrackRoute.tsx#L257) and [TrackDetailScreen.tsx:114](apps/android-companion/src/screens/TrackDetailScreen.tsx#L114). Each page press makes the next one quadratically slower.

**Spreading unbounded arrays into `Math.min`/`Math.max`.** Five sites: [mobileFeatures.ts:106-107](packages/shared/src/mobileFeatures.ts#L106), [Charts.tsx:82-83](apps/web/src/components/Charts.tsx#L82), [Charts.tsx:110-111](apps/web/src/components/Charts.tsx#L110), [Charts.tsx:280-283](apps/web/src/components/Charts.tsx#L280). `Math.min(...values)` pushes every element onto the call stack and throws `RangeError` around 100k arguments. The raw chart path is capped server-side (`maxRawChartPoints`, [duckdbProjections.ts:445](apps/api/src/storage/duckdbProjections.ts#L445)) but the aggregated path is not — [duckdbProjections.ts:475](apps/api/src/storage/duckdbProjections.ts#L475) returns `truncated: false` with no cap, and `MiniChart`/`QueryChart` receive uncapped arrays.

**Why hard later:** both only misbehave once a user has real accumulated history — i.e. after your testers have been recording for weeks, at which point it is their data that is slow or crashing.

**Action:** dedupe with a `Map` keyed on `chartPointKey`; replace the five spreads with a single `reduce` pass. Both are small, well-localised changes.

**Status — Resolved (Phase 6).**

- `mergeHealthDataDetail` now builds a `Map<string, HealthDataDetailChartPoint>` keyed on `chartPointKey` in a single pass over each page, then sorts once. Key construction dropped from ~(2n)² to exactly 2n.
- New exported helper `finiteExtent(values)` in `mobileFeatures.ts` walks a sequence and skips non-finite entries. It replaces every `Math.min(...)`/`Math.max(...)` spread in `calculateChartDomain`, `MiniChart`, `QueryChart`, and `DetailTrendChart` (including the `Math.min(rawMin, ...referenceValues)` form). `DetailTrendChart` keeps a separate point-only extent so the aria label still describes the data rather than the reference range.
- The aggregated chart path in `duckdbProjections.ts` is now capped by `maxAggregatedChartBuckets = 1000`, keeping the most recent buckets and reporting `truncated` honestly instead of the hard-coded `false`.
- Also in this phase: `SummaryPage.tsx` hoists the transfer-window `RegExp` to module scope (it was recompiled per rendered row) and memoizes the per-category row sort with `useMemo` keyed on the summary and sort order (it re-sorted every category on every unrelated re-render).
- Covered by `packages/shared/src/__tests__/mobileFeatures.test.ts`: a deterministic O(n) dedupe assertion that counts identity-key builds via a `value` getter, plus `finiteExtent` over 200,000 values (which the old spread form could not survive).

---

<a id="p1-16"></a>
## 16. Push to `main` runs nothing but a job whose tests all skip

Every DuckDB integration and durability test is guarded by `skipIf(!httpfsExtensionPath)` — e.g. [duckdbRepository.durability.test.ts:25](apps/api/src/__tests__/duckdbRepository.durability.test.ts#L25) and 30+ occurrences in [duckdbRepository.integration.test.ts](apps/api/src/__tests__/duckdbRepository.integration.test.ts#L45). **A skip reports as a pass.**

The `post-merge-storage-validation` job ([.github/workflows/ci.yml:83-119](.github/workflows/ci.yml#L83)) runs on `ubuntu-latest` and omits the `Prepare DuckDB encryption extension` step that [durability-tests.yml:33-34](.github/workflows/durability-tests.yml#L33) has. It *could not* include it: [scripts/prepare-duckdb-httpfs.mjs:11-14](scripts/prepare-duckdb-httpfs.mjs#L11) only defines a pinned SHA for `windows_amd64` and throws otherwise. So on every push to `main`, 100% of durability tests skip and the job reports green.

Compounding this, `typecheck-and-build`, `test`, and `audit` are all gated `if: github.event_name != 'push'` ([ci.yml:20](.github/workflows/ci.yml#L20), [L53](.github/workflows/ci.yml#L53), [L128](.github/workflows/ci.yml#L128)). **A direct push to `main` therefore runs nothing but the no-op durability job.**

Related CI gaps:
- Integration tests are disabled everywhere and the stated reason is stale. All `push`/`pull_request` triggers are commented out in [integration-tests.yml:4-14](.github/workflows/integration-tests.yml#L4), and [ci.yml:113-115](.github/workflows/ci.yml#L113) says *"not working in CI currently due to DuckDB dependencies"* — but the workflow still targets `ubuntu-latest` ([L19](.github/workflows/integration-tests.yml#L19)) and calls a script that throws on Linux by design. The blocker is a runner-OS mismatch, not a fundamental problem.
- **No automated job ever exercises the upgrade-over-existing-data path.** The `Full` scope of [windows-desktop-smoke.ps1](scripts/windows-desktop-smoke.ps1#L229-L234) installs a baseline, upgrades over it, and verifies the storage manifest hash survived at [L250](scripts/windows-desktop-smoke.ps1#L250) — but the release workflow runs `-Scope Fast` ([release-windows.yml:92](.github/workflows/release-windows.yml#L92)), which returns early at [L187-196](scripts/windows-desktop-smoke.ps1#L187) before any of that. `desktop-smoke.yml` is `workflow_dispatch:` only, and the daily cron in `ci.yml` is commented out.
- The Android test runner cannot see a single component test: [apps/android-companion/vitest.config.ts:6](apps/android-companion/vitest.config.ts#L6) uses `include: ["src/**/*.test.ts"]` with `environment: "node"` — `.test.tsx` is not matched and no `.test.tsx` files exist. `MobileApiProvider`, every screen, `TrendChart`, the lease/cleanup logic, and the staged-deletion timer all have **zero coverage** — precisely where the P1/P2 mobile fixes land.

**Action:** ungate the PR jobs so pushes to `main` run them; move the storage job to `windows-2022` with the prepare step; make `findPreparedExtension()` throw rather than skip when `VITANA_REQUIRE_DUCKDB=1` (the pattern already exists at [server.integration.test.ts:31-33](apps/api/src/__tests__/server.integration.test.ts#L31)); switch `integration-tests.yml` to `windows-2022` and re-enable the PR trigger; run `desktop-smoke.yml` with `full`/`nsis` nightly and switch the release workflow to `-Scope Full` against the previous release tag; add `.tsx` to the Android include glob and switch to `@testing-library/react-native`.

**Status: mostly resolved (phase 0).** The PR jobs are ungated so pushes to `main` run them, the storage-validation and integration jobs moved to `windows-2022` with the prepare step, the shared `findPreparedExtension()` / `requirePreparedExtension()` helper in `apps/api/src/__tests__/support/duckdbExtension.ts` fails rather than skips when `VITANA_REQUIRE_DUCKDB=1`, and the Android include glob now matches `.tsx`. Still outstanding and deferred to phase 10: running `desktop-smoke.yml` at `-Scope Full` against the previous release tag, and adding `@testing-library/react-native` with actual component tests — the glob matches, but no `.tsx` tests exist yet.

---

<a id="p1-17"></a>
## 17. Desktop lifecycle: three unguarded failure paths

**The user-data migration races the single-instance lock.** [apps/desktop/main.cjs:25-30](apps/desktop/main.cjs#L25) executes at module load, before the single-instance guard is reached at [L127](apps/desktop/main.cjs#L127). Inside, [user-data-migration.cjs:28-29](apps/desktop/user-data-migration.cjs#L28) does `fs.rmSync(destinationPath, { recursive: true })` then `fs.renameSync(legacyPath, destinationPath)`. Two processes starting together — double-click plus the `--background` autostart configured in [background-service.cjs:2-8](apps/desktop/background-service.cjs#L2) — both pass the `hasData` check, then one `rmSync`es the directory the other just renamed into. This only fires on the legacy→branded transition, so it hits exactly the early testers upgrading from an old build, and it destroys data silently.

**Quit has no shutdown timeout.** [main.cjs:214-226](apps/desktop/main.cjs#L214) calls `event.preventDefault()` then `void apiServer.shutdown().then(() => app.quit())` with no timeout and no fallback — while the update path at [main.cjs:57-61](apps/desktop/main.cjs#L57) correctly races a 10s timer. `shutdown()` ([apps/api/src/server.ts:122-129](apps/api/src/server.ts#L122)) calls `server.close()`, which waits for all open sockets, and a repo-wide search for `closeAllConnections|closeIdleConnections|keepAliveTimeout` returns **zero matches**. A mid-sync companion device keeps the socket open, the app never quits, and the user force-kills it mid-checkpoint.

**Startup failure leaks an open encrypted database.** In [server.ts:96-116](apps/api/src/server.ts#L96), `closeStorage()` is wired **only** to `server.once("close", ...)`, but `ProfileStoreManager.open()` happens earlier at [L62-66](apps/api/src/server.ts#L62). If `server.listen()` rejects — the port-conflict case, since the port is a fixed `4317` default at [main.cjs:155](apps/desktop/main.cjs#L155) — the `"close"` event never fires, `startServer` throws, and the DuckDB handles are abandoned. `before-quit` then bails because `apiServer` was never assigned.

**And nothing catches a stray rejection.** A search across `apps/api/src` for `unhandledRejection|uncaughtException` returns **zero hits**; only `SIGTERM`/`SIGINT` are handled ([server.ts:149-150](apps/api/src/server.ts#L149)). On Node ≥15 an unhandled rejection terminates the process, bypassing `closeStorage()` entirely — no `CHECKPOINT`, no clean `DETACH`.

**Action:** move `migrateUserDataDirectory` inside the `requestSingleInstanceLock()` success branch; mirror the update path's `Promise.race` on quit and call `server.closeAllConnections()`; wrap everything after `ProfileStoreManager.open()` in `try/catch` that closes storage before rethrowing; register `uncaughtException` and `unhandledRejection` handlers that run the same `closeStorage()` path.

**Status — Resolved (Phase 9).**

- `migrateUserDataDirectory` now runs inside the `requestSingleInstanceLock()` success branch. `desktop-lifecycle.test.cjs` asserts the declaration ordering in `main.cjs` so a future reshuffle cannot silently reintroduce the race.
- `before-quit` races a 10s timer and force-exits with code 1 rather than hanging. `server.shutdown()` now calls `closeIdleConnections()` and `closeAllConnections()` so a keep-alive companion socket cannot hold the quit open.
- `startServer` declares `closeStorage()` immediately after `ProfileStoreManager.open()` and wraps everything after it in `try/catch`, releasing the DuckDB handles on any later failure. `serverLifecycle.test.ts` proves it by forcing `EADDRINUSE` and asserting `closeAll()` ran exactly once.
- `uncaughtException` and `unhandledRejection` now route through the same storage-close path before exiting.
- The lifecycle state machine is extracted into `apps/desktop/desktop-lifecycle.cjs` (`createDesktopLifecycle`) following the `background-service.cjs` DI pattern, covered by 11 behavioural tests with fakes.
- `apps/desktop/tsconfig.json` typechecks the production `.cjs` files with `checkJs` and is wired into the root `typecheck` script.
- `duckdb` is pinned to an exact `1.4.4`. The version and the httpfs SHA-256 are declared once in `packages/shared/src/duckdbPin.ts` and consumed by `prepare-duckdb-httpfs.mjs`, `profileStoreManager.ts` and the docs; `package-config.test.cjs` fails if they drift.
- The NSIS `customInstall` firewall step is now a non-fatal `DetailPrint` warning instead of an `Abort`, so an upgrade can no longer leave a half-removed install.
- Startup sweeps orphaned temp files using a PID-liveness check plus a 5-minute minimum age. This lives in `apps/api` (`profileStoreManager.openDuckDb`) rather than the desktop shell, because the storage layer owns both the temp-file creation and the storage root, so every host benefits.
- Bonus: `pre-update-backup.cjs` was missing from the electron-builder `build.files` allowlist and would have crashed packaged builds. Fixed, with a regression test that checks every local module `main.cjs` requires is packaged.

**Deferred.** Binding `127.0.0.1` by default and rebinding `0.0.0.0` only when a device is paired is not implemented. `paired-devices.json` only ever holds approved, token-delivered devices, so on a clean install the file is empty, the API would bind loopback, and the phone could never reach `/pair` to create the first record. This needs its own design (an on-demand LAN listener, or a persisted opt-in flag) and is tracked separately.

---

<a id="p1-18"></a>
## 18. Undeclared dependencies in the mobile app

[apps/android-companion/package.json:6-36](apps/android-companion/package.json#L6) declares `@vitana/api-client` but **not `@vitana/shared`**, which is imported in 20+ files (e.g. [chartSeries.ts:5](apps/android-companion/src/chartSeries.ts#L5)). [ImportScreen.tsx:6](apps/android-companion/src/screens/ImportScreen.tsx#L6) imports `expo-keep-awake`, also undeclared. Both resolve only via npm workspace hoisting.

**Why it matters now:** any hoisting change, a `--legacy-peer-deps` install, or a standalone EAS build context breaks the bundle with a confusing "unable to resolve module" — during a beta push, under time pressure.

**Action:** add `"@vitana/shared": "^0.1.0"` and the correct `expo-keep-awake` version to `dependencies`. One-line fix.

---

<a id="p1-19"></a>
## 19. Encryption key loss on Android is silent, unrecoverable, and can be triggered by a string match

[apps/android-companion/src/standalone/databaseKey.ts](apps/android-companion/src/standalone/databaseKey.ts) exposes only get-or-create; there is no rotation path and `PRAGMA rekey` appears nowhere. On open failure, [databaseKey.ts:42](apps/android-companion/src/standalone/databaseKey.ts#L42) removes the freshly generated key.

Android Keystore entries backing `expo-secure-store` can be invalidated by lock-screen or biometric changes, or by restore-to-a-new-device. When that happens the app generates a *new* key, fails to decrypt, deletes it, and repeats every launch — with no message telling the tester their data is gone.

Worse, the recovery heuristic can destroy the key on an error-string match: [sqliteLocalStore.ts:63-73](apps/android-companion/src/standalone/sqliteLocalStore.ts#L63) reacts to `isFileNotDatabaseError` by deleting the DB **and** calling `secureKeyStore.remove()`, where the detector in [databaseRecovery.ts](apps/android-companion/src/standalone/databaseRecovery.ts) is a lowercase substring match on SQLite's error text — not a stable API.

Config makes this ambiguous too: [app.config.js:13](apps/android-companion/app.config.js#L13) sets `allowBackup: false` while [app.config.js:48](apps/android-companion/app.config.js#L48) configures `["expo-secure-store", { configureAndroidBackup: true }]`. Two sources disagree about whether backup exists; flip one later and the key's backup semantics change silently — either the key is backed up while the DB is not (unreadable restore) or vice versa.

**Action:** add a distinct "key missing / data unreadable" state instead of a generic open error; add a `rekey(oldKey, newKey)` path; add a user-visible export-then-reset flow; gate key deletion on positive proof the file is an empty plaintext DB rather than on an error string; pick one backup posture and set both flags consistently.

### Status — Resolved (Phase 7)

- `localDatabaseState.ts` introduces `LocalDatabaseError` with a `reason` of `key-missing`, `data-unreadable`, `sqlcipher-unavailable`, or `migration-failed`. `openSqliteDatabaseOnce` classifies failures: a freshly minted key against a database file that already existed is `key-missing` (ciphertext intact, key lost), a first-read failure without a generated key is `data-unreadable`, and a failure after the database read cleanly is `migration-failed`.
- The string-matched destructive recovery is gone. `isFileNotDatabaseError` has been deleted; recovery is attempted for *any* open failure and the only gate on key deletion is the positive proof in `deleteEmptyPlaintextDatabase` — the file must open unencrypted and contain zero tables.
- `rekeyDatabase(database, oldKeyHex, newKeyHex)` proves the current key with a read before issuing `PRAGMA rekey`, then reads again under the new key. `rekeySqliteLocalStorage()` wraps it, refuses to run while any store lease is open, and persists the replacement key only after the rotation succeeds.
- Backup posture is now consistent: `configureAndroidBackup` is `false`, matching `android.allowBackup: false`, and `nativeConfig.test.ts` asserts it.
- `SqliteLocalStore.reset()` releases its lease through `close()` instead of closing the shared handle behind the accounting's back. Previously the lease count stayed above zero, so `resetSqliteLocalStorage()` threw and the module kept caching a closed handle.
- Coverage: rekey round-trip and wrong-old-key tests against a SQLCipher stand-in, malformed/unchanged key rejection, a reset lease-accounting test asserting the connection is torn down and a fresh one opened, and a test that reset is refused while a second store holds a lease.

**Deferred:** the user-visible export-then-reset flow. The distinct failure reasons are its prerequisite and are now in place; surfacing them in the companion UI is UI work outside this phase.

---

# P2 — Fix soon

## Storage and API

- **Migration v5 irreversibly rewrites values, guarded only by a unit string.** [duckdbRuntime.ts:355](apps/api/src/storage/duckdbRuntime.ts#L355). If the guard is ever wrong, or a re-import reintroduces old-format rows, values are silently divided with no detection. Disappears entirely if you take the v1-baseline route in P1-4. **Resolved in Phase 2** — the legacy migration chain is gone; `schemaVersion = 1` is a single baseline migration.
- **Analytical views are embedded in migration SQL.** v2 injects `dailyMetricsViewSql`/`weeklyMetricsViewSql`, v6 injects the AI views, and **v10 exists solely to drop and recreate them**. Views are derived, not data — move creation to a `CREATE OR REPLACE VIEW` pass on every `open()` next to `reconcileDefaultMeasurementTypes`, so a cosmetic view change stops costing a schema version. **Resolved in Phase 2** — `applyAnalyticalViews(connection)` runs on every `open()` with fingerprint-based no-op detection.
- **Every profile database opens at startup and stays open at 256 MB.** [profileStoreManager.ts:72](apps/api/src/storage/profileStoreManager.ts#L72) holds a `Map` populated by opening every registered profile **sequentially** with `memoryLimit: "256MB"` (runtime default is `"64MB"`), and nothing ever evicts. The product explicitly targets families with multiple profiles including pets and children: six profiles is 1.5 GB of configured limit plus linear startup latency. Open lazily; close idle stores on a timer.
- **Synchronous filesystem I/O throughout the store manager, including in the constructor.** [profileStoreManager.ts:1-11](apps/api/src/storage/profileStoreManager.ts#L1) imports the entire sync `fs` surface; the constructor calls `mkdirSync` at [L76](apps/api/src/storage/profileStoreManager.ts#L76). Every one of these blocks the event loop and therefore every concurrent HTTP request.
- **Non-atomic two-file writes.** *(Still open — partially mitigated.)* `createProfile` ([L128](apps/api/src/storage/profileStoreManager.ts#L128)) writes the registry then the manifest with hand-rolled compensation; the delete path repeats it. A crash between the two leaves them disagreeing, and `loadStorageBackendManifest` throws `"Storage backend manifest is invalid."` — a hard startup failure. Write one combined document atomically (temp + fsync + rename).
- **Restore has a crash window that can leave no live database.** [profileStoreManager.ts:223-225](apps/api/src/storage/profileStoreManager.ts#L223) performs two separate `renameSync` calls after `await store.close()`. A crash between them leaves the live path absent and only a `.rollback` file on disk. Write the journal entry recording *both* intended renames before performing either, make `RestoreJournal.recover()` handle "live missing, rollback present" and "live missing, staged present", and add a durability test for a kill between the two renames — the crash-worker harness already exists.
- **`closeAll()` has no per-store error handling.** [profileStoreManager.ts:327](apps/api/src/storage/profileStoreManager.ts#L327) uses `Promise.all` with no per-item catch, so one bad store aborts shutdown and the rest are never checkpointed. Use `allSettled`.
- **Store-manager errors surface as opaque 500s.** `getStore` throws a bare `Error("DuckDB profile X is not registered.")`; the handler at [createApp.ts:380-457](apps/api/src/createApp.ts#L380) defaults to 500. The layer already defines typed errors (`RepositoryValidationError`, `HealthEventDeleteConflictError`) and even has a `requestError(status, message)` helper. Use them so "not found" is a 404.
- *(Still open — partially mitigated: the entry point now defaults to 100, but one inner path remains unbounded.)* **`measurementDetails` returns an unbounded result when `limit` is undefined** ([duckdbProjections.ts:631-648](apps/api/src/storage/duckdbProjections.ts#L631)) — inconsistent with the disciplined clamping everywhere else in the same file (`min(max(limit,1),100)`, `maxAnalyticalRows`, `maxDailyChartBuckets = 366`).
- **`appBootstrap`/`storageCounts` run a 7-subquery `COUNT(*)` block** ([duckdbProjections.ts:129-136](apps/api/src/storage/duckdbProjections.ts#L129), [L798-806](apps/api/src/storage/duckdbProjections.ts#L798)) on every bootstrap and every import (now six subqueries). Cache and invalidate on write. **Still open.**
- **`listCareItems` uses three correlated scalar subqueries per row**, in two near-identical query bodies ([duckdbProjections.ts:753-762](apps/api/src/storage/duckdbProjections.ts#L753) and [L777-786](apps/api/src/storage/duckdbProjections.ts#L777)). Replace with `LEFT JOIN` and de-duplicate.
- **Application-side sequences via `MAX(ordinal)+1` / `MIN(ordinal)-1`** ([duckdbCommands.ts:657](apps/api/src/storage/duckdbCommands.ts#L657)) — a full aggregate scan per insert, with a string-interpolated table name, and correctness resting on the single-connection assumption that P1-10 shows is already violated. `prependOrdinal` also means `insights`, `health_events`, `care_items` and `audit_events` ordinals grow negative forever. **Resolved in Phase 3** — `ordinalBounds()` caches bounds per connection in a `WeakMap` instead of re-aggregating per insert.
- **Positional inserts with no column lists, plus regex-based SQL rewriting.** [duckdbRows.ts:80](apps/api/src/storage/duckdbRows.ts#L80) is `INSERT OR IGNORE INTO observations VALUES (?,?,…)` — 14 positional parameters, no column names — and `insertRows` at [L43](apps/api/src/storage/duckdbRows.ts#L43) *parses the SQL with a regex* to rebuild a multi-row `VALUES` clause. Any column added mid-table in a future migration silently shifts every positional insert, with no compile-time or runtime guard. **Resolved in Phase 2** — `insertRows()` emits explicit column lists and the regex rewrite is gone.
- **`exportData()` writes an audit row inside what callers treat as a read** ([duckdbExport.ts:30-32](apps/api/src/storage/duckdbExport.ts#L30)), forcing it through the mutation queue — so taking a backup blocks all writes.

## SQLite-swap portability

The repository abstraction is good but leaks in four specific places. These are the blockers for the provider swap the project explicitly wants to keep open.

- **`runCompiledQuery(sql: string)` is declared on `ProfileRepository` itself** ([profileRepository.ts:161](apps/api/src/storage/profileRepository.ts#L161)) — raw SQL in, untyped rows out, on the interface that is supposed to hide the engine. Change it to accept the compiled DSL/plan object and let each implementation compile it. `AnalyticsQueryCompiler` already has `dialect: "duckdb" | "sqlite"`.
- **SQL generation lives outside `storage/`, and the dispatch point is a stub.** [analyticsBackend.ts:58-60](apps/api/src/storage/analyticsBackend.ts#L58) — `analyticsQueryCompilerFor(_storeManager)` ignores its argument and always returns DuckDB.
- *(Still open, and now larger: ~26 occurrences after the Phase 2-3 work, across `duckdbCommands.ts`, `duckdbProjections.ts`, `duckdbRows.ts` and `duckdbSchema.ts`.)* **`SELECT * EXCLUDE (...)` in ~16 places** — 13 in [duckdbProjections.ts](apps/api/src/storage/duckdbProjections.ts#L109) plus [duckdbRows.ts:39](apps/api/src/storage/duckdbRows.ts#L39), [duckdbSchema.ts:31](apps/api/src/storage/duckdbSchema.ts#L31), [duckdbExport.ts:44](apps/api/src/storage/duckdbExport.ts#L44). No SQLite equivalent; each is a manual rewrite and a chance to silently change a projection shape. Also `from_base64(...)` at [duckdbCommands.ts:125](apps/api/src/storage/duckdbCommands.ts#L125) and `DATE_TRUNC('${bucket}', ...)` at [duckdbProjections.ts:522](apps/api/src/storage/duckdbProjections.ts#L522). Replacing `EXCLUDE` with explicit column lists is mechanical and also fixes the `raw_content` footgun.
- **Layering inversions.** [profileRepository.ts:47](apps/api/src/storage/profileRepository.ts#L47) — the engine-agnostic interface imports `StoredReplicaPage` from the DuckDB-named module; [duckdbHealthStore.ts:30](apps/api/src/storage/duckdbHealthStore.ts#L30) imports from `../summary.js`; [L27](apps/api/src/storage/duckdbHealthStore.ts#L27) imports `StoreSecurityMode` from its own manager. Move shared DTOs to a neutral `storage/types.ts`.

## iOS portability

- **Certificate pinning — the core security control — is Android-only.** [expo-module.config.json:2](apps/android-companion/modules/vitana-pinned-http/expo-module.config.json#L2) declares `"platforms": ["android"]`; the module has only `android/` plus a web stub with no `request` method, and every API call routes through it via [api.ts:10](apps/android-companion/src/api.ts#L10). Reimplementing it means a Swift module replicating OkHttp's pinned `X509TrustManager` and the permissive hostname verifier at [VitanaPinnedHttpModule.kt:97](apps/android-companion/modules/vitana-pinned-http/android/src/main/java/app/vitanahealth/pinnedhttp/VitanaPinnedHttpModule.kt#L97). **Define the module's TypeScript contract — including structured error codes — now**, while there is no shipped behaviour to preserve.
- **Health Connect is used directly with no provider abstraction.** [syncHealthConnect.ts:231](apps/android-companion/src/syncHealthConnect.ts#L231) hard-throws on non-Android; the file imports `react-native-health-connect` at module top level and hardcodes 14 descriptors bound to its `RecordType` union ([L100-196](apps/android-companion/src/syncHealthConnect.ts#L100)). HealthKit has a different permission model, different pagination (anchored queries), and different record shapes — all 564 lines are Android-shaped. Extract a `HealthSourceProvider` interface into `packages/shared` **before the descriptor list grows further**.
- **Android's vocabulary is baked into persisted state.** `healthConnectSyncCursor` / `healthConnectCategories` in [endpointStore.ts](apps/android-companion/src/endpointStore.ts). Renaming these post-beta requires an AsyncStorage migration on every paired device — rename to `healthSourceCursor` / `healthSourceCategories` now. (Do it in the same change as the per-category cursor from P1-7.) **Resolved in Phase 8** — renamed to `healthSourceCursors` / `healthSourceCategories` with a `loadConnection` migration.
- **No iOS configuration exists at all.** [app.config.js](apps/android-companion/app.config.js) has no `ios` key — no `bundleIdentifier`, no `infoPlist` usage strings — and [eas.json](apps/android-companion/eas.json) has no iOS profiles, yet [package.json:46](apps/android-companion/package.json#L46) ships an `"ios": "expo run:ios"` script that cannot succeed. Adding the `ios` block now makes `expo run:ios` fail with *real* errors, which makes the remaining work measurable.
- **The desktop platform gate is a scalar, not a table.** [profileStoreManager.ts:435](apps/api/src/storage/profileStoreManager.ts#L435) throws `"DuckDB storage productionization is currently approved only for Windows x64."` and compares against a single hardcoded digest at [L66](apps/api/src/storage/profileStoreManager.ts#L66). The pinning mechanism is right; its shape means adding macOS changes the check's structure rather than adding a row. Replace with `Record<`${platform}-${arch}`, string>`.

## Sync and replication

- **Replica page loops are unbounded and ignore disposal.** [syncCoordinator.ts:47-52](apps/android-companion/src/connected/syncCoordinator.ts#L47) and [L60-65](apps/android-companion/src/connected/syncCoordinator.ts#L60) are `do…while (cursor)` with no page cap and no check of the disposed flag set at [L28](apps/android-companion/src/connected/syncCoordinator.ts#L28) — `dispose()` only awaits the in-flight promise, it cannot stop it. A PC-side cursor bug becomes an infinite loop draining the battery and writing continuously to the encrypted DB.
- **Rewind detection deletes the whole replica.** [syncCoordinator.ts:41](apps/android-companion/src/connected/syncCoordinator.ts#L41). Any PC-side restore-from-backup makes every paired phone re-download its entire dataset. Reconcile by revision/content hash, or at minimum stage the new snapshot before deleting the old one so the user is never left with an empty app.
- **Live mutations have no rollback or offline queue.** [connectedDataSource.ts:104](apps/android-companion/src/connected/connectedDataSource.ts#L104) performs the PC-side write then forces a sync, with no compensating action if the follow-up fails. The phone shows stale data, the user re-submits, and duplicates appear. Add an idempotency key plus an outbox or an explicit "sent, not yet confirmed" state.
- **Retryability is decided by regex on error-message strings, duplicated.** [retryPinnedRequest.ts:20-25](apps/android-companion/src/retryPinnedRequest.ts#L20) and again at [syncHealthConnect.ts:388](apps/android-companion/src/syncHealthConnect.ts#L388), matching sentences that originate in Kotlin at [VitanaPinnedHttpModule.kt:57-67](apps/android-companion/modules/vitana-pinned-http/android/src/main/java/app/vitanahealth/pinnedhttp/VitanaPinnedHttpModule.kt#L57). Reword one for clarity — or localise the app — and retry silently stops working, with no test to catch it. Return a structured `code` and put the single retry policy in `packages/shared`. Backoff is also linear with no jitter. **Resolved in Phase 8** — both call sites now use `packages/shared/src/networkRetry.ts` with structured codes and full-jitter backoff.
- **Native timeouts do not cancel the request.** `pinnedFetch` races a `setTimeout`; the OkHttp call has no cancellation hook. A JS timeout firing before the Kotlin `callTimeout` produces a retry while the original upload is still in flight — the PC can receive the same chunk twice, and correctness rests entirely on undocumented server-side dedupe. **Resolved in Phase 8** — the Kotlin module keeps a call registry and exposes `cancel(requestId)`, and the server now dedupes by `batchId`. *(The Kotlin change is still compile-unverified — no Kotlin build runs in the Windows validation stack.)*
- **`LocalStore` conflates standalone data and the connected replica cache.** One interface ([localStore.ts:71-102](apps/android-companion/src/standalone/localStore.ts#L71)) and one 946-line implementation serve both, so a purely cache-shaped protocol change becomes a user-data migration with all the risk of P1-8. Split into a durable `standalone.db` and a disposable `replica.db`.
- **`SqliteLocalStore.reset()` bypasses lease accounting.** [sqliteLocalStore.ts:850-852](apps/android-companion/src/standalone/sqliteLocalStore.ts#L850) closes the database but never clears `sharedDatabase` or decrements `databaseLeases` ([L35-36](apps/android-companion/src/standalone/sqliteLocalStore.ts#L35)) — unlike the correct path at [L111](apps/android-companion/src/standalone/sqliteLocalStore.ts#L111). Afterwards, `acquireSharedDatabase()` returns a memoized promise for a *closed* handle and reset throws "Close active local data operations" forever.
- **Connection record is read-modify-written without a lock and fails open.** `loadConnection`/`saveConnection` in [endpointStore.ts](apps/android-companion/src/endpointStore.ts) rewrite the whole JSON blob; a parse failure returns `null`, which the app reads as "not paired". A cursor update racing a category save loses one, and one corrupted byte silently unpairs the device.

## Web and shared

- **A duplicate request pipeline sits alongside `createApiClient`.** [apps/web/src/api.ts:124-160](apps/web/src/api.ts#L124) redeclares `ResponseSchema`, `apiErrorFromResponse`, and a second `request<T>` — then instantiates the shared client anyway. `profilePhoto`, `updateObservation`/`deleteObservation`, and `settings.updates` are each implemented twice. Error handling, auth headers, and eventually cancellation must be maintained in both. Move the web-only owner-token injection into a custom *transport* and delete the second pipeline. **Resolved in Phase 6** — `apps/web/src/api.ts` now has one request pipeline.
- **A single mutation in Track fires six network round-trips.** [TrackRoute.tsx:111-123](apps/web/src/features/track/TrackRoute.tsx#L111) awaits four calls, one of which is App's refresh — itself three more calls. Triggered by pin, delete, edit, add, and reference-range set/remove, with no cancellation guard and four `setState` calls after the await.
- **Route panels use two contradictory visibility mechanisms.** [App.tsx:315-340](apps/web/src/App.tsx#L315) sets `hidden={route !== "dashboard"}` *and* renders `{route === "dashboard" ? <DashboardRoute/> : null}`. The `hidden` attribute is dead weight, and because the child unmounts, all fetched data, scroll position, form drafts, and pagination are discarded on every tab switch. Pick one. **Resolved in Phase 6** — only `hidden=` remains; panels stay mounted.
- **Import page polls twice as often as intended.** [ImportPage.tsx:412-414](apps/web/src/pages/ImportPage.tsx#L412) depends on `[pendingPairings]`, and the 5-second poll at [L417-432](apps/web/src/pages/ImportPage.tsx#L417) calls `setPendingPairings` with a freshly allocated array every tick even when nothing changed — so a `devices()` request fires every 5s forever. Both errors are silently swallowed.
- **Zero memoization across the web app.** A repo-wide search finds 8 `useMemo` calls in 3 files and **zero** `useCallback` or `React.memo`. [TrackRoute.tsx](apps/web/src/features/track/TrackRoute.tsx) — nine `useState`, three effects, a chart and a paginated table — has none. Don't blanket-memoize; target the measured hot paths below. *(Partially addressed in Phase 6 — 13 `useMemo` calls now; still zero `useCallback`/`React.memo`.)*
- **Tables render unvirtualized and re-sort on every render.** [SummaryPage.tsx:209](apps/web/src/pages/SummaryPage.tsx#L209) does `[...category.rows].sort(...)` inside a `.map()` in the render body, for every category, on every render including unrelated state changes. `ObservationTypeDetailPage` adds unmemoized `reduce`/`Set` scans at [L322-333](apps/web/src/pages/SummaryPage.tsx#L322) over an `entries` array that grows unbounded via `loadMore`. And [SummaryPage.tsx:63-66](apps/web/src/pages/SummaryPage.tsx#L63) builds a `new RegExp` per row per render — a 500-row table compiles 500 regexes on every keystroke elsewhere on the page.
- **Analytics copies and fully sorts arrays to find a single maximum.** [analytics.ts:104](packages/shared/src/analytics.ts#L104), [L64](packages/shared/src/analytics.ts#L64), and [L125](packages/shared/src/analytics.ts#L125) (`[...observations].sort(...).slice(-12)` — a full copy plus O(n log n) sort to take twelve elements). [L46](packages/shared/src/analytics.ts#L46) and [L69](packages/shared/src/analytics.ts#L69) call `personalReferenceRanges?.find(...)` inside a per-code loop.
- **`computeAnalytics(store: HealthStoreData)` structurally requires a full-profile read** ([analytics.ts:4](packages/shared/src/analytics.ts#L4)), called from [duckdbProjections.ts:143](apps/api/src/storage/duckdbProjections.ts#L143) and both mobile repositories. `calculateBiologicalAge` has the same shape. This is the pattern the project deliberately retired, and it forecloses pushing aggregation into SQL. The file already gestures at the fix — narrow the parameter to the projection actually needed.
- **`defaultMeasurementTypes` is mutated in place at module load.** [registry.ts:1218-1229](packages/shared/src/registry.ts#L1218) — a top-level loop assigns onto objects in the exported array, using helpers declared below it that work only via hoisting. The array is shared by reference across web, mobile, API, and desktop; any consumer that mutates a `MeasurementType` corrupts the registry process-wide. Build a frozen array with `.map()`.
- **`setState` after `await` with no mount guard** at [useProfileLifecycle.tsx:51-64](apps/web/src/features/profiles/useProfileLifecycle.tsx#L51) and [SettingsPage.tsx:91](apps/web/src/pages/SettingsPage.tsx#L91) — the correct `cancelled` pattern is already used two lines away. **Resolved in Phase 6** — profile lifecycle now uses a generation token plus `AbortController`.
- **Divergent shapes for the same import outcome.** [mobileRepository.ts:17-32](packages/shared/src/mobileRepository.ts#L17) uses plural `sourceImports`/`dataSources`; [apiContract.ts:275-281](packages/shared/src/apiContract.ts#L275) uses singular, plus an `evicted: z.literal(0)` field permanently pinned to zero.

## Mobile UI performance and stability

- **Zero virtualization: every list is `.map()` inside a `ScrollView`.** No `FlatList`, `SectionList`, `keyExtractor` or `getItemLayout` occurs anywhere in `apps/android-companion/src`. [TrackDetailScreen.tsx:358](apps/android-companion/src/screens/TrackDetailScreen.tsx#L358) has explicit pagination ([L418](apps/android-companion/src/screens/TrackDetailScreen.tsx#L418)) so its list grows without bound with every mounted row in the native view hierarchy — the classic "app gets slower the longer testers use it" report. [CareScreen.tsx:280-286](apps/android-companion/src/screens/CareScreen.tsx#L280) is the same. Converting late means restructuring headers, footers and `RefreshControl` on every screen.
- **`TrendChart` recomputes points, domain, and SVG path on every render** ([TrackDetailScreen.tsx:671-718](apps/android-companion/src/screens/TrackDetailScreen.tsx#L671)) inside a component that re-renders on all 17 pieces of parent state. Typing in the "add reading" form re-derives up to 500 points per keystroke.
- **Chart series is derived from pre-downsampled points.** [connectedRepository.ts:307-318](apps/android-companion/src/connected/connectedRepository.ts#L307) caps at 500 points by even-stride sampling across the *whole* history; [chartSeries.ts:27-29](apps/android-companion/src/chartSeries.ts#L27) then filters those already-thinned points by the range cutoff. With 5 years of data, "1M" yields roughly 8 points — a nearly empty chart that looks like missing data. Push the range cutoff into the query.
- **Every range change re-materializes the entire replica.** `healthDataChartSeries` → `healthDataDetail` → `detailEntries` ([connectedRepository.ts:392-467](apps/android-companion/src/connected/connectedRepository.ts#L392)) reads the whole replica from SQLite, `JSON.parse`s it, filters, and sorts. The `ReplicaProjection` memo at [L213](apps/android-companion/src/connected/connectedRepository.ts#L213) is invalidated by any sync, so this recurs constantly.
- **Stateful data sources holding DB handles are constructed inside `useMemo`.** [MobileApiProvider.tsx:124](apps/android-companion/src/MobileApiProvider.tsx#L124) and [L130](apps/android-companion/src/MobileApiProvider.tsx#L130), with cleanup in a *separate* effect at [L531](apps/android-companion/src/MobileApiProvider.tsx#L531). `useMemo` is not a lifecycle hook — React may discard and recreate the memo without running the cleanup, and StrictMode double-invokes it. Each orphaned source holds a DB lease that is never released, permanently blocking reset. The manual keep-alive refcount at [L122](apps/android-companion/src/MobileApiProvider.tsx#L122)/[L225-226](apps/android-companion/src/MobileApiProvider.tsx#L225)/[L244-245](apps/android-companion/src/MobileApiProvider.tsx#L244) has the same class of leak on any throw between acquire and release.
- **Staged deletion is silently cancelled by unmount after telling the user it succeeded.** [TrackDetailScreen.tsx:244-249](apps/android-companion/src/screens/TrackDetailScreen.tsx#L244) optimistically hides the row and schedules the real delete with `setTimeout(…, 6000)`; the unmount cleanup clears the timer. Navigate back within 6 seconds and the reading is not deleted — but the UI already said it was. Testers will report this as "deleted readings come back," which is a data-trust bug in a health app.
- **Full-resolution images are base64'd into JS and POSTed as a string.** [ImportScreen.tsx:444-452](apps/android-companion/src/screens/ImportScreen.tsx#L444) → a Kotlin `String` at [VitanaPinnedHttpModule.kt:44](apps/android-companion/modules/vitana-pinned-http/android/src/main/java/app/vitanahealth/pinnedhttp/VitanaPinnedHttpModule.kt#L44). The image exists simultaneously as a JS base64 string, a JSON body string, and a JNI string — roughly 4× file size in peak RAM, on the low-memory devices most likely to be beta hardware.
- **Profile photo is held in context state as a base64 data URI** for the app's lifetime ([MobileApiProvider.tsx:311-315](apps/android-companion/src/MobileApiProvider.tsx#L311)), re-diffed on every context change, with no cross-launch caching. Write to `expo-file-system` and keep only the `file://` URI.
- **Care lists are hard-capped at 30 with no way to see more** ([CareScreen.tsx:94-95](apps/android-companion/src/screens/CareScreen.tsx#L94)) — no `hasMore` handling, unlike `TrackDetailScreen`. Records 31+ are simply invisible, which reads as data loss.
- **Migration export loads all four tables fully into memory** before batching ([sqliteLocalStore.ts:393-416](apps/android-companion/src/standalone/sqliteLocalStore.ts#L393)) — defeating the purpose of `batchSize`, on the path run by the users with the most data.

## Build, release, and configuration

- **`duckdb` is the only floating version, and it determines the on-disk format.** [apps/api/package.json:24](apps/api/package.json#L24) declares `"duckdb": "^1.4.4"` while [prepare-duckdb-httpfs.mjs:15-17](scripts/prepare-duckdb-httpfs.mjs#L15) hard-throws unless the resolved version is *exactly* `1.4.4`. Electron, electron-builder and electron-updater are all exact-pinned. The extension SHA is also duplicated in three places: [prepare-duckdb-httpfs.mjs:12](scripts/prepare-duckdb-httpfs.mjs#L12), [profileStoreManager.ts:66](apps/api/src/storage/profileStoreManager.ts#L66), and [ENCRYPTED_DUCKDB_ARCHITECTURE.md:34](docs/ENCRYPTED_DUCKDB_ARCHITECTURE.md#L34). Pin exactly and export version + SHA from one shared module. **Resolved in Phase 9** — exact pin in `apps/api/package.json`, single source of truth in `packages/shared/src/duckdbPin.ts`.
- **`npmRebuild: false` means the native binary is never validated against the Electron ABI.** [apps/desktop/package.json:29](apps/desktop/package.json#L29), while CI builds duckdb against **Node 22** ([release-windows.yml:39-40](.github/workflows/release-windows.yml#L39)) and it is loaded inside **Electron 43** at [main.cjs:167](apps/desktop/main.cjs#L167). Add an explicit gate that `require`s the binding under Electron and runs one query.
- **NSIS `customInstall` shows a blocking MessageBox during auto-update.** [apps/desktop/build/installer.nsh:5-12](apps/desktop/build/installer.nsh#L5) — if `netsh` fails (VPN client, third-party firewall, Group Policy) the tester gets a modal from a process they didn't launch, *after* Electron has already exited, and `Abort` leaves the app uninstalled-in-place with nothing to relaunch. `nsis.perMachine: true` ([apps/desktop/package.json:104](apps/desktop/package.json#L104)) also forces a UAC elevation on every update. Make the firewall rule non-fatal on upgrade and evaluate `perMachine: false` for the beta channel. **The `MessageBox`/`Abort` half was already resolved in Phase 9 — this finding was written against pre-Phase-9 code.** `perMachine: true` remains, deliberately; see Tier 0 item 3 and [docs/WINDOWS_RELEASE.md](WINDOWS_RELEASE.md).
- **The desktop always binds `0.0.0.0` regardless of pairing state.** [main.cjs:153](apps/desktop/main.cjs#L153) is unconditional, with no branch on whether `paired-devices.json` has entries. Every tester's laptop listens on every interface from first launch. Default to `127.0.0.1` and rebind once a device is paired.
- **No app version is recorded alongside the data.** `createInitialManifest()` ([profileStoreManager.ts:427-434](apps/api/src/storage/profileStoreManager.ts#L427)) writes `{ version, backend, activatedAt, profiles }`. When a tester reports "it broke after the update" there is no way to determine which build last wrote their database. Add `lastWrittenByAppVersion` / `lastWrittenAt`, updated on every successful open. **Resolved in Phase 9.**
- **`apps/api/data/` has accumulated ~25 orphaned `.duckdb.tmp-*` files** from at least five distinct PIDs. The atomic-write helper does clean up after itself ([profileStoreManager.ts:486-495](apps/api/src/storage/profileStoreManager.ts#L486)) and `removeDatabaseArtifacts` sweeps `*.hydrating-*` ([restoreJournal.ts:161-172](apps/api/src/storage/restoreJournal.ts#L161)) — but **nothing sweeps `.tmp-*`**, and nothing reconciles the data directory at startup. On a tester's machine these accumulate in `%APPDATA%\Vitana Health` forever, each potentially a full database copy. The PID-liveness check needed for a safe sweep already exists at [secure-store-key.cjs:151-166](apps/desktop/secure-store-key.cjs#L151). **Resolved in Phase 9** — `sweepOrphanedTempFiles()` (`apps/api/src/storage/orphanedTempFiles.ts`) runs at startup and requires a dead PID plus a five-minute age.
- **All 15 Health Connect permissions are declared unconditionally** ([app.config.js:15-31](apps/android-companion/app.config.js#L15)) including `READ_HEALTH_DATA_HISTORY`, even though the user picks categories at runtime. Play reviews the manifest, not runtime usage; reducing the set after review means re-submitting the declaration, and a rejection blocks the beta track.
- **`.cjs` vs `.ts` split leaves the desktop layer outside typecheck.** There is no `tsconfig.json` in `apps/desktop`, and root `typecheck` ([package.json:38](package.json#L38)) covers shared, api-client, api, web and android — desktop is absent. So `main.cjs`'s use of the typed `startServer(options: StartServerOptions)` contract ([server.ts:38](apps/api/src/server.ts#L38)) is entirely unchecked, and a rename breaks the desktop silently. Add `checkJs` and wire it into the chain — cheap, and it catches exactly the drift that hurts during rapid beta iteration. **Resolved in Phase 9** — `apps/desktop/tsconfig.json` exists and root `typecheck` now ends with it.
- **`main.cjs` — 242 lines of process lifecycle — has zero behavioural tests.** The only file referencing it is [package-config.test.cjs:81-92](apps/desktop/package-config.test.cjs#L81), which does string `indexOf` on the source text to assert declaration ordering. It passes if the logic is wrong and breaks on any harmless rename. Everything in P1-17 lives in untested code. Extract the lifecycle into `createDesktopLifecycle({ app, startServer, diagnostics })` — the pattern already works for `background-service.cjs` and `desktop-updater.cjs`, both of which are properly tested with injected fakes. **Resolved in Phase 9** — `createDesktopLifecycle` extracted and covered by `desktop-lifecycle.test.cjs`.
- **`findPreparedExtension()` is copy-pasted six times with two different failure semantics** — five skip-on-absence copies and one that throws ([server.integration.test.ts:19-23](apps/api/src/__tests__/server.integration.test.ts#L19)). There is already a `__tests__/support/` directory. **Resolved** — consolidated into `apps/api/src/__tests__/support/duckdbExtension.ts`.
- **CodeQL is weekly-only, unpinned, and runs reduced queries.** [codeql.yml:15-17](.github/workflows/codeql.yml#L15) has no `pull_request` trigger; [L55](.github/workflows/codeql.yml#L55)/[L62](.github/workflows/codeql.yml#L62) use floating tags while every other workflow pins by SHA; `security-extended` is commented out at [L68](.github/workflows/codeql.yml#L68). This is a health app handling personal medical data.
- **TypeScript is split across two majors in one repo.** Root declares `^5.8.3` ([package.json:63](package.json#L63)) while [apps/android-companion/package.json:41](apps/android-companion/package.json#L41) and [website/package.json:19](website/package.json#L19) both pin `6.0.3`. Low risk today; it will bite when code is shared.

---

# P3 — Worth doing, not urgent

- **Dead code to delete now, while it's free.** The entire legacy-migration chain — `version4StoreSchema`, `version2StoreSchema`, `version5StoreSchema`, `retiredMetabolicStoreSchema` ([storeSchema.ts:165-177](packages/shared/src/storeSchema.ts#L165)), `legacyStoreSchema` with retired `labPanels`/`sleepSessions` ([L181-196](packages/shared/src/storeSchema.ts#L181)), `migrateV1ToV2` ([L197-228](packages/shared/src/storeSchema.ts#L197)), `stripRetiredCareFields` ([L315-341](packages/shared/src/storeSchema.ts#L315)) and the seven-branch parser — is reachable from exactly one caller: a test ([testProfileFixture.test.ts:16](apps/api/src/__tests__/testProfileFixture.test.ts#L16)). Roughly 150 lines maintaining seven historical on-disk formats *before your first user exists*. Either delete it and reset to a single `CURRENT_SCHEMA_VERSION`, or wire `parsePersistedHealthStore` into the real load and restore paths (which P1-12 argues for anyway). Doing neither is the worst option.
- Also dead: [scripts/seed-test-profile.mjs](scripts/seed-test-profile.mjs#L27) shells out to `npm run seed:test-profile -w apps/api`, which does not exist in [apps/api/package.json](apps/api/package.json#L10-L18), and nothing references the script. Root [app.json](app.json) is an empty `{ "expo": {} }` stub that only confuses Expo autodetection. [App.tsx:478-507](apps/web/src/App.tsx#L478) maintains `legacyImportPathAliases` for URLs nobody can have bookmarked. `migrateLegacyTlsFiles` in `security.ts:82-128` renames files from a prototype naming scheme.
- **Two competing "schema version" concepts.** `schemaVersion = 14` in [duckdbRuntime.ts:11](apps/api/src/storage/duckdbRuntime.ts#L11) (DB migration version — reset to `1` in Phase 2) versus `CURRENT_SCHEMA_VERSION` from `@vitana/shared` ([profileStoreManager.ts:15](apps/api/src/storage/profileStoreManager.ts#L15), document/export version). Nothing documents their relationship, and backup restore correctness depends on getting it right. Rename to `DB_SCHEMA_VERSION` and `EXPORT_FORMAT_VERSION`.
- **The SQL allowlist is a hand-maintained mirror of the schema.** `validateCompiledSql` ([queryCompiler.ts:570](apps/api/src/queryCompiler.ts#L570)) validates against `ALLOWED_TABLES | ALLOWED_COLUMNS` with no mechanical link to the DDL — a second place that must be updated on every schema change. Generate them from the schema definition, or add a test that diffs against `information_schema`.
- **Capability routing is a string `switch` detached from the routers it describes.** [createApp.ts:66](apps/api/src/createApp.ts#L66) switches on `` `${request.method} ${request.path}` `` with a nested ternary chain at [L104-116](apps/api/src/createApp.ts#L104), entirely decoupled from the routers mounted at [L352-368](apps/api/src/createApp.ts#L352). Add a route in `dataRoutes.ts` and forget this table, and the companion capability check silently doesn't apply — with no compile-time link.
- **Profile photos: schema hard-codes exactly one JPEG per profile.** The v9 DDL's two `CHECK` constraints (`media_kind='profile-photo'`, `content_type='image/jpeg'`) mean a pet photo gallery or PNG support needs a migration. Relaxing them costs nothing today. The write path also base64-round-trips through `from_base64(?)` ([duckdbCommands.ts:125](apps/api/src/storage/duckdbCommands.ts#L125)) because the driver can't bind BLOBs — ~33% inflation per write, and DuckDB-specific.
- **Test hooks are baked into the production options type.** `DuckDbOptions.testHooks` ([duckdbRuntime.ts:14-23](apps/api/src/storage/duckdbRuntime.ts#L14)) is invoked in the hot transaction path. Keep them — they enable the durability tests — but move to a separate type intersected only in test builds.
- **`engine: "duckdb"` is returned to clients** ([analyticsBackend.ts:15-35](apps/api/src/storage/analyticsBackend.ts#L15)), alongside a fake `databasePath: "encrypted-profile:${profileId}"`. The engine name is now part of your API contract. Drop it before the mobile app depends on it.
- **Hand-rolled rate limiter sweeps only when `rateBuckets.size > 5_000`** ([createApp.ts:175-198](apps/api/src/createApp.ts#L175)) — a latent memory hold on a long-running desktop process. Sweep on a timer instead. State is also process-local and resets on restart; document that.
- **`any` in the replica collection mapping table** ([duckdbReplicaSync.ts:26-42](apps/api/src/storage/duckdbReplicaSync.ts#L26)) — `id: (value: any) => string` means a schema/type change surfaces as a runtime `undefined` id rather than a compile error. Same class of issue: `getAllAsync<any>` in the mobile migration-export queries ([sqliteLocalStore.ts:416](apps/android-companion/src/standalone/sqliteLocalStore.ts#L416)), which feed the standalone→connected migration, where a shape mismatch is silent data loss.
- **`packages/shared/src/index.ts` omits the parser modules**, so consumers use deep subpath imports that will break if `exports` restrictions are ever added. **Resolved** — `index.ts` now re-exports `storeSchema.js` and `parsers.js`.
- **Owner-token fallback uses a blocking `window.prompt()`** ([api.ts:113-122](apps/web/src/api.ts#L113)) — unstyleable, inaccessible, unavailable in some webviews, untestable without stubbing a global. The `ConfirmDialog` service already exists.
- **`importHealthConnect(payload: Record<string, unknown>)`** ([packages/api-client/src/index.ts:196-197](packages/api-client/src/index.ts#L196)) — the primary mobile→desktop sync entry point has no schema at the client boundary.
- **Dead purchase gating ships in the bundle.** `PURCHASE_GATING_ENABLED = false` ([entitlementService.ts:4](apps/android-companion/src/entitlementService.ts#L4)) makes ~130 lines of `StoreEntitlementService` plus `storeBillingClient.ts` unreachable, while `react-native-iap` is still linked as a native plugin ([app.config.js:46](apps/android-companion/app.config.js#L46)). Either exercise the store path in a `preview` build against a test product, or drop the plugin so the binary matches the behaviour.
- **`preview` builds have no version-code auto-increment.** [eas.json:25-27](apps/android-companion/eas.json#L25) sets `autoIncrement: true` only on `production`. Testers install successive `preview` APKs with the same version code; Android may refuse the upgrade, and you cannot tell which build a bug report came from. Surface the build number in-app — [appBuildInfo.ts](apps/android-companion/src/appBuildInfo.ts) already has the plumbing.
- **Three independent dev-mode switches must all be correct.** `VITANA_ALLOW_CLEARTEXT` in [eas.json:11-13](apps/android-companion/eas.json#L11) → `usesCleartextTraffic`; `__DEV__` skipping the HTTPS requirement at [syncHealthConnect.ts:232](apps/android-companion/src/syncHealthConnect.ts#L232); `parsePairingPayload(data, !__DEV__)` skipping QR verification at [PairScreen.tsx:69](apps/android-companion/src/PairScreen.tsx#L69). Build a "quick debug APK" for a tester and you ship an app that accepts unverified pairing QR codes over plaintext HTTP. Assert at startup that `__DEV__ === false` implies `allowCleartext === false`, and fail the *build* for a distributable profile with cleartext enabled.
- **Web-only packages in production `dependencies`** — `@expo/metro-runtime`, `react-dom`, `react-native-web` exist for `preview:web`; `react-native-nitro-modules` is never imported anywhere in `src`.
- **The `data/` gitignore rule is unanchored.** [.gitignore:5](.gitignore#L5) is `data/` with no leading slash, matching any directory named `data` at any depth. **Nothing sensitive is currently committed** — `apps/api/data/` and the root `data/` are correctly excluded, as is `desktop-store-evidence/` ([.gitignore:12](.gitignore#L12)). The forward-looking risk is that a future `packages/shared/src/data/` of legitimate source files becomes invisibly excluded. Anchor as `/data/` and `/apps/api/data/`.
- **`secure-store-key.cjs` gives up after 5 seconds** waiting for Chromium to persist `Local State` ([secure-store-key.cjs:171-181](apps/desktop/secure-store-key.cjs#L171)), with the message *"The OS secure store did not persist its encryption state during startup"* — unactionable for a non-technical tester on a slow machine under AV scanning. Raise to ~15s and rewrite the message to "please relaunch".
- **`windows-desktop-smoke.ps1` uses fixed `Start-Sleep` waits** ([L213](scripts/windows-desktop-smoke.ps1#L213), plus fixed loops at [L55-64](scripts/windows-desktop-smoke.ps1#L55) and [L99-106](scripts/windows-desktop-smoke.ps1#L99)) — the classic source of intermittent CI red. A correct `Wait-ForHealth` helper already exists at [L115](scripts/windows-desktop-smoke.ps1#L115).
- **`packages/shared` and `apps/android-companion` vitest configs set no `testTimeout`**, while api and web both set `5_000`. The Android suite uses fake timers ([syncHealthConnect.test.ts:37](apps/android-companion/src/syncHealthConnect.test.ts#L37)), where a missed `advanceTimersByTimeAsync` hangs to the default rather than failing fast.
- **The audit allowlist has no expiry.** [.audit-allowlist.json:10](.audit-allowlist.json#L10) exempts six packages with the note *"must be removed once it publishes"*, but [scripts/audit-ci.mjs:5-15](scripts/audit-ci.mjs#L5) has no date check. Add `expiresAt` per entry.
- **Ad-hoc `Platform.OS === "ios"` branches already exist in an Android-only app** ([ImportScreen.tsx:116](apps/android-companion/src/screens/ImportScreen.tsx#L116), `CareScreen`, `TrackDetailScreen`) — unreachable, untested, and guaranteed to drift.

---

# Structural maintainability

Nine files carry disproportionate change pressure. These are the files that must change for most of the P1 findings above, which is exactly why splitting them now is a pure refactor and splitting them later means doing it while also carrying migration and protocol compatibility.

| Lines | File | Concerns mixed |
|---:|---|---|
| ~1,273 | [packages/shared/src/registry.ts](packages/shared/src/registry.ts) | 60+ measurement definitions, unit aliasing, imperial mapping, module-load mutation |
| ~1,226 | [apps/api/src/storage/duckdbProjections.ts](apps/api/src/storage/duckdbProjections.ts) | 18 exported query functions; the observations∪samples∪activities UNION is hand-written **four times** (L215-223, L284-288, L539-552, L641-647) |
| ~946 | [apps/android-companion/src/standalone/sqliteLocalStore.ts](apps/android-companion/src/standalone/sqliteLocalStore.ts) | standalone store + replica cache + migration export + lease management |
| ~870 | [apps/android-companion/src/screens/TrackDetailScreen.tsx](apps/android-companion/src/screens/TrackDetailScreen.tsx) | list, chart, add/edit forms, staged deletion timer |
| ~851 | [packages/shared/src/types.ts](packages/shared/src/types.ts) | hand-written types duplicating the zod schemas |
| ~833 | [apps/android-companion/src/screens/ImportScreen.tsx](apps/android-companion/src/screens/ImportScreen.tsx) | four unrelated features: manual, scan (acquisition/resize/base64/OCR review), Health Connect (permissions + settings + sync orchestration), entitlement gating |
| ~801 | [apps/api/src/storage/duckdbCommands.ts](apps/api/src/storage/duckdbCommands.ts) | all mutations across every domain |
| ~722 | [apps/web/src/pages/SummaryPage.tsx](apps/web/src/pages/SummaryPage.tsx) | summary table + sort + entry formatting + a ~460-line `ObservationTypeDetailPage` with eight `useState` |
| ~630 | [apps/android-companion/src/MobileApiProvider.tsx](apps/android-companion/src/MobileApiProvider.tsx) | a ~45-member context with a ~45-entry dependency array at [L551](apps/android-companion/src/MobileApiProvider.tsx#L551)-[L601](apps/android-companion/src/MobileApiProvider.tsx#L596) — every consumer re-renders when any of 45 values changes |

Suggested splits: `duckdbProjections.ts` → `projections/{measurements,care,analytics,counts}.ts` with one shared UNION fragment; `ImportScreen.tsx` → one file per import mode under `screens/import/` with permission/settings/sync logic lifted into testable hooks; `MobileApiProvider` → separate stable-actions and volatile-data contexts so actions get an empty dependency array; `SummaryPage.tsx` → extract `ObservationTypeDetailPage`.

Duplicated logic that should live in `packages/shared`: the retry-classification regex (two copies — **resolved in Phase 8**, both now use `packages/shared/src/networkRetry.ts`), the Health Connect category/descriptor list (two copies — and the source of the P1-7 backfill bug), and **three** different downsampling implementations ([connectedRepository.ts:307-318](apps/android-companion/src/connected/connectedRepository.ts#L307), [chartSeries.ts:71-103](apps/android-companion/src/chartSeries.ts#L71), and SQL bucketing in `sqliteLocalStore.ts`).

---

# Test suite

**101 test files, 582 test cases.** That is a substantial suite, and the fast/integration/durability split is the right shape.

*(Post-remediation, at the end of Phase 10: 94 core files / 592 cases, 7 integration files / 99 cases, 1 durability file / 2 cases, plus the desktop `node --test` suite — all of them now run in `npm run validate:all`.)*

The problem is what the default run actually covers. `npm test` → `test:core` ([package.json:36](package.json#L36)) → [vitest.config.ts](vitest.config.ts#L5-L11) (5 projects) plus one Node test file. **Excluded from the default run:** 5 API integration files, 1 durability file ([apps/api/vitest.config.ts:7](apps/api/vitest.config.ts#L7)), `App.integration.test.tsx` ([apps/web/vitest.config.ts:15](apps/web/vitest.config.ts#L15)), **all 8 desktop test files**, and `windows-desktop-smoke.test.mjs`.

Combined with P1-16, the coverage picture on the riskiest paths is:

| Risk area | Automated coverage today |
|---|---|
| Encrypted DuckDB storage | Integration tests exist and are good — but disabled in CI and skipped on Linux |
| Backup / restore | Integration fixture is thorough; not in the default run |
| Desktop schema migration under an existing DB | **None** — no job exercises upgrade-over-data |
| Desktop process lifecycle (`main.cjs`) | **None** — only source-text `indexOf` assertions |
| Android schema migration | Per-version tests exist for `migrations.ts`; no backup/integrity/downgrade coverage |
| Android UI, provider lifecycle, lease accounting | **None** — the runner's glob cannot match `.test.tsx` |
| Health Connect sync at volume | Unit-level only; no large-payload or partial-failure test |

The suite is fast and not obviously flaky — the main flakiness risk is the fixed `Start-Sleep` waits in the PowerShell smoke script and the fake-timer usage in the Android suite with no `testTimeout`.

---

# Strengths worth protecting

These are all verified in current code and should survive any refactor:

- Storage sits behind `ProfileRepository`, keeping a genuine SQLite path open — the leaks noted above are four specific, fixable places, not a structural failure.
- A **real versioned migration runner** exists with contiguity validation and transactional application. The gaps are backup, resumability, and downgrade handling — not absence.
- Backup cryptography: authenticated AES-256-GCM, versioned format, scrypt, bounded decompression, per-profile digests.
- Restore has a genuine journal with compensation and startup recovery; the remaining exposure is one specific crash window.
- Companion routes use explicit capabilities and profile-bound repositories rather than a denylist.
- Production mobile traffic uses QR-established SPKI pinning and disallows cleartext.
- AI endpoints require explicit cloud consent and apply host allowlisting, public-address checks, manual redirects, and SELECT-only query compilation.
- Electron enables sandboxing, context isolation, and disabled Node integration; the DuckDB extension is SHA-pinned.
- `background-service.cjs` and `desktop-updater.cjs` use dependency injection and are properly tested with fakes — the model to copy for `main.cjs`.
- Query-result limits are clamped consistently in most projections (`maxAnalyticalRows`, `maxDailyChartBuckets`, list limits capped at 100).
- Zero `TODO`/`FIXME`/`HACK` comments in `apps/api/src`. Very little parked work.

---

# Suggested sequencing

## Original P1 sequence — complete

All 19 P1 findings were remediated across Phases 0–9 (see the roll-up table above). The original 15-step P1 ordering is retained in git history; it is no longer a plan.

## Updated backlog (P2/P3, re-audited 2026-07-29 after Phase 9)

Every P2/P3 finding was re-checked against current code before this ordering was written. Findings the phases resolved are annotated inline above and are excluded here. Two things changed for the worse and are called out: `SELECT * EXCLUDE` grew from ~16 to ~26 occurrences, and `storageCounts` is now six subqueries rather than seven only because a table moved.

### Tier 0 — Before the first build reaches a tester

These gate the *distribution*, not the code, and each one is cheap now and awkward once a build is out.

1. **Trim the Health Connect permission set** to the categories actually offered. Play reviews the manifest; narrowing it after review means re-submitting the declaration and can block the beta track.
2. ~~**Add an Electron-ABI gate for the DuckDB native binding.**~~ *Resolved 2026-07-30.* `apps/desktop/verify-native-abi.cjs` loads the binding and runs a query under Electron, and both `package` and `package:store` run it before `electron-builder`. The Windows smoke script now asserts a `.duckdb` file was created in the `Fast` scope as well as `Full`, so the end-to-end path proves the same property.
3. ~~**Make the NSIS `customInstall` firewall rule non-fatal on upgrade**~~ — *this half was already fixed in Phase 9* (`nsExec::Exec` + `Pop $0` + `DetailPrint`, no `Abort`); the finding above was written against pre-Phase-9 code and is stale. A regression test now locks it in. **`perMachine: false` was evaluated and deliberately not taken yet:** it would remove UAC from install and auto-update, but it also forfeits the elevated `netsh` call, and the API still binds `0.0.0.0`, so companion pairing would silently depend on a Windows consent dialog that policy can suppress. The rationale is recorded in [docs/WINDOWS_RELEASE.md](WINDOWS_RELEASE.md); flip it once item 4 lands.
4. **Bind `127.0.0.1` by default and rebind to `0.0.0.0` only once a device is paired.** *(Deliberately deferred during Phase 9; it is the last remaining item from the P1 set's neighbourhood and should not ship as-is. It also blocks the `perMachine: false` switch in item 3.)*
5. ~~**Assert at startup that `__DEV__ === false` implies `allowCleartext === false`**~~ *Resolved 2026-07-30.* `app.config.js` throws when `VITANA_ALLOW_CLEARTEXT=1` is set on any EAS profile other than `development`, and `assertTransportSecurity` repeats the check at startup inside the app error boundary for builds produced outside EAS.
6. ~~**Turn on `autoIncrement` for `preview` EAS builds**~~ *Resolved 2026-07-30.* The `preview` profile auto-increments, and `formatAppBuildLabel` renders the version code beside the marketing version, for example `Version 1.2.0 (57)`.

### Tier 1 — Before testers accumulate data (data-trust and crash class)

*Resolved 2026-07-31, except where noted.*

7. ~~**Staged deletion on mobile is cancelled by unmount after telling the user it succeeded**~~ *Resolved.* `TrackDetailScreen` keeps the staged entry in a ref and the unmount cleanup commits it instead of dropping the timer, so navigating away within the six-second window completes the delete rather than resurrecting the reading. Not covered by a test: the companion app has no React component test harness.
8. ~~**`SqliteLocalStore.reset()` bypasses lease accounting**~~ — **stale finding.** `reset()` already calls `this.close()` before `resetSqliteLocalStorage()`, so the lease is released through the accounting. Fixed in an earlier phase; the backlog entry was written against older code.
9. ~~**Stateful data sources holding DB handles are built inside `useMemo`**~~ *Resolved.* The standalone and connected sources are now created inside effects whose cleanup is guaranteed to run for every instance created, so a StrictMode double-invocation can no longer orphan a lease. The separate dispose-on-`source`-change effect — which also wrongly disposed the demo source — was removed.
10. ~~**Rewind detection deletes the whole replica.**~~ *Resolved.* A rewind now rebuilds under a staging pairing id (`<pairingId>#staging`) and calls the new `LocalStore.promoteReplica()` only once the rebuild completes, so the existing copy keeps serving reads throughout and a failed rebuild costs nothing. No schema migration was needed — the staging replica is just another row.
11. ~~**Replica page loops are unbounded and ignore the disposal flag**~~ *Resolved.* Both legs check the disposal flag and a page budget (default 10,000, injectable for tests) on every iteration.
12. ~~**Live mutations have no rollback, idempotency key, or outbox.**~~ *Partially resolved.* A failed post-write refresh now raises `ReplicaRefreshFailedError` — explicitly "saved on your PC, not yet visible here" — instead of reading as a failed write, and sets a pending flag so the next read forces a catch-up sync. That closes the duplicate-on-re-submit path. True idempotency keys still need server-side dedupe and are not done.
13. ~~**The connection record is read-modify-written without a lock and fails open**~~ *Resolved.* All mutations chain through a non-reentrant mutex, and an unparseable record now preserves the original bytes under `vitana.connection.corrupt` and raises `ConnectionRecordUnreadableError` rather than reading as "not paired". Re-pairing over a corrupt record still works.
14. ~~**The restore crash window between the two `renameSync` calls**~~ — **already handled.** All four paths are journalled before hydration begins, so `RestoreJournal.recover()` already compensates a kill landing between the renames with no live database on disk. A regression test now locks that in; no code change was required.
15. ~~**`closeAll()` uses `Promise.all`**~~ *Resolved.* Now `allSettled`, with each rejection logged.
16. ~~**`defaultMeasurementTypes` is mutated in place at module load**~~ *Resolved.* The export is built with `.map()` and deep-frozen. The exported TypeScript type stays mutable deliberately — making it `readonly` rippled through 127 usages in 32 files for no runtime benefit.
17. ~~**Care lists are hard-capped at 30 with no `hasMore`**~~ *Resolved.* `CareScreen` tracks `hasMore` per view and offers a "Load more" button. The API already returned `hasMore`; only the screen discarded it. Not covered by a test, for the same reason as item 7.
18. ~~**Chart series is derived from pre-downsampled points**~~ *Resolved.* `ConnectedReplicaRepository.healthDataChartSeries()` applies the range cutoff before downsampling, so a short range over a long history stays dense.
19. ~~**Store-manager errors surface as opaque 500s.**~~ *Resolved.* `ProfileNotFoundError` (404) and `ProfileConflictError` (409) carry `status` and `code`, which the centralized error handler already maps.

### Tier 2 — Portability debt (gets more expensive with every change)

The project explicitly wants the SQLite swap and iOS both to stay open. These are the things that quietly close them.

20. ~~**Replace `SELECT * EXCLUDE (...)` with explicit column lists**~~ *Resolved.* All 23 code occurrences now build their column lists from the existing `storage/duckdbColumns.ts` registry, which gained `qualifiedColumns()` for the aliased joins. The three window-function queries were rewritten by hand. The `raw_content` footgun was already contained in `duckdbExport.ts` and was left alone.
21. ~~**Change `runCompiledQuery(sql: string)` to accept the compiled plan object**~~ *Resolved.* `queryCompiler.ts` now exports a `CompiledQuery` carrying an `AnalyticsSqlDialect`, and the plan is threaded through `profileStoreManager` → `profileRepository` → `duckdbRepository`, which rejects a plan compiled for another dialect. `analyticsQueryCompilerFor()` dispatches through a `Record<StorageBackend, AnalyticsQueryCompiler>` and throws for an unregistered backend instead of silently returning DuckDB.
22. ~~**Move the shared DTOs to a neutral `storage/types.ts`**~~ *Resolved.* `StorageBackend`, `StoreSecurityMode`, `StoreSecurityConfig`, `StoredReplicaPage`, and `HealthConnectSyncSessionStart` now live in `storage/types.ts`; the DuckDB modules re-export them so no call site changed. This also broke a genuine `profileRepository` ↔ `duckdbHealthConnectSync` import cycle.
23. ~~**Define the `HealthSourceProvider` interface**~~ *Resolved.* `packages/shared/src/healthSource.ts` owns the category vocabulary and the sync contract; `healthSourceProvider.ts` exposes Health Connect through it and returns nothing on a platform with no source, so `ImportScreen` renders an empty picker rather than offering categories nothing can read.
24. ~~**Define the pinned-HTTP TypeScript contract**~~ *Resolved.* `packages/shared/src/pinnedHttp.ts` declares the error codes with their retryability, the timeout bounds, and the `PinnedHttpClient` interface the native and web modules now implement; `networkRetry.ts` derives its retryable set from it. Doing this surfaced a real bug: the Android module reported a failed certificate pin as `network-interrupted`, which is **retryable** — a pinning failure was being retried instead of stopping the sync.
25. ~~**Add the `ios` block to `app.config.js` and iOS profiles to `eas.json`**~~ *Resolved.* Bundle identifier, ATS exceptions for local networking, and the three usage descriptions are declared; `eas.json` gained simulator builds for `development`/`preview` and an `m-medium` resource class for `production`.
26. ~~**Replace the scalar Windows-x64 platform gate**~~ *Resolved.* `SUPPORTED_HOST_PLATFORMS` in `duckdbPin.ts` maps `platform-arch` to the DuckDB platform string, and both gates read through it, so adding macOS or Linux is a table entry rather than a new branch.
27. ~~**Split `LocalStore` into a durable `standalone.db` and a disposable `replica.db`**~~ *Resolved.* The replica cache now lives in its own encrypted file with its own `user_version`, and a version mismatch **rebuilds** it — `prepareReplicaCache()` drops and recreates rather than migrating, in either direction, since every row is a copy the PC still holds. Durable migration 5 evicts the two cache tables from `standalone-health.db`; migrations 3 and 4 stay as history so databases already at version 4 have a path forward. Those two migrations are exactly the cost this removes: both were cache-shape changes forced through file backups and row-count assertions. Key rotation and reset now discard the cache rather than carrying it.

### Tier 3 — Performance and responsiveness

28. ~~**Open profile databases lazily and evict idle ones**, and stop configuring every one at 256 MB.~~ *Resolved.* A new `storage/lazyProfileStore.ts` wraps each profile in a `Proxy` facade that opens the database on first call, stamps last use, and closes after an idle timeout (default 5 minutes, injectable). Only the active profile is configured at 256 MB; the rest get 64 MB, and an unopened profile costs nothing at startup.
29. ~~**Replace the synchronous `fs` calls in the store manager**~~ *Resolved.* `profileStoreManager` is on `node:fs/promises` throughout; the constructor performs no filesystem work at all and `ProfileStoreManager.open()` does the one `mkdir`. The remaining sync calls are the three that must be sync: data-dir resolution, the activation-manifest probe, and local key creation.
30. ~~**Cache `storageCounts` and invalidate on write**~~ *Resolved.* `DuckDbRepository` holds the counts as a shared promise so concurrent readers do not race six `COUNT(*)` scans, and clears it inside `transaction()` — the one place every write passes through. `appBootstrap()` now takes the already-known counts instead of re-scanning.
31. ~~**Rewrite `listCareItems`' three correlated subqueries as a `LEFT JOIN`**~~ *Resolved.* One `careItemSelectSql(where, tail)` helper builds both the paged read and the `includeId` top-up, so the two bodies cannot drift, and the completed-event columns come from a single join.
32. ~~**Stop writing an audit row inside `exportData()`**~~ *Resolved.* `recordExportAudit()` is now its own method on `ProfileRepository`. `DuckDbHealthStore.exportData()` enqueues only the short audit write; the multi-second read runs outside the mutation queue, so taking a backup no longer blocks writes.
33. ~~**Clamp the remaining unbounded `measurementDetails` path.**~~ *Resolved.* Always limited, at `maxMeasurementDetailRows = 5000`.
34. ~~**Introduce virtualization on mobile**~~ *Resolved.* `TrackDetailScreen` and `CareScreen` are `FlatList`s with `ListHeaderComponent`/`ListFooterComponent`; `CareScreen` keeps its `RefreshControl` through the list's own prop.
35. ~~**Memoize `TrendChart`**~~ *Resolved.* Wrapped in `memo`, the fixed chart geometry constants are hoisted to module scope, and the point/domain/tick/path derivation collapsed into one `useMemo`. The parent already passed stable `setState` setters, so the memo actually holds.
36. ~~**Stop re-materializing the entire replica on every range change**~~ *Resolved.* `LocalStore.replicaEntities()` takes a `ReplicaEntityFilter`; the SQLite implementation filters entity type and `measurementCode` in SQL via `json_extract`, so rows for other measurements are never parsed into JS. `ConnectedReplicaRepository` caches the per-measurement projection by replica revision, making a range change a cache hit.
37. ~~**Stream images instead of base64-ing them into JS, and keep the profile photo as a `file://` URI**~~ *Partially resolved.* The profile photo half is done: a new `src/profilePhotoCache.ts` writes the bytes to the cache directory and hands context state a `file://` URI, evicting the previous revision. `ImportScreen` now reads the base64 off the resized file at request time rather than having the manipulator pin a second copy for the whole handler. A genuinely streamed upload still needs the JSON `contentBase64` contract replaced with multipart on both the API and the pinned-HTTP native module, and was not attempted here.
38. ~~**Batch the migration export instead of loading all four tables into memory**~~ *Resolved.* `streamMigrationBatches()` is an async generator paging each table with `LIMIT`/`OFFSET`, so `batchSize` now bounds memory as well as upload size. Progress totals are derived from the manifest counts rather than a materialised batch list.
39. ~~**Collapse the Track mutation fan-out and fix the `ImportPage` double-rate poll.**~~ *Resolved.* `useProfileLifecycle.refresh()` takes `{ profiles }`; recording an observation cannot change the profile roster, so the four data routes skip that request. `ImportPage` only replaces the pending-pairing array when its contents actually changed — the unconditional `setState` was re-triggering the paired-devices effect on every tick, making a five-second poll issue two requests.
40. ~~**Web tables: memoize the sorts, hoist the per-row `RegExp`, and virtualize the long ones. Then fix `analytics.ts`'s sort-to-find-max and the `find()` inside a per-code loop.**~~ *Resolved.* The summary sort is memoized and the transfer-window pattern is compiled at module load. The entries table uses `content-visibility: auto` with an intrinsic size hint rather than a JS windowing library — the rows are user-paged, so a dependency was not warranted. In `analytics.ts`, personal reference ranges are indexed into a `Map` once instead of being scanned per code, and the two "sort the whole series to read element zero" sites became a single linear `latestObservation()` scan.
41. ~~**Narrow `computeAnalytics(store: HealthStoreData)`**~~ *Resolved.* It now takes an `AnalyticsStoreProjection` — profile units/subject kind, measurement types, observations, optional ranges and pins, and counts. `analyticsCountsFromStore()` remains for the callers that genuinely hold a whole store.

### Tier 4 — Hygiene (free now, annoying later)

42. ~~**Delete the dead legacy-migration chain** in `storeSchema.ts` (reachable only from one test), plus the empty root `app.json`, `legacyImportPathAliases`, and `migrateLegacyTlsFiles`.~~ *Resolved, with a caveat.* The premise was stale — `parsePersistedHealthStore` is live on the restore path in `backupCrypto.ts`, not test-only. The chain went anyway under the unreleased-app rule: `storeSchema.ts` drops from 369 to ~216 lines and the parser now accepts `EXPORT_FORMAT_VERSION` alone, throwing on anything else. **A backup file written by an earlier build will no longer restore.** `app.json`, `legacyImportPathAliases` and `migrateLegacyTlsFiles` are gone; the TLS test now asserts the far more useful property that a restart reuses the existing certificate rather than reminting the pinned key.
43. ~~**Rename to `DB_SCHEMA_VERSION` and `EXPORT_FORMAT_VERSION`** and document their relationship. Backup-restore correctness depends on not confusing them.~~ *Resolved.* `CURRENT_SCHEMA_VERSION` became `EXPORT_FORMAT_VERSION` (document shape, in `@vitana/shared`); the local `schemaVersion` constant in `duckdbRuntime.ts` became `DB_SCHEMA_VERSION` (physical DuckDB layout). Both carry a doc comment naming the other and spelling out which kind of change bumps which.
45. ~~**Link capability routing to the routers it describes** instead of a detached string `switch`.~~ *Resolved.* The ~50-line `switch` in `createApp.ts` is now a lookup against a declarative table in `companionRouteCapabilities.ts`, grouped by owning router. A new test walks the real Express router stack and snapshots every `/api` route against its resolved capability, so an added route shows up as a snapshot diff. Building it surfaced four dead cases (`PATCH`/`DELETE` on `/care/health-events` and `/care/items` without an `:id`) and one real gap: `POST /pair/revoke-self` was unreachable to companions because only the `/pairing/` alias was listed.
46. ~~**Move `testHooks` out of the production `DuckDbOptions` type** (intersect it in test builds only).~~ *Resolved.* `DuckDbTestHooks` is its own interface and `DuckDbOptions` no longer mentions it. Only the `DuckDbRepository.hydrate`/`open` factories widen their parameter to `DuckDbOptionsWithTestHooks`.
47. ~~**Drop `engine: "duckdb"` and the fake `databasePath` from the API response** before the mobile app depends on them.~~ *Resolved.* `AnalyticsStorageDescription` is now `{ counts }`. Nothing in web, shared or the companion read either field, and the shared schema already typed the block as `z.unknown().optional()`, so no contract change was needed.
49. ~~**Remove the `any` from the replica collection mapping and the `getAllAsync<any>` migration-export queries** — a shape mismatch there is silent data loss.~~ *Resolved.* The replica collection table is built through a generic `collection<K>()` helper that binds each id accessor to the element type of the `HealthStoreData` field it reads, so `value.code` versus `value.measurementCode` versus `value.id` is checked rather than assumed. The four `pages<any>` queries in `sqliteLocalStore.ts` now have explicit row types mirroring their `AS` aliases, and `withUndefinedNulls` is typed by a `NullsToUndefined<T>` mapped type instead of erasing to `any`.
50. ~~**Replace the blocking `window.prompt()` owner-token fallback** with the `ConfirmDialog` service that already exists, and **schema-validate `importHealthConnect(payload)`** at the client boundary.~~ *Resolved.* `ConfirmDialog` gained an optional `promptLabel`/`promptType` text field with focus management and Enter-to-confirm; `api.ts` exposes `setOwnerTokenPrompt()` and the app shell registers a handler that raises the dialog, masking the token as a password field. With no handler registered the request surfaces its 401 instead of blocking the renderer. `importHealthConnect` now runs `healthConnectImportRequestSchema.parse(payload)` before upload, matching the existing `mobileMigration.start` pattern.
51. ~~**CodeQL: add a `pull_request` and workflow_dispatch trigger, pin the actions by SHA, and enable `security-extended`.** This is a health app.~~ *Resolved.*
53. ~~**Relax the profile-photo `CHECK` constraints** (one JPEG per profile blocks pet galleries and PNG) while it is still free.~~ *Resolved in the baseline schema.* `CHECK (media_kind = 'profile-photo')` is gone — `media_kind` is the primary key, so distinct kinds already give multiple images per profile — and the content type accepts `image/jpeg`, `image/png` and `image/webp`. Delivered as a baseline change rather than a `DB_SCHEMA_VERSION` 2 migration: attempting the migration exposed a latent Windows bug where `backupDatabaseFile()` fails `EBUSY` copying a still-attached DuckDB file, which would break *every* future migration and deserves its own fix. Developer databases created before this keep the stricter CHECKs until recreated, which is harmless while the write path is still JPEG-only.
55. ~~**Raise the `secure-store-key.cjs` wait from 5 s to ~15 s** and rewrite the message to "please relaunch".~~ *Resolved.*
56. ~~**Replace the fixed `Start-Sleep` waits in `windows-desktop-smoke.ps1`** with the `Wait-ForHealth` helper that already exists.~~ *Resolved.*
57. ~~**Set `testTimeout` in the `packages/shared` and `apps/android-companion` vitest configs** (api and web are both at 20 s) — the Android fake-timer tests currently hang rather than fail fast.~~ *Resolved.*
59. ~~**Anchor the `.gitignore` rules** as `/data/` and `/apps/api/data/`.~~ *Resolved.*

### Tier 5 — Hygiene (Deferred Items)

44. **Generate the SQL allowlist from the schema**, or add a test that diffs it against `information_schema`.
48. **Sweep the rate-limiter buckets on a timer** rather than only above 5,000, and document that the state is process-local.
52. **Converge the TypeScript major version** across the workspaces (root/api/web on 5.x, android-companion/website on 6.x).
54. **Add `expiresAt` to `.audit-allowlist.json` entries and enforce it in `audit-ci.mjs`.**
58. **Drop the dead purchase gating and unlink `react-native-iap`**, move the web-only packages out of production `dependencies`, and remove the unused `react-native-nitro-modules`.
60. **Delete the unreachable `Platform.OS === "ios"` branches** — or keep them only once #25 makes iOS a real target.
61. **Split the god files** (`registry.ts`, `duckdbProjections.ts`, `sqliteLocalStore.ts`, `TrackDetailScreen.tsx`, `ImportScreen.tsx`, `MobileApiProvider.tsx`, `SummaryPage.tsx`) as described under *Structural maintainability*, and de-duplicate the three downsampling implementations and the two Health Connect descriptor lists. Best done opportunistically, as each file is opened for one of the items above.
18. Split the nine oversized files; move duplicated logic into `packages/shared` (Structural maintainability).