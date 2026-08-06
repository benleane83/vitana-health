# Android Companion — Sync & Caching Review (2026-07-27)

Review of the Connected replica (read-only SQLite cache) and Standalone paths, plus the
PC-side change-capture that feeds them. Focus: refresh latency, correctness, tech debt.

Status legend: `DONE` · `PARTIAL` · `DEFERRED` · `PENDING`

---

## Performance

| ID | Finding | Status |
|----|---------|--------|
| P1 | Every Connected read re-materialises the whole store | `DONE` |
| P2 | `summarize()` is O(codes x observations) | `DONE` |
| P3 | PC-side: two full DuckDB exports + JSON diff per mutation | `DEFERRED` |
| P4 | `applyReplicaPage` runs a redundant SELECT per change | `DONE` |
| P5 | `healthDataDetail` returns unbounded `chartPoints` | `DONE` |
| P6 | `recordReplicaChanges` inserts one row at a time | `DONE` |

## Correctness

| ID | Finding | Status |
|----|---------|--------|
| B1 | Rolled-back PC store silently freezes the phone on stale data | `DONE` |
| B2 | Interrupted first snapshot restarts from zero | `DONE` |
| B3 | Snapshot / change-log tables are never pruned | `DONE` |
| B4 | Pull-to-refresh can silently no-op | `DONE` |
| B5 | Staleness window compares device clock to PC clock | `DONE` |
| B6 | Coordinator is dead after `deleteConnectedReplica()` | `DONE` |
| B7 | Mode switch closes and re-derives the SQLCipher key | `DONE` |
| B8 | Replica deletion trusts an FK cascade | `DONE` |

## Tech debt

| ID | Finding | Status |
|----|---------|--------|
| T1 | Three implementations of the same query semantics | `DEFERRED` |
| T2 | Wire payloads blind-cast, never validated | `DEFERRED` |
| T3 | Read-only replica advertises delete affordances | `DONE` |
| T4 | Redundant index on `connected_replica_entities` | `DONE` |
| T5 | `synchronous = FULL` for a re-derivable cache | `DEFERRED` |
| T6 | Test coverage gap for sync edge cases | `PARTIAL` |

---

## Performance detail

### P1 — Every Connected read re-materialised the whole store `DONE`

`ConnectedReplicaRepository` read every replica row out of SQLite and rebuilt the full
`HealthStoreData` object on each call. A cold Dashboard render did that six times
(bootstrap, analytics, summary, detail, events, care) — exactly the "full profile read"
pattern the project guidance warns against.

Added a `ReplicaProjection` cached on the repository and keyed on
`` `${revision}:${cursorSequence}:${appliedAt}` `` from the replica metadata, so the
projection is rebuilt only when a sync actually applied something. Row bucketing is now a
single pass into a `Map<string, unknown[]>` instead of 13 `Array.filter` passes.

`apps/mobile-companion/src/connected/connectedRepository.ts`

### P2 — `summarize()` was O(codes × observations) `DONE`

Every summary row re-scanned the whole observation list to count entries and find the
latest timestamp. `indexMeasurements()` now builds all per-code counts, sample/activity
buckets and `lastMeasuredAt` in one pass, and `summarize()` / `summaryRowFor()` /
`detailEntries()` read from that index.

`apps/mobile-companion/src/connected/connectedRepository.ts`

### P3 — PC-side: two full DuckDB exports + JSON diff per mutation `DEFERRED`

`DuckDbRepository.transaction(..., trackReplica)` snapshots and Zod-parses the entire
store before and after every tracked mutation, then diffs the two objects to produce
replica change rows. That is the single largest cost in the PC→phone path and it scales
with total profile size rather than with the size of the edit.

Deferred: fixing it properly means emitting change records directly from the mutation
commands (`duckdbRepository.ts` / `duckdbCommands.ts`) rather than deriving them, which is
a large and risky refactor. Worth doing before release if write latency becomes noticeable.

