# Codebase and Launch-Readiness Review

**Reviewed:** 2026-07-13  
**Revision:** `9c1696033922`  
**Previous review:** [`CODEBASE_REVIEW_20260710.md`](CODEBASE_REVIEW_20260710.md)  
**Scope:** Windows desktop host, LAN API, web UI, encrypted DuckDB storage, Android companion, shared domain package, tests, CI, privacy, and release operations

## Executive assessment

The application has improved substantially since the 2026-07-10 review. The move to one encrypted DuckDB database per profile is a sound architectural direction: it removes the normal dual-store/derived-warehouse design, provides transactions and schema migrations, keeps analytics next to canonical data, and has unusually careful activation and compatibility checks. The API and web code are also better structured, cloud-query consent and prompt minimization exist, Android sync now has cursors, chunking, provenance, partial-permission handling, retries, and certificate pinning, and the desktop key is wrapped by the operating system.

It is **not ready for an external desktop launch or Play Store submission** at this revision. Three implementation defects are immediate release blockers:

1. Companion tokens are effectively owner credentials and can read/export/delete health data and administer profiles and AI settings.
2. The central model client ignores its `allowCloud` control, so insight generation can send health evidence to a cloud endpoint without profile consent.
3. A clean dependency installation does not produce a buildable workspace.

The paid Android app is additionally blocked on privacy-policy, Health Connect, Data Safety, and real release evidence. The desktop app is suitable for controlled Windows x64 internal testing only after the security blockers are fixed and fresh-install validation passes.

### Readiness by surface

| Surface | Assessment |
| --- | --- |
| Windows desktop, controlled internal testing | **Blocked pending P0 fixes** |
| Windows desktop, public download | **Not ready** |
| macOS/Linux desktop | **Unsupported by the DuckDB production path** |
| Android internal test track | **Not ready for distribution until P0 security/privacy fixes** |
| Play Store production | **Not ready** |
| Core design direction | **Strong, with scale and recovery work remaining** |

## Review method and validation

The review traced authentication and route mounting, model calls, storage activation/migration/mutation paths, desktop key and installer behavior, Android pairing/sync/networking, web API usage, schemas, tests, CI, and release documentation. It also compared the current implementation with every open or completed theme in the previous review.

Fresh-install validation exposed a release-blocking baseline issue:

- `npm ci --ignore-scripts` completed with extensive extraction warnings, but the resulting workspace omitted normal root dependencies.
- `npm run typecheck` and `npm run build` failed in `packages/shared` because `zod` and `@noble/hashes` could not be resolved.
- `npm run typecheck -w apps/android-companion` and `npm test` also failed before a usable install was established.
- The root package declares itself as a file dependency (`package.json:37-39`), and the lockfile's `packages/shared` entry omits the dependencies present in its package manifest (`package-lock.json:15256-15262`; `packages/shared/package.json:23-25`).
- The standalone desktop key tests passed: 4/4.
- `npm run audit:ci` passed only because five high-severity packages are temporarily allowlisted (`.audit-allowlist.json:2-9`). The install reported 11 moderate and 5 high vulnerabilities.

No Windows installer build, EAS build, physical-device test, Play Console inspection, penetration test, performance soak, restore drill, or manual WCAG audit was performed. Those require release environments outside this repository.

## Findings

Priorities:

- **P0:** Must fix before distributing either app to external users.
- **P1:** Must fix before a stable public release.
- **P2:** Important hardening or product-quality work.

### Security and privacy

#### P0 — Companion tokens grant broad owner-level access

The central middleware permits a valid companion token on every API route except a short denylist of pairing-management paths (`apps/api/src/createApp.ts:45-51,232-271`). Tests explicitly confirm that a companion token can read `/api/store` (`apps/api/src/__tests__/server.test.ts:214-220`).

A stolen phone token can therefore:

- read the complete normal store and full export (`apps/api/src/routes/dataRoutes.ts:85-95,163-179`);
- delete observations (`apps/api/src/routes/dataRoutes.ts:115-140`);
- edit, create, activate, or delete profiles (`apps/api/src/routes/profileRoutes.ts:41-66,119-161`);
- change cloud consent and AI settings (`apps/api/src/routes/profileRoutes.ts:68-114`; `apps/api/src/routes/settingsRoutes.ts:22-38`);
- trigger queries, model calls, and imports into an arbitrary profile.

This contradicts the scoped-token claims in the prior review and README (`docs/CODEBASE_REVIEW_20260710.md:105-107`; `README.md:64`).

