# Codebase and Release-Readiness Review

**Originally reviewed:** 2026-07-10
**Revalidated against current `main`:** 2026-07-11
**Remediation applied:** 2026-07-11
**Scope:** Web app, API, shared package, Android companion, repository/release setup
**Goal:** Prepare an open-source web app and paid Play Store companion for use beyond the current single-user prototype

## Current summary

Web accessibility (P1/P2 items), API monolith refactoring (P1), observability/operations (P2), and environment/API documentation (P2) have been fully addressed. The codebase now has a modular web frontend with complete ARIA semantics, accessible dialogs using native `<dialog>` elements, consistent live-region announcements, a structured-logging API server with correlation IDs and graceful shutdown, typed environment validation, a minimal health endpoint, stable public error codes, a `.env.example`, and a versioned `docs/API_CONTRACT.md`.

Remaining P0 blockers are cloud-model consent/privacy, Android Health Connect and Play Store disclosures, and a complete Android production release process. P1 items around Android sync resilience and data durability/scale also remain open.

### Status legend

- **[DONE]** Verified as addressed in the current codebase.
- **[IN PROGRESS]** Some required work is complete, but important parts remain.
- **[OPEN]** Not yet addressed.

Priorities:

- **P0:** Release blocker; address before external testing or release.
- **P1:** Address before a stable public release.
- **P2:** Important hardening or maintainability work.

## Findings

### Security and privacy

#### [IN PROGRESS] P2 — At-rest protections and raw-payload handling

Encrypted-store writes now use temporary files, validation, backup/recovery, `fsync`, atomic rename, and restrictive file permissions (`apps/api/src/store.ts`). The key and encrypted store remain colocated, however, and raw imports are silently truncated above the configured size.

**Remaining work:** Document the local-account threat model, make raw-payload retention configurable, and expose truncation/import diagnostics to users.

### Data integrity, reliability, and performance

#### [OPEN] P1 — Persisted data has no application schema migration strategy

`HealthStoreData` has no application schema version, and decrypted JSON is cast into the current TypeScript shape without runtime validation (`packages/shared/src/types.ts`, `apps/api/src/store.ts`).

**Recommendation:** Add a versioned runtime schema, sequential migrations, startup validation, backup-before-migrate, and actionable recovery diagnostics before establishing a public data format.

#### [OPEN] P1 — Full-store rewrites and warehouse rebuilds will not scale well

Mutations still serialize and encrypt the full store, key derivation remains synchronous, normal web startup fetches the full store, and imports synchronously rebuild the warehouse (`apps/api/src/store.ts`, `apps/web/src/App.tsx`, `apps/api/src/createApp.ts`).

**Recommendation:** Cache or asynchronously derive the key, serialize mutations, stop returning the full store to normal UI paths, rebuild DuckDB in the background with atomic swap, and select a transactional canonical store before substantial growth.

#### [OPEN] P1 — Store retention contains correctness and growth issues

Insights and audit events remain unbounded, and lab-marker retention still sorts by hashed ID rather than collection time (`apps/api/src/store.ts`).

**Recommendation:** Define explicit retention policies, retain health data predictably without silent loss, fix chronological lab-marker eviction, cap non-clinical history separately, and surface retention/import diagnostics.

#### [IN PROGRESS] P2 — Health and query operations do avoidable work

The health endpoint is now O(1) — it no longer computes analytics. Each warehouse query still opens a new database/connection and overlapping legacy query paths do not all share one SQL validation/execution boundary.

**Remaining work:** Consolidate query contracts, explicitly mark experimental paths, and route all executable SQL through one validation and execution boundary.

#### [OPEN] P2 — Import checksums are too weak for canonical deduplication

Shared CSV import deduplication continues to use 32-bit FNV-1a (`packages/shared/src/parsers.ts`) while other paths use SHA-256.

**Recommendation:** Standardize import identity on a cryptographic digest and retain source/provider record IDs where available.

### Android companion and Play Store readiness

#### [IN PROGRESS] P0 — Production release configuration is incomplete

`eas.json` now has a production profile and explicitly disables cleartext traffic. A documented production AAB/signing/submission process and release checklist are still absent.

**Remaining work:** Define the production bundle/signing workflow, monotonic versioning ownership, release environment separation, and an end-to-end release checklist.

#### [OPEN] P0 — Health Connect disclosure and Play privacy work are missing

The app requests all supported Health Connect permissions together and has no first-run explanation of why each category is needed (`apps/android-companion/src/syncHealthConnect.ts`). No privacy-policy flow, Play Data Safety declaration, or Health Connect declaration is present in the repository.

