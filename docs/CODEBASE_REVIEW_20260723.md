# Codebase and Play Store Readiness Review

**Reviewed:** 2026-07-23

**Original revision:** `debbda8`

**Remediation verified:** `bfe78d6`

**Scope:** Android companion, API and encrypted storage, web and shared packages, desktop packaging, CI/release controls, public declarations, and automated tests

## Executive assessment

Vitana has strong foundations: per-profile encrypted storage, capability-scoped companion access, production TLS pinning, bounded Health Connect defaults, schema-validated API boundaries, hardened Electron settings, and a substantial fast test suite.

It is not ready for a public release yet. The desktop backup restore blocker has been resolved. Android Standalone profile persistence, Demo-mode resource lifetime, and Play-facing declarations have also been remediated. Purchase gating is deliberately deferred for the initial free closed test; its entitlement and release requirements remain blockers for the first billing-enabled AAB. The remaining release-evidence findings also need resolution before public release.

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

### Post-review remediation validation

The desktop restore changes were validated separately after the original review environment was repaired:

| Check | Result |
| --- | --- |
| API and web typechecks | Passed |
| Focused route, recovery, and concurrency tests | 12 passed |
| Encrypted DuckDB restore integration tests | 6 passed |
| Independent backup endpoint rate-limit regression test | Passed |
| Manual create, inspect, and replace workflow | Passed; one profile restored successfully |
| Restore-panel desktop and 390 px layout checks | Passed; no horizontal overflow |

The web tests pass but repeatedly emit React `act(...)` warnings. These do not fail CI, but they reduce the signal of asynchronous UI tests.

## Release blockers

### P0 — Backup restore silently omits data and “replace” does not replace — RESOLVED

**Status at `bfe78d6`: resolved.** Restore orchestration is now owned by `ProfileStoreManager.restoreProfiles()`. Each selected snapshot is hydrated through the full-fidelity repository path into a fresh encrypted side database, checked for parity, and promoted only after hydration succeeds.

The `replace` decision now swaps the complete staged database rather than merging imports into the live database. Records changed after the backup are restored to their backed-up values, and records created after the backup are removed. The integration fixture covers personal reference ranges, devices, measurement metadata, health events, care items, insights, audit events, imports, observations, and changed/deleted observation behavior.

**Verification:** full-domain encrypted round-trip tests pass in `duckdbActivation.integration.test.ts`.

### P0 — Android Standalone data becomes invisible after every relaunch — RESOLVED

Each native repository creation generates a new profile ID (`apps/android-companion/src/standalone/createStandaloneRepository.native.ts:5-13`). Initialization inserts that new profile and uses it for all subsequent profile-filtered queries (`apps/android-companion/src/standalone/sqliteLocalStore.ts:95-108`). The encrypted database and key persist, but the selected profile ID does not, so prior readings remain orphaned and the relaunched app appears empty. Standalone is the default for an unpaired installation (`apps/android-companion/src/operatingModeStore.ts:16-21`).

**Status: resolved.** Encrypted SQLite initialization now adopts the persisted profile containing the most observations/imports before considering a generated default, with deterministic tie-breakers for an empty database. Repository recreation therefore continues querying the existing profile-scoped observations instead of creating and selecting an empty profile.

**Verification:** the focused SQLite local-store regression recreates the repository with a different process-time default ID and confirms that the persisted profile and observation counts remain visible.

## High-priority findings

### P1 — Restore rollback and crash recovery are non-functional — RESOLVED

**Status at `bfe78d6`: resolved.** Restore journals now record staged, live, and rollback database paths plus snapshots of registry and manifest metadata. Failure compensation reverses completed swaps, restores metadata, verifies expected paths, and reports restoration only after compensation succeeds. Incomplete journals are recovered during profile-store startup.

**Verification:** focused tests cover interrupted swaps, metadata recovery, rollback verification, and startup recovery.

### P1 — Body-fat imports are multiplied by 100 — RESOLVED

**Status: resolved.** The Health Connect mapper now stores `record.percentage` directly, preserving the 0-to-100 values Health Connect provides.


### P1 — Comma-decimal health values are silently rescaled — RESOLVED

