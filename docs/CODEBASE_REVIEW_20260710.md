# Codebase and Release-Readiness Review

**Originally reviewed:** 2026-07-10
**Revalidated against current `main`:** 2026-07-11
**Scope:** Web app, API, shared package, Android companion, repository/release setup
**Goal:** Prepare an open-source web app and paid Play Store companion for use beyond the current single-user prototype

## Current summary

The codebase has materially improved since the original review. LAN access is now protected by owner and companion authentication, QR pairing, TLS, certificate public-key pinning, body limits, and rate limits. Store and warehouse replacement are crash-safe, tests and CI have been added, the legacy Samsung import paths were removed, and runtime font loading and Android dependency issues were resolved.

The remaining release blockers are accurate cloud-model consent/privacy behavior, Android Health Connect and Play Store disclosures, a complete Android production release process, and an open-source license. The product remains local-first and single-user; its file-based canonical store is not yet prepared for larger data volumes or schema evolution.

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

#### [DONE] P0 — LAN API authentication and authorization

All `/api` requests now pass through centralized authentication in `apps/api/src/createApp.ts`. Owner credentials protect browser and administration routes; scoped, revocable companion tokens protect Health Connect imports. Pairing uses short-lived codes and polling secrets (`apps/api/src/pairing.ts`), while request body limits and route rate limits are applied centrally.

#### [DONE] P0 — Health Connect transport protection

Production and preview builds disable cleartext traffic (`apps/android-companion/eas.json`), production sync requires HTTPS and a paired token (`src/syncHealthConnect.ts`), and QR pairing pins the server public-key fingerprint (`src/PairScreen.tsx`, `src/pinnedFetch.ts`). The development profile intentionally retains cleartext only for local development.

#### [IN PROGRESS] P0 — Privacy claims and cloud-model consent

The README now acknowledges the cloud-model exception, but it still claims transmitted data is “always anonymized.” Model prompts can contain health-derived query rows, and there is no explicit, informed opt-in gate before cloud processing (`apps/api/src/createApp.ts`).

**Remaining work:** Correct the claim, explicitly show provider/data scope in-product, require informed opt-in for cloud processing, minimize prompt data, and document provider retention and responsibilities. Default to local processing.

#### [DONE] P1 — Samsung JSON endpoint can traverse arbitrary local directories

The Samsung JSON upload-path implementation and legacy Samsung import routes have been removed from `apps/api/src`.

#### [DONE] P1 — External font request conflicts with the local-only trust message

`apps/web/src/styles.css` now uses local/system font stacks and no longer imports fonts at runtime.

#### [IN PROGRESS] P2 — At-rest protections and raw-payload handling

Encrypted-store writes now use temporary files, validation, backup/recovery, `fsync`, atomic rename, and restrictive file permissions (`apps/api/src/store.ts`). The key and encrypted store remain colocated, however, and raw imports are silently truncated above the configured size.

**Remaining work:** Document the local-account threat model, make raw-payload retention configurable, and expose truncation/import diagnostics to users.

#### [OPEN] P2 — Error and health responses expose unnecessary internals

Development error responses still include stack traces, `/api/health` exposes model runtime information, and errors lack stable public codes and correlation IDs (`apps/api/src/createApp.ts`).

**Recommendation:** Return minimal public errors, log sanitized diagnostic details locally with correlation IDs, and limit health responses to liveness/readiness data.

### Data integrity, reliability, and performance

#### [DONE] P0 — Persistence and warehouse replacement are crash-safe

The encrypted store is atomically persisted with a recoverable backup (`apps/api/src/store.ts`). DuckDB is rebuilt into a temporary database, validated, swapped atomically, and restored from backup if the swap fails (`apps/api/src/warehouse.ts`).

#### [OPEN] P1 — Persisted data has no application schema migration strategy

`HealthStoreData` has no application schema version, and decrypted JSON is cast into the current TypeScript shape without runtime validation (`packages/shared/src/types.ts`, `apps/api/src/store.ts`).

**Recommendation:** Add a versioned runtime schema, sequential migrations, startup validation, backup-before-migrate, and actionable recovery diagnostics before establishing a public data format.

#### [OPEN] P1 — Full-store rewrites and warehouse rebuilds will not scale well