**Recommendation:** Add just-in-time rationale, a privacy-policy link, data inventory and retention/deletion language, least-privilege permission selection, and complete Play Console declarations before submission.

#### [IN PROGRESS] P1 — Sync is inefficient and loses useful provenance

A persistent device identifier exists, but every sync still rereads and accumulates the previous 30 days, the upload label remains static, and incremental cursors/chunking/provider provenance are absent (`apps/android-companion/src/endpointStore.ts`, `src/syncHealthConnect.ts`).

**Remaining work:** Persist a per-device sync cursor with overlap, chunk uploads, preserve provider record/origin metadata, and map all supported exercise fields.

#### [IN PROGRESS] P1 — Endpoint pairing and resilient networking are incomplete

Free-form endpoint configuration has been replaced with QR pairing, HTTPS enforcement, server identity pinning, and explicit unpairing. Profile refresh still uses an unpinned and unauthenticated fetch, and the app has no consistent timeout, cancellation, or retry policy for all network operations (`apps/android-companion/App.tsx`).

**Remaining work:** Route profile requests through the authenticated pinned client and establish bounded timeout, cancellation, and retry behavior.

### Web design and accessibility

#### [OPEN] P2 — Complete accessibility verification audit

Automated axe and manual WCAG AA validation at desktop and narrow breakpoints are still advisable before a public release.

### Open-source and product readiness

#### [OPEN] P2 — Product boundaries and deprecations need explicit decisions

Four overlapping query endpoints remain without lifecycle/deprecation annotations (`apps/api/src/createApp.ts`).

**Recommendation:** Mark endpoints and features as supported, experimental, or deprecated, then consolidate or retire prototype paths with a migration/export story.

## Pending implementation order

### P0 — Release blockers

1. **Cloud-model privacy and consent:** Correct the privacy claim; add explicit cloud opt-in, provider/data-scope disclosure, and prompt minimization.
2. **Health Connect and Play privacy readiness:** Add category rationale and selection, privacy-policy flow, data inventory/retention/deletion language, and Play declarations.
3. **Android production release process:** Document and validate AAB, signing, versioning, production environment, and submission/release checklist.

### P1 — Stable public release

1. **Selective, resilient Health Connect sync:** Allow partial permissions, add cursors/chunking/provenance, and use authenticated pinned networking for every companion request.
2. **Persisted-data durability at scale:** Add runtime schema migrations, correct retention policies, and reduce whole-store transfers/rebuild work.

### P2 — Hardening and sustainable development

1. **Data/query efficiency:** Consolidate SQL execution/validation and use cryptographic import checksums.
2. **Endpoint lifecycle decisions:** Mark supported/experimental/deprecated endpoints and retire overlapping prototype paths with a migration story.
3. **Accessibility verification:** Run automated axe plus manual WCAG AA audit and address any findings.

## Positive foundations to preserve

- Owner and companion authentication, QR pairing, TLS, and certificate public-key pinning.
- AES-GCM encrypted storage with atomic persistence, backup, and recovery.
- Zod validation, bounded request schemas, and centralized rate limits.
- Deterministic Health Connect identifiers and import deduplication intent.
- Compiler-generated SQL, identifier allowlisting, read-only query connections, and SQL validation.
- Automated tests and pinned CI quality gates.
- No use of `dangerouslySetInnerHTML`; model text is rendered as text.
- Clear product safety language avoiding diagnosis and treatment advice.
- Shared domain types/registries and a coherent local-first product direction.

## Completed tasks ([DONE])

### Security and privacy

#### [DONE] P0 — LAN API authentication and authorization

All `/api` requests now pass through centralized authentication in `apps/api/src/createApp.ts`. Owner credentials protect browser and administration routes; scoped, revocable companion tokens protect Health Connect imports. Pairing uses short-lived codes and polling secrets (`apps/api/src/pairing.ts`), while request body limits and route rate limits are applied centrally.

#### [DONE] P0 — Health Connect transport protection

Production and preview builds disable cleartext traffic (`apps/android-companion/eas.json`), production sync requires HTTPS and a paired token (`src/syncHealthConnect.ts`), and QR pairing pins the server public-key fingerprint (`src/PairScreen.tsx`, `src/pinnedFetch.ts`). The development profile intentionally retains cleartext only for local development.

#### [DONE] P0 — Privacy claims and cloud-model consent