**Status: resolved.** `readNumber` now delegates to an explicit locale-aware parser in `packages/shared/src/parserPrimitives.ts`. It accepts unambiguous comma-decimal, dot-decimal, grouped, space-grouped, and non-breaking-space inputs, while rejecting ambiguous and malformed single-separator formats rather than silently rescaling values.

**Verification:** the focused shared parser suite passed with direct coverage for `12,5`, `1.234,56`, `1,234.56`, space grouping, non-breaking-space grouping, and ambiguous or malformed inputs.

### P1 — Production behavior and Play declarations disagree — RESOLVED

The production app exposes and defaults to encrypted Standalone storage (`App.tsx:115-170`, `operatingModeStore.ts:16-21`), while the privacy policy and Data Safety document describe health data as transferred to and retained only by the paired desktop (`docs/PRIVACY_POLICY.md:15-23`, `docs/PLAY_DATA_SAFETY.md:9-20`). Production also contacts Expo for EAS updates (`apps/android-companion/app.config.js:70-74`), despite the absolute “no vendor data uploads” statement.

The manifest requests extended Health Connect history permission (`app.config.js:34`), but the Health Connect declaration does not explicitly name or justify that special permission (`docs/HEALTH_CONNECT_DECLARATION.md:5-15`).

**Status: resolved.** The privacy policy, Data Safety guide, Health Connect declaration, data inventory, and release runbook now distinguish encrypted on-device Standalone storage from Connected-mode transfer. They disclose EAS Update service traffic without claiming that health records are sent to Expo, and explicitly document the conditional `READ_HEALTH_DATA_HISTORY` request for user-selected windows over 30 days.

### P1 — Paid-release configuration is internally inconsistent — DEFERRED FOR FREE CLOSED TESTING

Purchase gating is hard-disabled and all users are treated as entitled (`apps/android-companion/src/entitlementService.ts:3-4`, `src/EntitlementProvider.tsx:20-25`). The IAP plugin and Billing permission still ship, while the release runbook requires testing `scan_sync_unlock` (`docs/ANDROID_RELEASE.md:37-42,73-80`).

If gating is enabled as written, a cached AsyncStorage boolean permanently grants offline ownership even when the store no longer reports the purchase (`entitlementService.ts:91-107,188-196`).

**Status: accepted for the initial free closed test.** Purchase gating remains hard-disabled, the inactive entitlement service does not connect to Play Billing, and Scan and Sync remain available without a purchase. Keeping the native IAP dependency in this test build is intentional preparation for a later paid release. The release runbook now separates checks required for every release from checks required only for billing-enabled releases.

This finding is not resolved for paid distribution. Before enabling gating, replace permanent cached ownership with an explicit verification and offline-grace policy, handle authoritative no-purchase and refund/revocation results, decide whether existing free-test users are grandfathered, update purchase-data declarations, and complete Play license testing. Billing must first ship in a new versioned AAB that returns to closed testing; it must not be activated in the free-test binary through an OTA update.

### P1 — Demo mode can close and then reuse the Standalone database — RESOLVED

The Standalone data source is memoized independently of Demo mode (`apps/android-companion/src/MobileApiProvider.tsx:93-103`). Changing to Demo mode changes `source`, whose effect cleanup disposes the Standalone repository (`MobileApiProvider.tsx:279-284`, `standaloneDataSource.ts:44-46`). Turning Demo mode off reuses that same data-source object with its closed repository.

**Status: resolved.** Demo mode now removes the Standalone source from its memoized source slot. Entering Demo disposes the old source, and leaving Demo creates a new source that reopens the persisted encrypted database instead of reusing the disposed object.

**Verification:** the focused operating-mode policy regression covers Standalone → Demo → Standalone source eligibility.

## Medium-priority findings

### P2 — Important CI gates are manual or tag-only

Integration tests are manual-only, durability tests run only on dispatch/tags, and Android Kotlin certificate-pinning tests plus Windows packaging smoke tests run only on manual dispatch (`.github/workflows/integration-tests.yml`, `.github/workflows/durability-tests.yml`, `.github/workflows/ci.yml:89-190`).

**Action:** gate relevant pull requests with integration tests and Android pinning unit tests; schedule durability and packaged-desktop smoke tests.

### P2 — Android lacks a verified artifact release gate