Mutations still serialize and encrypt the full store, key derivation remains synchronous, normal web startup fetches the full store, and imports synchronously rebuild the warehouse (`apps/api/src/store.ts`, `apps/web/src/App.tsx`, `apps/api/src/createApp.ts`).

**Recommendation:** Cache or asynchronously derive the key, serialize mutations, stop returning the full store to normal UI paths, rebuild DuckDB in the background with atomic swap, and select a transactional canonical store before substantial growth.

#### [OPEN] P1 — Store retention contains correctness and growth issues

Insights and audit events remain unbounded, and lab-marker retention still sorts by hashed ID rather than collection time (`apps/api/src/store.ts`).

**Recommendation:** Define explicit retention policies, retain health data predictably without silent loss, fix chronological lab-marker eviction, cap non-clinical history separately, and surface retention/import diagnostics.

#### [OPEN] P2 — Health and query operations do avoidable work

The health endpoint still computes full analytics; each warehouse query opens a new database/connection; and overlapping legacy query paths do not all share one SQL validation/execution boundary (`apps/api/src/createApp.ts`, `apps/api/src/warehouse.ts`).

**Recommendation:** Make liveness O(1), consolidate query contracts, explicitly mark experimental paths, and route all executable SQL through one validation and execution boundary.

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

#### [OPEN] P1 — Denying one optional permission prevents all sync

Any missing requested permission aborts the complete sync (`apps/android-companion/src/syncHealthConnect.ts`).

**Recommendation:** Sync granted categories, clearly report omissions, and let users select and change categories later.

#### [IN PROGRESS] P1 — Sync is inefficient and loses useful provenance

A persistent device identifier exists, but every sync still rereads and accumulates the previous 30 days, the upload label remains static, and incremental cursors/chunking/provider provenance are absent (`apps/android-companion/src/endpointStore.ts`, `src/syncHealthConnect.ts`).

**Remaining work:** Persist a per-device sync cursor with overlap, chunk uploads, preserve provider record/origin metadata, and map all supported exercise fields.

#### [IN PROGRESS] P1 — Endpoint pairing and resilient networking are incomplete

Free-form endpoint configuration has been replaced with QR pairing, HTTPS enforcement, server identity pinning, and explicit unpairing. Profile refresh still uses an unpinned and unauthenticated fetch, and the app has no consistent timeout, cancellation, or retry policy for all network operations (`apps/android-companion/App.tsx`).

**Remaining work:** Route profile requests through the authenticated pinned client and establish bounded timeout, cancellation, and retry behavior.

#### [DONE] P2 — Dependency setup needs cleanup

`eas-cli` is no longer a runtime dependency and is invoked at a pinned version for the preview build. The Health Connect package roles are now separated between the Expo plugin and the runtime library.

### Web design and accessibility

#### [OPEN] P1 — Core interactive semantics are incomplete

The clickable summary button is still overridden with `role="row"`, tablists lack complete tab semantics, and lab inputs still rely on placeholders rather than programmatic labels (`apps/web/src/App.tsx`).

**Recommendation:** Complete a semantic HTML/ARIA pass and test with keyboard navigation plus a screen reader.

#### [OPEN] P1 — Dialog and destructive-action focus management is insufficient

The profile dialogs do not fully move, trap, and restore focus or handle Escape consistently; destructive actions still use `window.confirm` (`apps/web/src/App.tsx`).

**Recommendation:** Implement shared accessible dialog/alert-dialog primitives with focus management, Escape handling, and explicit destructive scope/count.

#### [IN PROGRESS] P1 — Dynamic status and errors are not consistently announced

One status region was added, but global notices/page errors and the Android status card remain without consistent live-region semantics (`apps/web/src/App.tsx`, `apps/android-companion/App.tsx`).

**Remaining work:** Standardize status, alert, loading, and empty-state announcements across both apps.

#### [IN PROGRESS] P2 — Several visual elements lack equivalent context

The detail chart now has a dynamic label, but the density bar lacks progress semantics and sparklines still use generic labels (`apps/web/src/App.tsx`).

**Remaining work:** Add semantic equivalents and complete automated axe/manual WCAG AA checks at desktop and narrow breakpoints.

#### [OPEN] P2 — Web architecture makes design changes risky

`apps/web/src/App.tsx` has grown to more than 2,300 lines and `styles.css` exceeds 1,500 lines. Routing, state, dialogs, API actions, and page rendering remain tightly coupled.