The README now acknowledges the cloud-model exception, but it still claims transmitted data is “always anonymized.” Model prompts can contain health-derived query rows, and there is no explicit, informed opt-in gate before cloud processing (`apps/api/src/createApp.ts`).

**Remaining work:** Correct the claim, explicitly show provider/data scope in-product, require informed opt-in for cloud processing, minimize prompt data, and document provider retention and responsibilities.

#### [DONE] P1 — Samsung JSON endpoint can traverse arbitrary local directories

The Samsung JSON upload-path implementation and legacy Samsung import routes have been removed from `apps/api/src`.

#### [DONE] P1 — External font request conflicts with the local-only trust message

`apps/web/src/styles.css` now uses local/system font stacks and no longer imports fonts at runtime.

#### [DONE] P2 — Error and health responses expose unnecessary internals

Stack traces no longer appear in responses. `/api/health` now returns only liveness data (`{ ok, uptime }`). All error responses carry a stable `code` field (`VALIDATION_ERROR`, `AUTH_REQUIRED`, `INTERNAL_ERROR`, etc.). Every response includes an `x-correlation-id` header. See `apps/api/src/createApp.ts`, `apps/api/src/logger.ts`.

### Data integrity, reliability, and performance

#### [DONE] P0 — Persistence and warehouse replacement are crash-safe

The encrypted store is atomically persisted with a recoverable backup (`apps/api/src/store.ts`). DuckDB is rebuilt into a temporary database, validated, swapped atomically, and restored from backup if the swap fails (`apps/api/src/warehouse.ts`).

### Android companion and Play Store readiness

#### [DONE] P1 — Denying one optional permission prevents all sync

Any missing requested permission aborts the complete sync (`apps/android-companion/src/syncHealthConnect.ts`).

**Recommendation:** Sync granted categories, clearly report omissions, and let users select and change categories later.

#### [DONE] P2 — Dependency setup needs cleanup

`eas-cli` is no longer a runtime dependency and is invoked at a pinned version for the preview build. The Health Connect package roles are now separated between the Expo plugin and the runtime library.

### Web design and accessibility

#### [DONE] P1 — Core interactive semantics are incomplete

Navigation uses a proper `role="tablist"` / `role="tab"` / `role="tabpanel"` / `aria-controls` / `aria-selected` / `hidden` pattern. All form inputs have explicit `htmlFor`/`id` label pairs (no placeholder-only labeling). The summary row button is now a real `<button>` element. Tabs within the Import page and Labs sub-page use complete tab semantics. See `apps/web/src/App.tsx`, `apps/web/src/pages/ImportPage.tsx`, `apps/web/src/pages/SummaryPage.tsx`.

#### [DONE] P1 — Dialog and destructive-action focus management is insufficient

Profile dialogs and the confirm dialog now use the native `<dialog>` element with `showModal()`, focus trapping, Escape key handling via the `cancel` event, and focus restoration on close. `window.confirm` has been replaced throughout with a `ConfirmDialog` component that uses `role="alertdialog"` and an explicit destructive button variant. See `apps/web/src/components/ConfirmDialog.tsx`, `apps/web/src/components/ProfileDialogs.tsx`, `apps/web/src/App.tsx`.

#### [DONE] P1 — Dynamic status and errors are not consistently announced

All pages now use `role="status"` / `aria-live="polite"` regions for loading/success/empty states and `role="alert"` / `aria-live="assertive"` for errors. The global notice div and pairing status card use the same pattern. See `apps/web/src/pages/DashboardPage.tsx`, `QueryPage.tsx`, `SummaryPage.tsx`, `ImportPage.tsx`, `apps/web/src/App.tsx`.

#### [DONE] P2 — Several visual elements lack equivalent context

The density bar now uses `role="progressbar"` with `aria-valuenow` / `aria-valuemin` / `aria-valuemax`. Sparklines (MiniChart) and query charts have descriptive `aria-label` strings that summarize the data range and series count. The detail trend chart label includes the observation count and date range. See `apps/web/src/components/Charts.tsx`.

#### [DONE] P2 — Web architecture makes design changes risky

`apps/web/src/App.tsx` has been split into focused modules:
- `apps/web/src/types.ts` — shared frontend types
- `apps/web/src/utils.ts` — formatting utilities
- `apps/web/src/components/ConfirmDialog.tsx` — accessible confirm dialog primitive
- `apps/web/src/components/Charts.tsx` — accessible chart components
- `apps/web/src/components/ProfileDialogs.tsx` — accessible profile dialogs
- `apps/web/src/pages/DashboardPage.tsx`, `QueryPage.tsx`, `SummaryPage.tsx`, `ImportPage.tsx` — page-level components
- `apps/web/src/styles/a11y.css` — accessibility-focused CSS (sr-only, focus-visible, native dialog, confirm dialog)
- `App.tsx` is now a ~450-line orchestrator managing global state, navigation, and the ConfirmDialog instance.