The Windows tag workflow verifies signatures, updater metadata, smoke behavior, checksums, and provenance (`.github/workflows/release-windows.yml`). Android relies on a manual EAS/Play runbook and has no equivalent commit-to-AAB evidence gate.

**Action:** record the EAS artifact, commit, channel, version code, configuration, checksum, and test-track promotion as protected release evidence. Target API 35 is currently accepted, but move to API 36 before Google Play’s 2026 deadline.

### P2 — API contract documentation has substantial drift — RESOLVED

`docs/API_CONTRACT.md` omits current Care, backup/restore, biological-age, chart/reference-range, cloud-consent, metadata-reset, desktop-settings, and AI-settings endpoints used by `packages/api-client/src/index.ts` and `apps/web/src/api.ts`.

**Action:** update the contract from the current route surface and add a lightweight route/documentation consistency check.

### P2 — Import parsers contain provenance and status inconsistencies — RESOLVED

**Status: resolved.** Blood-test scan drafts now identify as `blood-test-text-v1`, and committed rows follow the standard `included !== false` convention. Generic CSV and manual import parsers now maintain internal diagnostic severity: skipped or invalid rows are errors, while defaults such as a canonical unit or generated code are informational. Only errors cause `needs-review`.

**Verification:** focused shared parser tests passed for correct scan provenance, legacy row inclusion, informational diagnostics retaining `processed` status, and generated-code CSV rows retaining `processed` status.

### P2 — Concurrent restores are not mutually exclusive — RESOLVED

**Status at `bfe78d6`: resolved.** Restore uses a single-flight operation ID. A concurrent request is rejected while the active operation retains ownership of the lock, and only that operation can clear it.

**Verification:** the route regression test holds one restore open, confirms the overlapping request is rejected, and confirms maintenance state is released by the owning restore.

### P2 — Retired and duplicate runtime paths remain — RESOLVED

**Status: resolved.** The unreferenced repository-root `main.cjs` has been deleted. The supported desktop launcher now unconditionally sets `VITANA_STORAGE_BACKEND` to `duckdb`, removing the stale JSON rollback environment switch.

**Verification:** the desktop workspace test suite passed with 25 tests.

### P2 — Destructive web action bypasses the accessible dialog — RESOLVED

**Status: resolved.** Measurement metadata reset now uses the app-level `ConfirmDialog` service instead of `window.confirm`. The shared dialog captures the invoking element before opening and restores its focus after either confirmation or cancellation.

**Verification:** focused Settings and confirmation-dialog tests passed, including focus restoration after confirmation and cancellation.

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

- **Portable backup/restore:** **resolved at `bfe78d6`** with full-fidelity hydration, parity checks, atomic database promotion, verified compensation, and startup journal recovery.
- **Tagged Windows artifact gate:** resolved for Windows; Android remains manual.
- **Imperial analytics, latest lab alerts, child/pet range suppression, audit fail-closed behavior, trusted OAuth callback origin, atomic pairing registry writes, and profile validation:** verified as retained.
- **Companion capability allowlist, pinned profile access, cloud consent, and least-privilege Health Connect defaults:** verified as retained.

## Additional remediation completed

- Backup creation, inspection, and restore now use independent rate-limit buckets, preventing a normal multi-step workflow from exhausting one shared allowance.
- The restore acknowledgment checkbox uses scoped native-checkbox styling and remains aligned when its text wraps.
- Restore results and the final restore action have explicit vertical spacing at desktop and narrow viewport widths.

## Recommended release order

1. Run the initial closed test with purchase gating explicitly disabled and record that billing state with the artifact.
2. Validate the remediated Standalone persistence, Demo transition, and Play declarations on a physical device and in Play Console.
3. Run a physical-device Play internal-track pass, including reinstall/relaunch, font scaling, offline unpairing, Health Connect history, and inspection of on-device storage.
4. Gate integration and Android native pinning tests, then capture verifiable AAB release evidence.
5. Before the first paid build, fix entitlement revalidation, choose the offline and grandfathering policies, update declarations, and test purchase/refund flows in a new closed-track AAB.
6. Address parser correctness before marketing a global launch; schedule module decomposition and retention work after correctness blockers.
