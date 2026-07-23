# Codebase and Play Store Readiness Review

**Reviewed:** 2026-07-23  
**Revision:** `debbda8`  
**Scope:** Android companion, API and encrypted storage, web and shared packages, desktop packaging, CI/release controls, public declarations, and automated tests

## Executive assessment

Vitana has strong foundations: per-profile encrypted storage, capability-scoped companion access, production TLS pinning, bounded Health Connect defaults, schema-validated API boundaries, hardened Electron settings, and a substantial fast test suite.

It is not ready for a public release yet. Two independent recovery paths can currently lose health data: desktop backup restore omits complete data domains, and Android Standalone mode selects a new profile after every app restart. The Android binary and Play-facing documentation also disagree about Standalone storage, billing, EAS Update traffic, and extended Health Connect history access. Resolve the P0 and Android P1 findings before Play submission.

## Method and validation

The review traced representative write/read flows across clients, authorization, repositories, encrypted databases, release configuration, and declarations. Previous reports were checked against current code rather than copied forward.

| Check | Result |
| --- | --- |
| Workspace typecheck and production build | Passed |
| Core tests | 59 files, 387 tests passed |
| Desktop tests | 31 tests passed |
| Integration tests | Could not complete: the sandbox lacked the prepared DuckDB `httpfs` extension; 24 tests passed before 36 setup failures |
| Durability tests and `audit:ci` | Not reached after integration setup failure |
| Production dependency audits | No result: configured registry host could not be resolved |

The web tests pass but repeatedly emit React `act(...)` warnings. These do not fail CI, but they reduce the signal of asynchronous UI tests.

## Release blockers

### P0 — Backup restore silently omits data and “replace” does not replace

Backup creation exports personal reference ranges, devices, measurement metadata, health events, care items, insights, and audit events (`apps/api/src/storage/duckdbExport.ts:140-192`). Restore only reconstructs import/observation domains (`apps/api/src/routes/backupRoutes.ts:332-396`). A successful restore therefore silently drops clinically meaningful data such as immunizations, medication administrations, reminders, insights, and custom reference ranges.

For an existing profile, the `replace` path updates the profile row and merges imports into the live database (`apps/api/src/routes/backupRoutes.ts:279-285`). Existing observation IDs are ignored rather than replaced (`apps/api/src/storage/duckdbImportPersistence.ts:140-145`), and records removed since the backup remain present.

**Action:** restore into a fresh encrypted database using the same full-fidelity hydration path as initial storage creation, verify parity, then atomically swap it into place. Add a round-trip test containing every stored domain and changed/deleted observations.

### P0 — Android Standalone data becomes invisible after every relaunch

Each native repository creation generates a new profile ID (`apps/android-companion/src/standalone/createStandaloneRepository.native.ts:5-13`). Initialization inserts that new profile and uses it for all subsequent profile-filtered queries (`apps/android-companion/src/standalone/sqliteLocalStore.ts:95-108`). The encrypted database and key persist, but the selected profile ID does not, so prior readings remain orphaned and the relaunched app appears empty. Standalone is the default for an unpaired installation (`apps/android-companion/src/operatingModeStore.ts:16-21`).

**Action:** persist and reuse one stable local profile ID, or adopt the existing profile row when opening the database. Add a native reopen test proving observations survive process restart.

## High-priority findings

### P1 — Restore rollback and crash recovery are non-functional

The error response claims the previous state was restored (`apps/api/src/routes/backupRoutes.ts:317-323`), but `rollback()` only marks and deletes the journal (`apps/api/src/storage/restoreJournal.ts:118-122`). It does not undo completed mutations. `RestoreJournal.recover()` exists (`restoreJournal.ts:58-79`) but is never called, and the journal never receives usable old/new database paths.

**Action:** stage side databases, journal every swap, recover incomplete journals during startup, and return a rollback claim only after verified compensation.

### P1 — Body-fat imports are multiplied by 100

The Health Connect mapper stores `record.percentage * 100` (`apps/android-companion/src/syncHealthConnect.ts:195-198`). Android Health Connect percentages are already expressed from 0 to 100, as reflected by the adjacent oxygen-saturation mapper (`syncHealthConnect.ts:123-126`).

**Action:** remove the multiplier and add a focused Body Fat mapping regression test before accepting Health Connect data.

### P1 — Comma-decimal health values are silently rescaled