**Required:** Make owner authorization the default. Give companion tokens an explicit allowlist limited to the profile-list fields needed by the app and Health Connect import. Bind each token to a device and allowed profile(s), and add negative authorization tests for export, deletion, settings, consent, query, and profile administration.

#### P0 — Cloud consent is not enforced by the central model client

`callConfiguredModel` accepts `allowCloud` but never evaluates it; an OpenAI-configured provider is called unconditionally (`apps/api/src/modelClient.ts:3-8,23-30`). Query routes have route-level checks, but insight generation calls the model with health metrics, dates, lab flags, and reference ranges and relies on the ignored option (`apps/api/src/insights.ts:5-15`; `apps/api/src/routes/dataRoutes.ts:153-160`).

This means a user can disable or never grant cloud consent and still transmit health-derived evidence by selecting **Generate insight**. The previous review's cloud-consent item is therefore not complete.

**Status (partially addressed 2026-07-13):** `allowCloud: false` is now enforced centrally after provider resolution, with a regression test that confirms no cloud request is made. Route-level disabled-consent coverage and a privacy-safe local audit event remain open.

#### P0 — Overbroad companion access enables SSRF and model-key disclosure

The AI settings route accepts any URL and retains the existing API key when a new one is omitted (`apps/api/src/routes/settingsRoutes.ts:7-12,26-38`). Model validation then sends both `Authorization` and `api-key` headers to that endpoint (`apps/api/src/modelClient.ts:64-105,128-159`).

Combined with the companion authorization defect, a paired-token holder can change the endpoint to an attacker-controlled host, preserve the owner's stored key, invoke validation, and receive that key. The same path provides POST-based server-side request forgery against local or link-local services.

**Required:** First make settings owner-only. Then require key re-entry when endpoint origin changes, permit only explicitly supported HTTPS endpoint origins, resolve and reject loopback/private/link-local/metadata destinations where remote providers are expected, and validate redirects.

#### P0 — Play privacy and Health Connect disclosure work is incomplete

The release checklist still depends on a public privacy-policy URL, Data Safety declaration, Health Connect declaration, and physical-device evidence (`docs/ANDROID_RELEASE.md:56-68`). The app has no privacy-policy link or purpose-specific explanation before permission requests (`apps/android-companion/App.tsx:220-237`).

The default is also maximum collection: all supported categories and a 365-day initial window (`apps/android-companion/src/endpointStore.ts:9-37,141-150`). This is not a least-privilege default and includes particularly sensitive categories such as glucose, blood pressure, sleep, temperature, body composition, and exercise.

**Required:** Publish and link a stable policy covering every category, purpose, LAN transfer, retention/eviction, deletion, cloud-model exception, security controls, and support contact. Default to no categories or a justified minimal set, show rationale before the system prompt, and make repository documentation and Play declarations derive from the same inventory.

#### P1 — Android profile discovery bypasses the authenticated pinned client

Sync and pairing use the native pinned client, but profile refresh uses ordinary unauthenticated `fetch` (`apps/android-companion/App.tsx:107-130`). The API currently returns data only because companion authorization is overbroad; once authorization is corrected, this flow will stop working.

**Status (partially addressed 2026-07-13):** Profile refresh now uses `pinnedFetch` with the paired companion token. Bounded timeout behavior and an intentionally minimal companion-safe profile response remain open.

#### [DONE] P1 — AI API keys are stored as plaintext application data

AI settings, including API keys, are written as JSON with mode `0600` (`apps/api/src/aiSettings.ts:24-38,90-92`). The desktop already has an OS-backed `safeStorage` abstraction for the DuckDB key, so the stronger mechanism is available.

**Required:** Wrap model credentials with OS secure storage in the packaged desktop, define migration behavior, and accurately document standalone-server behavior.

### Build, testing, and release engineering

#### P0 — Clean installation is not reproducible

The repository cannot currently demonstrate its own CI contract from a clean install. The root self-dependency (`"local-fitness-advisor": "file:"`) and stale workspace lock metadata are the leading evidence (`package.json:37-39`; `package-lock.json:15256-15262`).

This blocks trustworthy typecheck, build, test, packaging, dependency review, and contributor onboarding. It also invalidates a launch decision based only on previously passing tests.

**Status (partially addressed 2026-07-13):** The accidental root self-dependency was removed and workspace lock metadata regenerated. Clean-install and CI-gate verification remain open.

#### [IN PROGRESS] P1 — CI does not validate the actual Windows desktop product

CI runs only on Ubuntu and builds shared/API/web, typechecks Android, runs Vitest, and audits dependencies (`.github/workflows/ci.yml:8-89`). It does not:

- run the desktop's Node test suite;
- package the Electron app;
- execute the Windows-only encrypted DuckDB path;
- validate the bundled signed extension in a packaged runtime;
- smoke-test install, launch, LAN firewall setup, persistence, upgrade, or uninstall.

The production storage path explicitly rejects non-Windows x64 (`apps/api/src/server.ts:55-70`), so Linux CI cannot prove the shipped path.

**Required:** Add a Windows x64 release gate that packages and smoke-tests the installer and encrypted DuckDB runtime. Run the desktop tests in normal CI and retain installer hashes and test evidence for releases.

**Status (partially addressed 2026-07-13):** Initial version now added in draft PR

#### [IN PROGRESS] P1 — The public Windows installer has no signing or distribution hardening

The Electron configuration creates a per-machine NSIS installer and firewall rule, but contains no Windows code-signing configuration (`apps/desktop/package.json:22-54`). The firewall script does not inspect command failure (`apps/desktop/build/installer.nsh:1-7`).

Unsigned public binaries will produce poor SmartScreen trust and make update authenticity difficult to establish.

**Required:** Define code-signing ownership and protected credentials, sign and verify both application and installer, test firewall-rule failure/retry/removal, publish checksums, and document a secure update/release channel.

**Status (partially addressed 2026-07-13):** Initial version now added in draft PR

#### P1 — Android and native pinning logic lack automated tests

The Vitest workspace covers shared, API, and web only (`vitest.config.ts:3-10`). Android receives only TypeScript checking in CI (`.github/workflows/ci.yml:35-36`). Complex cursor, partial-permission, pagination, chunking, retry, category mapping, secure-storage, and Kotlin certificate-pin behavior therefore have no automated regression gate.

**Required:** Unit-test pure sync mapping/chunk/cursor logic, test storage migrations, and add Android/native integration tests for pin match/mismatch, timeouts, authentication, partial grants, duplicate retries, and multi-chunk cursor advancement.

**Status (partially addressed 2026-07-13):** Initial test suite created, but not running local yet until local Android SDK is added. Install Android Studio or the Android command-line SDK with Platform 36 and build-tools, then set ANDROID_HOME and ANDROID_SDK_ROOT.

#### P2 — Dependency vulnerability acceptance needs active ownership

The audit gate allows the DuckDB/node-gyp/tar chain despite five high-severity findings and says only to revisit monthly (`.audit-allowlist.json:2-9`). There is no scheduled CI evidence or expiry per exception.

**Required:** Track advisory IDs, exploitability, owner, review date, compensating controls, and expiry; automate scheduled audits; remove each exception as soon as upstream permits.

### Data integrity, storage, and performance

#### P1 — Silent retention can discard clinically relevant history

DuckDB imports silently trim collections to hard-coded limits: 250,000 observations, 10,000 time-series samples, 75,000 activities, and 20,000 groups (`apps/api/src/storage/duckdbRepository.ts:269-305,1278-1284`). Raw import content is silently cut at one million characters (`apps/api/src/storage/duckdbRepository.ts:1318-1323`). Insights and audit events remain unbounded (`apps/api/src/storage/duckdbRepository.ts:361-375,792-805`).

The chronological lab-marker bug from the previous review is addressed by using observation timestamps, but the larger policy problem remains. A 10,000-sample global cap is particularly small for a 365-day, multi-category Health Connect import. Import metadata can report source row counts even after canonical rows are evicted, and the user receives no warning.

**Required:** Stop silent eviction. Define retention per data class and category, return explicit accepted/deduplicated/evicted counts, preserve source diagnostics, provide capacity warnings, and let the user export before destructive compaction. Benchmark limits against realistic one-, three-, and five-year datasets.

#### [IN PROGRESS] P1 — DuckDB removes whole-file rewrites but operations remain full-snapshot heavy

The migration fixes the previous full encrypted-JSON rewrite and plaintext warehouse design. However, every `mergeImport` still reads the complete database into arrays, computes in-memory retention/deduplication, diffs collections, performs row-by-row synchronization, then snapshots the whole database again (`apps/api/src/storage/duckdbRepository.ts:106-225,269-358`). `DuckDbHealthStore` also retains a full in-memory `HealthStoreData` cache (`apps/api/src/storage/duckdbHealthStore.ts:30-37,94-105,144-151`).

**Status (substantially addressed 2026-07-14):** Normal web startup and routine refresh now use a bounded `GET /api/bootstrap` projection rather than `/api/store`. The projection contains profile metadata, measurement types, active reusable manual-group templates, latest insight, and aggregate counts; it excludes observation history, samples, sources, audit events, and raw import content. Import and deletion routes now return compact mutation metadata instead of complete stores.