**Recommendation:** Split by route/feature, add shared UI primitives and feature-level state hooks/reducers, and keep API response mapping outside presentation components.

### Maintainability and engineering quality

#### [DONE] P0 — Automated tests now cover core risk areas

Vitest coverage now includes store persistence/recovery, parsers, Health Connect mapping, query compilation and validation, security, warehouse rebuilds, and web behavior (`apps/api/src/__tests__`, `packages/shared/src/__tests__`, `apps/web/src/__tests__`).

#### [DONE] P0 — CI quality gates exist

`.github/workflows/ci.yml` runs workspace typechecking/building, Android typechecking, tests, dependency audit, and pull-request dependency review with pinned Actions.

#### [IN PROGRESS] P1 — API composition remains monolithic

Startup/runtime concerns were separated into `apps/api/src/server.ts` and an application factory was introduced, but `apps/api/src/createApp.ts` remains a large route, orchestration, policy, and response-shaping module.

**Remaining work:** Split route modules, domain services, repositories, and infrastructure adapters while retaining centralized auth, error, and logging policy.

#### [OPEN] P2 — Observability and operations are minimal

Startup logging exists, but there are no request IDs, structured/sanitized error logs, operation timing, or graceful shutdown behavior (`apps/api/src/server.ts`).

**Recommendation:** Add local structured logs with PHI redaction, correlation IDs, operation timing, startup validation, and graceful shutdown. Do not log request bodies or model prompts.

#### [OPEN] P2 — Environment and API documentation are fragile

There is no `.env.example`; environment parsing remains hand-written in `apps/api/src/server.ts`; examples are mostly PowerShell-only; and API lifecycle/versioning remains undocumented.

**Recommendation:** Document supported platforms/configuration, validate environment at startup, provide cross-platform examples, and publish a versioned companion API contract.

### Open-source and product readiness

#### [OPEN] P0 — The repository has no open-source license

No root `LICENSE` exists. Publishing source without one does not grant permission to use, modify, or redistribute it.

**Recommendation:** Choose a license intentionally, add SPDX/package metadata where appropriate, and complete a third-party license review.

#### [OPEN] P1 — Community and security documentation are missing

There is no `SECURITY.md`, `CONTRIBUTING.md`, code of conduct, support policy, release policy, or vulnerability-reporting process.

**Recommendation:** Add these before publicizing the repository, including supported versions, responsible disclosure, privacy threat model, backup/recovery guidance, and non-medical-use boundaries.

#### [OPEN] P2 — Product boundaries and deprecations need explicit decisions

Four overlapping query endpoints remain without lifecycle/deprecation annotations (`apps/api/src/createApp.ts`).

**Recommendation:** Mark endpoints and features as supported, experimental, or deprecated, then consolidate or retire prototype paths with a migration/export story.

## Pending implementation order

### P0 — Release blockers

1. **Cloud-model privacy and consent:** Correct the privacy claim; add explicit cloud opt-in, provider/data-scope disclosure, and prompt minimization.
2. **Health Connect and Play privacy readiness:** Add category rationale and selection, privacy-policy flow, data inventory/retention/deletion language, and Play declarations.
3. **Android production release process:** Document and validate AAB, signing, versioning, production environment, and submission/release checklist.
4. **Open-source license:** Choose and add a license plus applicable metadata/notices.

### P1 — Stable public release

1. **Selective, resilient Health Connect sync:** Allow partial permissions, add cursors/chunking/provenance, and use authenticated pinned networking for every companion request.
2. **Persisted-data durability at scale:** Add runtime schema migrations, correct retention policies, and reduce whole-store transfers/rebuild work.
3. **Web accessibility core flows:** Fix interaction semantics, accessible dialogs/destructive confirmations, and comprehensive live announcements.
4. **API and project stewardship:** Split the API route monolith and add security, contribution, support, and release documentation.

### P2 — Hardening and sustainable development

1. **Safe operations and diagnostics:** Minimize public errors/health data and add redacted structured observability with correlation IDs.
2. **Data/query efficiency:** Make health checks lightweight, consolidate SQL execution/validation, and use cryptographic import checksums.
3. **Documentation and lifecycle:** Add environment/API documentation and make endpoint support/deprecation decisions.
4. **Accessibility and frontend maintainability:** Complete visual WCAG equivalents and reduce the web application's coupling.

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