`readNumber` removes every comma before parsing (`packages/shared/src/parserPrimitives.ts:79-84`). Values such as `12,5` become `125`, while mixed formats such as `1.234,56` are also corrupted. Multiple report and CSV parsers accept commas in numeric input, so this is a data-integrity blocker for a global release.

**Action:** implement one explicit locale-aware numeric parser and directly test comma decimals, grouping separators, spaces, and ambiguous inputs.

### P1 — Production behavior and Play declarations disagree

The production app exposes and defaults to encrypted Standalone storage (`App.tsx:115-170`, `operatingModeStore.ts:16-21`), while the privacy policy and Data Safety document describe health data as transferred to and retained only by the paired desktop (`docs/PRIVACY_POLICY.md:15-23`, `docs/PLAY_DATA_SAFETY.md:9-20`). Production also contacts Expo for EAS updates (`apps/android-companion/app.config.js:70-74`), despite the absolute “no vendor data uploads” statement.

The manifest requests extended Health Connect history permission (`app.config.js:34`), but the Health Connect declaration does not explicitly name or justify that special permission (`docs/HEALTH_CONNECT_DECLARATION.md:5-15`).

**Action:** decide the exact v1 feature set, then make the binary, privacy policy, Data Safety answers, Health Connect declaration, inventory, and reviewer instructions describe the same behavior.

### P1 — Paid-release configuration is internally inconsistent

Purchase gating is hard-disabled and all users are treated as entitled (`apps/android-companion/src/entitlementService.ts:3-4`, `src/EntitlementProvider.tsx:20-25`). The IAP plugin and Billing permission still ship, while the release runbook requires testing `scan_sync_unlock` (`docs/ANDROID_RELEASE.md:37-42,73-80`).

If gating is enabled as written, a cached AsyncStorage boolean permanently grants offline ownership even when the store no longer reports the purchase (`entitlementService.ts:91-107,188-196`).

**Action:** either remove IAP from v1 and update the runbook, or complete purchase verification, revocation/refund handling, restore behavior, and license testing before submission.

### P1 — Demo mode can close and then reuse the Standalone database

The Standalone data source is memoized independently of Demo mode (`apps/android-companion/src/MobileApiProvider.tsx:93-103`). Changing to Demo mode changes `source`, whose effect cleanup disposes the Standalone repository (`MobileApiProvider.tsx:279-284`, `standaloneDataSource.ts:44-46`). Turning Demo mode off reuses that same data-source object with its closed repository.

**Action:** scope disposal to the Standalone source lifetime or recreate it after disposal, and test Standalone → Demo → Standalone.

## Medium-priority findings

### P2 — Important CI gates are manual or tag-only

Integration tests are manual-only, durability tests run only on dispatch/tags, and Android Kotlin certificate-pinning tests plus Windows packaging smoke tests run only on manual dispatch (`.github/workflows/integration-tests.yml`, `.github/workflows/durability-tests.yml`, `.github/workflows/ci.yml:89-190`).

**Action:** gate relevant pull requests with integration tests and Android pinning unit tests; schedule durability and packaged-desktop smoke tests.

### P2 — Android lacks a verified artifact release gate

The Windows tag workflow verifies signatures, updater metadata, smoke behavior, checksums, and provenance (`.github/workflows/release-windows.yml`). Android relies on a manual EAS/Play runbook and has no equivalent commit-to-AAB evidence gate.

**Action:** record the EAS artifact, commit, channel, version code, configuration, checksum, and test-track promotion as protected release evidence. Target API 35 is currently accepted, but move to API 36 before Google Play’s 2026 deadline.

### P2 — API contract documentation has substantial drift

`docs/API_CONTRACT.md` omits current Care, backup/restore, biological-age, chart/reference-range, cloud-consent, metadata-reset, desktop-settings, and AI-settings endpoints used by `packages/api-client/src/index.ts` and `apps/web/src/api.ts`.

**Action:** update the contract from the current route surface and add a lightweight route/documentation consistency check.

### P2 — Import parsers contain provenance and status inconsistencies

The blood-test parser identifies itself as `body-composition-text-v1` and treats an undefined `included` value differently from other parsers (`packages/shared/src/bloodTestParser.ts:94-104`). Generic import status counts informational diagnostics as failures, allowing a successful import to be labeled `needs-review` (`packages/shared/src/observationImportParsers.ts:47,70,139,234`).