`DuckDbRepository.mergeImport()` now appends only novel rows by primary key and performs retention in SQL. It no longer reads a pre-import database snapshot, materializes persisted collections in memory, synchronizes whole tables row-by-row, or returns a full post-import snapshot. It returns aggregate committed counts plus the audit event. Existing encrypted profile databases and schema remain intact.

Runtime startup is now DuckDB-only. JSON and rollback launch controls have been removed, existing manifests no longer require retained JSON files, and new profiles are created directly in DuckDB. Encrypted JSON remains only as a one-time migration source when no manifest exists.

The complete `DuckDbHealthStore` compatibility cache has also been removed. Profile reopen reads only the profile row, mutations no longer refresh or maintain a full in-memory mirror, and callers that genuinely need a complete store use an explicit asynchronous repository snapshot. Synchronous snapshots are restricted to the one-time JSON migration implementation.

**Pending work:**

- Return accepted, duplicate/skipped, and evicted counts from persistence so import responses can accurately describe the committed result rather than only parsed input counts.
- Move remaining snapshot-based consumers, including analytics, biological-age, insight generation, clinician reports, and query planning, to direct or deliberately bounded repository projections.
- Keep `/api/store` as an explicit export/debug or migration endpoint; do not reintroduce it into normal app startup or mutation refresh paths.
- Establish representative import, startup, query, payload-size, and peak-memory budgets after the incremental import path is in place.

**Required before public release:** Complete committed import accounting and the remaining bounded projections, then validate against representative one-, three-, and five-year datasets.

#### P1 — Active DuckDB data has no user-facing backup/restore path

Retained encrypted JSON files, where present from migration, are historical snapshots rather than current backups. The active database has transactional crash safety but no documented versioned backup, integrity-check schedule, restore workflow, or in-product recovery action.

`SECURITY.md` still describes `.enc.bak` automatic recovery as if it protects the current store (`SECURITY.md:61-67`), which is false for normal DuckDB operation.

**Required:** Implement and test encrypted, versioned DuckDB backup/restore with key recovery guidance, integrity verification, retention, failed-restore rollback, and a user-visible last-backup status. Correct the security documentation before launch.

#### P1 — Pairing registry persistence is synchronous and not crash-safe

Every successful companion-token validation updates `lastUsedAt` and rewrites `paired-devices.json` synchronously (`apps/api/src/pairing.ts:139-148,183-188`). The write is not temporary-file/rename based; malformed JSON causes startup failure (`apps/api/src/pairing.ts:46-60`).

**Required:** Use atomic persistence with validation and recovery, debounce nonessential last-used writes, and test interruption/corruption recovery.

### Product and maintainability

#### P1 — Public documentation materially understates Android collection

The README says the companion uses manual endpoint input and syncs six categories over 30 days (`README.md:114-125`). The app now uses QR pairing and defaults to roughly two dozen categories over 365 days (`apps/android-companion/src/endpointStore.ts:9-37`; `apps/android-companion/src/PairScreen.tsx:37-105`).

The README's privacy claim that companion tokens are import-scoped is also false, and `SECURITY.md` describes the retired JSON backup model as current.

**Status (partially addressed 2026-07-13):** README pairing/sync information and the Security backup description were reconciled with the current implementation. A complete release-artifact inventory and verification process remain open.

#### P1 — OpenRouter callback likely cannot complete with the owner cookie policy

The owner cookie is `SameSite=Strict` (`apps/api/src/createApp.ts:160-177`). The OpenRouter callback is mounted behind owner authentication (`apps/api/src/createApp.ts:232-271`; `apps/api/src/routes/settingsRoutes.ts:41-78`). A top-level return from `openrouter.ai` will normally omit a Strict cookie, and browser navigation cannot add the session-storage bearer token.

**Required:** Integration-test the complete OAuth callback. Use a narrowly scoped, one-time callback state flow that does not weaken the rest of owner authentication.

#### P2 — Accessibility implementation is promising but not verified

The web app has strong semantic foundations: native dialogs, tab roles, labels, focus styling, and live regions. There is no automated axe gate, documented keyboard/screen-reader pass, contrast report, or narrow-viewport acceptance evidence (`apps/web/vitest.config.ts:11-15`; `docs/CODEBASE_REVIEW_20260710.md:83-87`).

**Required:** Complete automated and manual WCAG 2.2 AA verification before making accessibility claims.

#### P2 — Error handling and public API typing drift

The web client discards HTTP status and correlation IDs and throws raw response text (`apps/web/src/api.ts:65-70`). Its health response type still expects storage/counts even though the endpoint intentionally returns only `{ ok, uptime }` (`apps/web/src/api.ts:150-152`; `apps/api/src/createApp.ts:180-186`). Several routes still return complete stores, and experimental endpoints remain active.