### P4 — `applyReplicaPage` ran a redundant SELECT per change `DONE`

Each incoming change did a `SELECT revision` round-trip before writing, even though the
upsert and tombstone statements already carry revision guards in their `WHERE` clauses.
Removed the read and moved the writes onto two prepared statements reused across the whole
page, so a 1 000-row page is now 1 000 statement executions instead of 2 000 plus
statement re-compilation.

`apps/mobile-companion/src/standalone/sqliteLocalStore.ts` (`writeReplicaChanges`)

### P5 — `healthDataDetail` returned unbounded `chartPoints` `DONE`

A year of continuous heart-rate data serialised tens of thousands of points into a chart
that renders a few hundred pixels wide. Points are now capped at `MAX_CHART_POINTS` (500)
with even downsampling that always preserves the first and last sample. Verified against
`mergeHealthDataDetail` in `@vitana/shared`, which dedupes by
`kind\0timestamp\0value\0unit` and re-sorts, so downsampled pages still merge correctly.

`apps/mobile-companion/src/connected/connectedRepository.ts`

### P6 — `recordReplicaChanges` inserted one row at a time `DONE`

The change log was written with one `INSERT` per change inside the mutation transaction.
Now sorted once and written with a single batched `insertRows` call.

`apps/api/src/storage/duckdbReplicaSync.ts`

---

## Correctness detail

### B1 — A rolled-back PC store froze the phone forever `DONE`

If the PC was restored from backup (or the change log was reset), its high-water mark went
*backwards*. The phone kept requesting deltas after a sequence the PC no longer had, got
nothing, and served stale data indefinitely with no error.

`hasRewound()` compares the handshake high-water mark against the cached cursor and
discards the local replica so the next pass takes a fresh snapshot.

`apps/mobile-companion/src/connected/syncCoordinator.ts`

### B2 — An interrupted first snapshot restarted from zero `DONE`

The snapshot cursor lived only in a local variable, so losing Wi-Fi on page 9 of 10 meant
starting again from page 1. The cursor is now persisted in
`connected_replicas.snapshot_cursor` and the coordinator resumes from it. Cleared once the
snapshot completes.

`syncCoordinator.ts`, `sqliteLocalStore.ts`, `memoryLocalStore.ts`, `localStore.ts`,
`migrations.ts`

### B3 — Snapshot tables were never pruned `DONE`

`companion_sync_snapshots` / `companion_sync_snapshot_entries` accumulated one full copy of
the profile per snapshot, and there is no FK cascade between them.
`createReplicaSnapshot` now deletes the superseded snapshot rows and entries for the
pairing before writing the new one.

Change-log pruning was deliberately **not** added: dropping old
`companion_sync_changes` rows recreates B1 unless the delta endpoint also rejects an
`afterSequence` below the retained floor. That belongs with the P3 work.

`apps/api/src/storage/duckdbReplicaSync.ts`

### B4 — Pull-to-refresh could silently no-op `DONE`

Sync calls were coalesced onto a single in-flight promise regardless of the `force` flag,
so a user-initiated pull-to-refresh landing during a background sync would join the
background call and be skipped by the freshness gate. The in-flight record now tracks
`force`; a forced request only joins an already-forced call, otherwise it chains after the
current one.

`apps/mobile-companion/src/MobileApiProvider.tsx`

### B5 — Staleness compared the device clock to the PC clock `DONE`

The freshness window measured `Date.now()` against `cachedAt`, which is generated by the
paired PC. Any clock skew produced either permanent re-syncing or a cache that never
refreshed. Added a device-local `applied_at` column, and the freshness gate now uses it.
`cachedAt` is retained for display only.

`connectedDataSource.ts`, `localStore.ts`, `sqliteLocalStore.ts`, `migrations.ts`

### B6 — Coordinator was dead after `deleteConnectedReplica()` `DONE`

"Forget my synced health data" disposed the store but left the memoised `coordinator` and
`repository` pointing at the closed handle, so the next sync threw. Both are now cleared.