**Action:** correct the parser version, standardize inclusion semantics, and classify diagnostics by severity before computing status.

### P2 — Concurrent restores are not mutually exclusive

Restore maintenance uses a process-global boolean (`apps/api/src/routes/backupRoutes.ts:34-37,228,324-326`). A second restore can overlap and clear maintenance while the first is still mutating profile state.

**Action:** use a single-flight restore lock and reject concurrent attempts.

### P2 — Retired and duplicate runtime paths remain

The repository-root `main.cjs` is an unreferenced, broken duplicate of the desktop entry point. The real desktop launcher still sets a JSON rollback backend (`apps/desktop/main.cjs:158-159`), although current storage accepts DuckDB only (`apps/api/src/storage/profileStoreManager.ts:97-98,318-330`).

**Action:** delete the root duplicate and remove the non-functional JSON rollback switch.

### P2 — Destructive web action bypasses the accessible dialog

Measurement metadata reset uses `window.confirm` (`apps/web/src/pages/SettingsPage.tsx:144`) instead of the app’s accessible confirmation dialog.

**Action:** route the action through the existing dialog service and restore focus after all dialog closures.

## Maintenance debt

- `insights` and `audit_events` have no retention policy and grow indefinitely (`apps/api/src/storage/duckdbRuntime.ts:289-295`).
- Android screens and orchestration are too concentrated: `ImportScreen.tsx`, `TrackDetailScreen.tsx`, and `syncHealthConnect.ts` mix UI, permissions, networking, serialization, and retry logic.
- Web `SummaryPage.tsx` and `ImportPage.tsx` contain multiple page-level responsibilities; upload preview orchestration is duplicated in `UploadImportFeature.tsx`.
- `packages/shared/src/registry.ts`, `apps/api/src/storage/duckdbProjections.ts`, and `duckdbCommands.ts` are large change hotspots. Split by domain when next modified; do not introduce a new framework solely for this.
- Health Connect and pinned networking are Android-specific implementations rather than platform interfaces, increasing the cost of the planned iOS app.
- `expo-keep-awake` is imported directly but only available transitively; declare it explicitly or remove the import.
- Remove the unused `apps/android-companion/modules/lfa-pinned-http` directory and empty `VitanaPinnedHttp.types.ts`.
- Generate the companion device ID with `expo-crypto`, and align token SecureStore accessibility with the device-only database key policy.
- Replace O(n²) chart-point deduplication in `packages/shared/src/mobileFeatures.ts:85-88` with a keyed set when touching pagination.

## Strengths to preserve

- Companion routes use explicit capabilities and profile-bound repositories rather than a denylist.
- Production mobile traffic uses QR-established SPKI pinning and disallows cleartext.
- Health Connect starts with no selected categories, a 30-day window, and an in-app disclosure.
- DuckDB access is behind repository interfaces, preserving a practical path to a future SQLite provider.
- Backup cryptography uses authenticated AES-256-GCM, a versioned format, scrypt, bounded decompression, and per-profile digests; the defect is restore orchestration, not its cryptography.
- AI endpoints require explicit cloud consent and apply host allowlisting, public-address checks, manual redirects, and SELECT-only query compilation.
- Electron enables sandboxing, context isolation, and disabled Node integration.
- Windows release automation now verifies signed artifacts end to end.

## Previous-review status

- **Portable backup/restore:** implemented but **not safely resolved** because restore is incomplete and non-atomic.
- **Tagged Windows artifact gate:** resolved for Windows; Android remains manual.
- **Imperial analytics, latest lab alerts, child/pet range suppression, audit fail-closed behavior, trusted OAuth callback origin, atomic pairing registry writes, and profile validation:** verified as retained.
- **Companion capability allowlist, pinned profile access, cloud consent, and least-privilege Health Connect defaults:** verified as retained.

## Recommended release order

1. Fix and round-trip test full-fidelity desktop restore.
2. Fix Standalone profile persistence, Body Fat scaling, and the Demo-mode lifecycle.
3. Freeze the Android v1 feature/billing scope and align every Play declaration with the exact AAB.
4. Run a physical-device Play internal-track pass, including reinstall/relaunch, font scaling, offline unpairing, Health Connect history, purchase/refund if enabled, and inspection of on-device storage.
5. Gate integration and Android native pinning tests, then capture verifiable AAB release evidence.
6. Address parser correctness before marketing a global launch; schedule module decomposition and retention work after correctness blockers.