**Status (partially addressed 2026-07-13):** The stale web health-response type now matches `{ ok, uptime }`. Typed API errors, shared contracts, and lifecycle documentation remain open.

## Prior-review status

### Verified resolved or materially improved

- Native encrypted DuckDB is now canonical on Windows x64; the normal plaintext analytics warehouse is gone.
- Persisted JSON has strict runtime validation and a v1-to-v2 migration (`packages/shared/src/storeSchema.ts:4-136`).
- Import checksums now use SHA-256 (`packages/shared/src/parsers.ts:1-2`).
- DuckDB hydration is transactional, parity-checked, checkpointed, and atomically promoted (`apps/api/src/storage/duckdbRepository.ts:41-79`).
- Desktop DuckDB keys are wrapped with Electron `safeStorage`; insecure Linux storage is rejected.
- Cloud-query routes have explicit consent UI and bounded prompt-row sanitization.
- Normal web startup uses a bounded bootstrap projection, and import/delete API responses no longer serialize complete health stores.
- Android sync now supports selected categories, partial grants, a cursor with overlap, paginated reads, provenance, bounded chunks, retries, and pinning (`apps/android-companion/src/syncHealthConnect.ts:19-75,187-222,370-385,417-513,563-570`).
- The Android production/preview/development profiles and release checklist are substantially clearer.
- API modularization, environment validation, structured logging, graceful shutdown, stable public error codes, and web semantics remain good foundations.

### Still open, regressed, or only partly addressed

- LAN authentication exists, but companion authorization is dangerously overbroad.
- Cloud consent exists, but one model path bypasses enforcement.
- Retention ordering improved, but silent eviction and unbounded metadata remain.
- DuckDB avoids file rewrites; imports are incremental, mutation payloads are bounded, and profiles no longer materialize a full in-memory cache at open. Several explicit analytics/report/query operations still request full snapshots and need bounded projections.
- Android profile networking still bypasses pinning/authentication.
- Play privacy work and executed release evidence remain outstanding.
- Accessibility semantics improved, but independent verification remains outstanding.
- Typed API errors, lifecycle documentation, and migration of the remaining snapshot-based analytics/report/query consumers remain incomplete.

## Positive foundations to preserve

- A coherent local-first boundary with no telemetry or cloud sync.
- Non-loopback API startup fails closed without TLS (`apps/api/src/server.ts:28-42`).
- QR-delivered public-key pinning and production HTTPS enforcement.
- Strong owner-token generation, timing-safe comparison, local-session restrictions, and secure cookie flags.
- OS-wrapped desktop storage key and encrypted DuckDB temporary spill.
- Versioned schemas, transactional writes, migration history, activation parity checks, and fail-closed startup.
- Parameterized persistence queries and compiler-generated, validated analytics SQL.
- Bounded request schemas, upload limits, rate limiting, and safe public errors.
- De-identified, bounded cloud query evidence and explicit query consent UI.
- Deterministic import identities and Health Connect provenance retention.
- Clear wellness/non-diagnostic product language.
- AGPL licensing, disclosure policy, contribution guidance, and pinned CI Actions.

## Recommended release sequence

1. **Restore a trustworthy baseline:** repair dependency metadata and get clean install, typecheck, build, tests, and audit green.
2. **Close security blockers:** companion allowlist, central cloud-consent enforcement, AI endpoint/key hardening, and regression tests.
3. **Close privacy blockers:** authoritative data inventory, least-privilege defaults, public policy, in-app rationale/link, Data Safety, and Health Connect declarations.
4. **Protect user data:** explicit retention diagnostics plus current encrypted backup/restore and corruption drills.
5. **Prove the desktop artifact:** signed Windows installer, Windows CI/package smoke tests, firewall behavior, upgrade/uninstall, realistic data soak, and release evidence.
6. **Prove the Android artifact:** automated sync/pinning tests, authenticated pinned profile discovery, physical-device test matrix, internal Play track, and staged rollout.
7. **Finish quality verification:** WCAG audit, typed API errors/contracts, documentation reconciliation, and dependency-exception review.

## Launch decision

Do not ship this revision to external users. After the P0 items are fixed and all clean-install gates pass, a small, informed Windows x64 and Android internal alpha is reasonable. A public desktop release should additionally require backup/restore, signed artifact validation, realistic scale testing, and documentation correction. Play Store submission should wait until the privacy artifacts, least-privilege permission flow, security fixes, native test coverage, and internal-track evidence are complete.