`apps/mobile-companion/src/connected/connectedDataSource.ts`

### B7 — Mode switch closed and re-derived the SQLCipher key `DONE`

Switching between Standalone and Connected dropped the last lease on the shared database,
closing it and forcing a full SecureStore key fetch plus `PRAGMA key` re-derivation on the
next read — a visible stall. `retainConnectedStore()` takes a keep-alive lease across the
switch, released by an effect keyed on the new data source (and on the failure path, so a
failed switch cannot leak the lease).

`connectedDataSource.ts`, `MobileApiProvider.tsx`

### B8 — Replica deletion trusted an FK cascade `DONE`

`deleteReplica` deleted only the parent row and relied on `ON DELETE CASCADE`, which is a
no-op whenever `foreign_keys` is off. On a privacy-critical path that risked orphaned
health data. Both tables are now deleted explicitly inside one transaction.

`apps/mobile-companion/src/standalone/sqliteLocalStore.ts`

---

## Tech debt detail

### T1 — Three implementations of the same query semantics `DEFERRED`

Standalone SQL, the Connected projection, and the PC repository each implement summary and
detail semantics independently, so they drift. The Standalone SQL path is the best
reference. Consolidating is worthwhile but is a larger refactor than this pass.

### T2 — Wire payloads are blind-cast, never validated `DEFERRED`

Replica entity payloads are `JSON.parse`d and cast on every read. They should be validated
once per entity type when a page is applied, then trusted. Deferred to avoid adding
per-row Zod cost to the apply path until P3 lands.

### T3 — Read-only replica advertised delete affordances `DONE`

Deletion counts were hardcoded to `0` while entries still advertised `canDelete`, so the
confirmation sheet claimed nothing would be removed. Connected mode does support deletes
via the live API, so real counts are now reported.

`apps/mobile-companion/src/connected/connectedRepository.ts`

### T4 — Redundant index on `connected_replica_entities` `DONE`

`connected_replica_entities_type_idx (replica_id, entity_type)` duplicated the leading
columns of the primary key. Dropped in the v4 migration.

`apps/mobile-companion/src/standalone/migrations.ts`

### T5 — `synchronous = FULL` for a re-derivable cache `DEFERRED`

The replica is a cache that can always be rebuilt from the PC, so paying full fsync
durability on every bulk apply is expensive. Deferred because the setting is shared with
the Standalone store, which genuinely needs it; splitting the replica into its own database
file (or relaxing to `NORMAL` only during bulk apply) is the real fix.

### T6 — Test coverage gap for sync edge cases `PARTIAL`

Added two coordinator tests covering the bugs that had no coverage:

- resumes an interrupted first snapshot instead of re-downloading it (B2)
- re-snapshots when the paired PC reports less history than the cache holds (B1)

`apps/mobile-companion/src/connected/syncCoordinator.test.ts`

Not added: a test for force-vs-background sync coalescing (B4). That logic lives inside
`MobileApiProvider`, and there is no React test harness in this workspace — adding one for
a single case would cost more than it returns.

---

## Incidental fixes

These were pre-existing failures on this branch, unrelated to the review, that had to be
resolved to validate the changes above.

- `duckdbRepository.integration.test.ts` still asserted schema version 12 after the
  companion-sync tables took it to 13 (4 tests).
- Opening a profile whose registry still held the retired `metabolic` measurement category
  threw. The reconciliation that heals it runs inside a replica-tracked transaction, and
  that transaction's validating snapshot could not parse the row — so the heal rolled
  itself back and the profile could never be opened. The category is now reset ahead of the
  tracked transaction. (`apps/api/src/storage/duckdbSchema.ts`)

---

## Validation

| Suite | Result |
|-------|--------|
| `npm test --workspace @vitana/mobile-companion` | 25 files, 111 tests passed |
| `npm run test:core` | 82 files, 509 tests passed |
| `npm run test:integration` | 6 files, 93 tests passed, 1 file skipped |