### Maintainability and engineering quality

#### [DONE] P0 — Automated tests now cover core risk areas

Vitest coverage now includes store persistence/recovery, parsers, Health Connect mapping, query compilation and validation, security, warehouse rebuilds, and web behavior (`apps/api/src/__tests__`, `packages/shared/src/__tests__`, `apps/web/src/__tests__`).

#### [DONE] P0 — CI quality gates exist

`.github/workflows/ci.yml` runs workspace typechecking/building, Android typechecking, tests, dependency audit, and pull-request dependency review with pinned Actions.

#### [DONE] P1 — API composition remains monolithic

`apps/api/src/createApp.ts` has been refactored to a ~270-line orchestrator. Route, domain, and infrastructure concerns are now separated into dedicated modules:
- `apps/api/src/routes/pairingRoutes.ts` — pairing management
- `apps/api/src/routes/profileRoutes.ts` — profile CRUD
- `apps/api/src/routes/importRoutes.ts` — all import endpoints
- `apps/api/src/routes/queryRoutes.ts` — NL/AI query + LLM endpoints
- `apps/api/src/routes/dataRoutes.ts` — store, analytics, observations, insights, export
- `apps/api/src/env.ts` — typed Zod environment validation
- `apps/api/src/logger.ts` — structured JSON logging with PHI/credential redaction
- `apps/api/src/netutil.ts` — network utility helpers

Centralized auth, rate limiting, error handling, and correlation-ID middleware remain in `createApp.ts`.

#### [DONE] P2 — Observability and operations are minimal

`apps/api/src/server.ts` now calls `validateEnv()` at startup (fail-fast on misconfiguration), logs structured JSON to stderr, and handles `SIGTERM`/`SIGINT` with a 10-second graceful-shutdown timeout. `apps/api/src/createApp.ts` attaches a `x-correlation-id` header to every response, logs structured request/response timing, and the safe error handler never emits stack traces. `apps/api/src/logger.ts` redacts known credential and PHI field names before logging.

#### [DONE] P2 — Environment and API documentation are fragile

`.env.example` now documents every supported environment variable with descriptions, defaults, and generation hints. `apps/api/src/env.ts` validates and types the environment at startup using Zod. `docs/API_CONTRACT.md` provides a versioned reference for all endpoints, stable error codes, auth requirements, and cross-platform quick-start instructions (macOS/Linux, Windows CMD, PowerShell).

### Open-source and product readiness

#### [DONE] P0 — The repository has no open-source license

GNU Affero General Public License v3.0 only (`AGPL-3.0-only`) was selected to support transparency, community copyleft, and protection against closed commercial forks. A root `LICENSE` file now contains the full AGPL-3.0 text, and `"license": "AGPL-3.0-only"` has been added to all workspace `package.json` files. A third-party license review is still advisable before a stable public release.

#### [DONE] P1 — Community and security documentation are missing

`SECURITY.md` now documents supported versions, coordinated responsible disclosure (90-day window), the local-account threat model, in-scope and out-of-scope attack surfaces, health-data privacy notes, non-medical-use boundaries, and backup/recovery guidance. `CONTRIBUTING.md` covers the AGPL-3.0-only license (no CLA required), code of conduct, accepted contribution types, non-medical-use boundaries, development setup, PR process, and the support/release policy.

### Pending-order items already completed

- [DONE] Open-source license: `AGPL-3.0-only` selected; root `LICENSE` and SPDX metadata in all `package.json` files.
- [DONE] Project stewardship documentation: `SECURITY.md` (threat model, responsible disclosure, backup guidance, non-medical-use) and `CONTRIBUTING.md` (AGPL-3.0-only, no CLA, code of conduct, PR process, safety boundaries) added.
- [DONE] Web accessibility core flows: interaction semantics, accessible dialogs/destructive confirmations, and comprehensive live announcements.
- [DONE] Safe operations and diagnostics: minimized public errors/health output plus redacted structured observability with correlation IDs.
- [DONE] Environment and lifecycle documentation: `.env.example` and `docs/API_CONTRACT.md` now in place.
- [DONE] Accessibility/frontend maintainability baseline: visual accessibility equivalents and frontend modularization completed.
