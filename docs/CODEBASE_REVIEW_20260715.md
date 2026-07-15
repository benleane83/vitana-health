# Codebase Complexity and Technical-Debt Review

**Reviewed:** 2026-07-15  
**Revision:** `7e5b2ada5ade`  
**Previous reviews:** [`CODEBASE_REVIEW_20260710.md`](CODEBASE_REVIEW_20260710.md), [`CODEBASE_REVIEW_20260713.md`](CODEBASE_REVIEW_20260713.md)  
**Scope:** Product documentation, web app, API, encrypted storage, desktop host, Android companion, shared package, tests, CI, and release support

## Executive assessment

The codebase has a sound overall shape: workspace boundaries are clear, shared domain types flow in one direction, input validation is extensive, security-sensitive code is generally deliberate, and the canonical encrypted DuckDB design is a better foundation than the earlier JSON-plus-warehouse arrangement.

The main maintainability problem is **concentrated and transitional complexity**, not excessive layering. Several large files now carry the history of successive features and storage migrations:

- `apps/api/src/storage/duckdbRepository.ts` — 1,690 lines
- `apps/api/src/store.ts` — 1,326 lines
- `apps/web/src/App.tsx` — 1,303 lines
- `packages/shared/src/registry.ts` — 1,236 lines, mostly declarative data
- `packages/shared/src/parsers.ts` — 1,026 lines
- `apps/web/src/pages/ImportPage.tsx` — 969 lines
- `apps/android-companion/src/syncHealthConnect.ts` — 730 lines

The first three files alone contain 4,319 lines and coordinate most application behavior. This is where feature growth is most likely to create regressions.

The highest-value simplification is to **finish removing superseded architecture before introducing new abstractions**. The repository still contains a complete JSON store, a complete derived warehouse implementation, compatibility adapters, experimental endpoints, and client methods that normal product flows no longer use. Removing or isolating these paths would reduce more risk than adding a state library, generic repository framework, or speculative cross-platform sync provider.

One security issue from the previous review remains a release blocker: companion authorization is still implemented as a short owner-only denylist rather than a companion capability allowlist.

## Review method and validation

The review traced product requirements, prior findings, route authorization, storage activation and persistence, API contracts, web state flow, Android sync, shared schemas/parsers, test configuration, and release documentation. It also inventoried 111 source files and 24 test files, totaling approximately 23,725 lines across application, package, script, and test sources.

Existing validation was attempted without installing dependencies:

| Command | Result |
| --- | --- |
| `npm run typecheck` | Could not run: local dependencies such as `zod` and `@noble/hashes` are not installed |
| `npm run build` | Could not run for the same reason |
| `npm test` | Could not run: `vitest` is not installed |
| `npm run audit:ci` | Passed; the configured DuckDB transitive allowlist remains in effect |

These failures describe the review environment, not confirmed repository defects. No dependency installation or clean-install verification was performed.

## Positive foundations to preserve

- The product boundary is coherent: local-first storage, local-network operation, no telemetry, guarded optional cloud-model use, and non-diagnostic language (`PRODUCT.md:7-29`, `.github/copilot-instructions.md:1-15`).
- Workspace dependencies point inward toward `@local-fitness-advisor/shared`; the web and Android apps do not directly depend on API implementation details.
- `ProfileRepository` already provides a useful persistence boundary for profile-level operations (`apps/api/src/storage/profileRepository.ts:31-46`).
- DuckDB writes are transactional, the encrypted extension is pinned and verified, and profile activation includes parity checks (`apps/api/src/store.ts:480-570`).
- Normal web startup uses the bounded `/api/bootstrap` projection rather than loading the complete store (`apps/api/src/routes/dataRoutes.ts:90-96`, `apps/web/src/App.tsx:277-289`).
- The AI query path uses a validated DSL, compiler-generated SQL, identifier restrictions, and bounded prompt evidence (`apps/api/src/routes/queryRoutes.ts:112-229`).
- Android defaults to no selected Health Connect categories and a 30-day window, and sync includes pinning, cursors, pagination, chunking, retries, and provenance (`apps/android-companion/src/endpointStore.ts:9-38`, `apps/android-companion/src/syncHealthConnect.ts`).
- Runtime schemas, request validation, tests around storage/security, and accessible web semantics are all substantially stronger than a typical prototype at this stage.

## Priority findings

### [DONE] P0 — Replace companion authorization denylisting with explicit capabilities

The central API middleware allows any valid companion token to access every authenticated route except a short owner-only list (`apps/api/src/createApp.ts:46-55,239-258`). The feature routers are then mounted without distinguishing credential type (`apps/api/src/createApp.ts:260-275`).

This keeps the previous review's highest-risk finding open. A companion can still reach complete-store reads, exports, profile mutation, observation mutation, analytics/query routes, and other endpoints not explicitly denied. The test suite currently codifies access to `/api/store` (`apps/api/src/__tests__/server.test.ts:310-314`).

This is also unnecessary complexity: each new route must be remembered in a security denylist. Make owner access the default and grant companions only the minimum named capabilities required for:

1. retrieving a deliberately minimal profile list;
2. submitting Health Connect imports for an allowed profile;
3. pairing status and token lifecycle operations required by the phone.

Bind the token to its device and permitted profile set. Add negative tests for every owner-only route family. This produces a smaller and safer authorization model than continuing to expand `isOwnerOnlyPath`.

### [DONE] P1 — Complete the storage migration and remove superseded runtime paths

The current storage design contains three overlapping eras:

1. `HealthStore`, a complete encrypted JSON implementation with retention, analytics, mutation, backup, and migration behavior (`apps/api/src/store.ts:117-396`);
2. `DuckDbHealthStore`, a serialization adapter over `ProfileRepository` (`apps/api/src/storage/duckdbHealthStore.ts:27-146`);
3. `DuckDbRepository`, the canonical database implementation (`apps/api/src/storage/duckdbRepository.ts`).

`ProfileStoreManager` branches repeatedly on `"json" | "duckdb"` and concrete `instanceof DuckDbHealthStore` checks (`apps/api/src/store.ts:443-477,606-714`). JSON remains necessary for one-time local-profile conversion, but it no longer needs to remain a peer runtime backend after migration.

There is also a separate 459-line plaintext warehouse implementation in `apps/api/src/warehouse.ts`. Production analytics now query the encrypted profile directly through `storage/analyticsBackend.ts`; `rebuildWarehouseFromStore` is referenced only by warehouse tests. The `/api/warehouse/rebuild` endpoint now returns metadata through `refreshAnalyticsStorage` and does not call the old rebuild implementation (`apps/api/src/routes/dataRoutes.ts:177-185`, `apps/api/src/storage/analyticsBackend.ts:17-35`).

Recommended simplification:

- extract the encrypted-JSON reader needed for one-time migration into a narrow migration module;
- verify and migrate the developer's retained local profiles;
- remove JSON as an active `HealthStoreHandle` backend and delete branches that can no longer execute;
- remove the detached warehouse implementation and its obsolete tests;
- rename `refreshAnalyticsStorage`, which now only formats counts, to reflect what it does;
- update README sections that still describe explicit JSON fallback and warehouse rebuilding (`README.md:196-206`).

This is the largest safe deletion opportunity in the repository and aligns with the stated lack of public backward-compatibility requirements.

### [DONE] P1 — Decompose web orchestration by feature, without adding a state framework

Implemented on 2026-07-15 without adding a state framework or global context. `App.tsx` is now 411 lines with seven local state hooks limited to routing, the profile menu, top-level notices, and confirmation state. `ImportPage` now composes feature-owned manual, CSV, scan, and pairing workflows through eight runtime props rather than receiving each workflow's state and setters.

Profile bootstrap, analytics, profile-list, and active-profile responses are committed as one lifecycle snapshot. Dashboard, Track, Insights, and Export own their remote data and mutation state; repeated busy/error/data transitions use cohesive state objects, and Track mutations share one post-mutation refresh path.

`App.tsx` is again 1,303 lines despite the earlier page extraction. It contains roughly 49 `useState` calls covering navigation, profiles, imports, body-composition parsing, summary/detail views, AI, export, consent, pairing, and dialogs (`apps/web/src/App.tsx:41-104`). It also owns loading, mutation, and refresh behavior for every page.

`ImportPage` accepts 38 runtime props plus their inline type declaration and contains four distinct workflows (`apps/web/src/pages/ImportPage.tsx:10-88`). This is a strong signal that the earlier extraction moved rendering out of `App` without moving feature ownership.

Do not add Redux, Zustand, or a global context merely to hide these dependencies. Instead:

- move manual-entry state and actions into a manual-import feature hook/component;
- move scan/body-composition preview state into its own feature boundary;
- move profile lifecycle and active-profile refresh behavior together;
- keep route-level remote data close to the page that consumes it;
- retain `App` as navigation, active-profile, and top-level notice orchestration only.

Also consolidate the repeated busy/error/data triplets and post-mutation refresh sequences. Today related responses are applied through several separate setters (`apps/web/src/App.tsx:277-305,355-366`), which increases the number of transient states and makes mutation behavior hard to reason about.

### P1 — Split the database repository by responsibility, not by database technology

`DuckDbRepository` combines:

- schema creation and hydration;
- full export/snapshot mapping;
- profile and observation CRUD;
- import deduplication and insertion;
- retention;
- summary/detail projections;
- analytics queries;
- transaction and connection lifecycle.

The file's size is a symptom of these responsibilities, not of DuckDB itself. Avoid a generic query-builder or an ORM solely to reduce line count. Keep SQL explicit and split cohesive collaborators around the existing connection/transaction boundary:

- schema and migration;
- import persistence and retention;
- profile/observation commands;
- summary and analytics projections;
- full export.

`ProfileRepository` should remain the application-facing contract. Database-specific details should stay behind it so a future SQLite evaluation changes adapters rather than route/domain code. Current `ProfileStoreManager` methods such as `runActiveDuckDbQuery` and concrete `instanceof` checks leak the provider into orchestration (`apps/api/src/store.ts:469-477`); replace these with capability methods on the repository boundary.

### P1 — Stop silent retention and reduce remaining full snapshots

Imports enforce hard-coded limits and then return only final aggregate counts (`apps/api/src/storage/duckdbRepository.ts:435-530`). There is no accepted/duplicate/evicted breakdown, so a successful import can silently discard older health records. Audit text reports parsed source rows, not committed changes (`apps/api/src/storage/duckdbRepository.ts:525-529`).

The canonical store now has bounded bootstrap, summary, and detail projections, but several explicit operations still reconstruct every table through `snapshot()` (`apps/api/src/storage/duckdbRepository.ts:178-300`):

- experimental store query (`apps/api/src/routes/queryRoutes.ts:56-65`);
- biological age (`apps/api/src/routes/dataRoutes.ts:106-110`);
- warehouse diagnostic (`apps/api/src/routes/dataRoutes.ts:177-181`);
- insight generation (`apps/api/src/routes/dataRoutes.ts:187-191`);
- clinician PDF (`apps/api/src/routes/dataRoutes.ts:206-209`);
- complete store/export, where a snapshot is expected.

Define retention policy as product behavior, report committed outcomes, and add user-visible warnings before tuning limits. Then move biological age, insights, and clinician reporting to purpose-built projections. Keep the full snapshot only for explicit export and one-time migration.

### [DONE] P1 — Establish one API contract and structured client errors

The web client manually re-declares response interfaces and casts JSON directly to `T`. On failure it discards HTTP status, stable server error code, and correlation ID by throwing raw response text (`apps/web/src/api.ts:68-74`). This forces pages to normalize errors inconsistently and makes future mobile dashboard reuse harder.

Move transport-neutral request/response schemas for supported endpoints into the shared package. Keep Express and browser fetch details in their apps. Return a typed `ApiError` carrying:

- HTTP status;
- stable error code;
- user-safe message;
- correlation ID.

Do not share route handlers or persistence models with clients. The reusable unit is the public LAN API contract.

### [DONE] P1 — Make Health Connect collection metadata single-source

`syncHealthConnect.ts` repeats the same collection inventory in the payload interface, permission map, record reader, payload construction, chunk flattening, empty-chunk skeleton, and row counting (`apps/android-companion/src/syncHealthConnect.ts:69-160,390-447,523-553,680-705`). Adding one category therefore requires coordinated edits in many places.

Preserve the explicit wire shape; replacing it with `Record<string, unknown[]>` would weaken type safety and make the API contract less legible. Instead introduce one typed descriptor table that maps:

- Health Connect category and record type;
- payload collection key;
- record-to-wire conversion;
- optional permission or platform availability.

Derive permission completeness checks, reading, chunking, and row counts from that table. Add a test proving every `HEALTH_CONNECT_CATEGORIES` entry has exactly one descriptor. Do not introduce a cross-platform `HealthSyncProvider` until an iOS implementation actually exists; the current Android-specific boundary is appropriate.

### [DONE] P1 — Remove test-runner configuration drift

Two root Vitest configurations disagree:

- `vitest.workspace.ts` includes shared, API, Android, and web projects (`vitest.workspace.ts:1-8`);
- `vitest.config.ts`, which is used by the root `vitest run` script, lists shared, API, and web but omits Android (`vitest.config.ts:1-11`, `package.json:17`).

This makes `npm test` an unreliable indicator for Android TypeScript tests even though those tests exist. Retain one root configuration, include all four projects, and make CI invoke the same repository command. Native Kotlin pinning tests remain a separate platform gate.

### [DONE] P2 — Delete or quarantine unused experimental surfaces

The normal web and Android apps do not call:

- `POST /api/query/ask-store`;
- `POST /api/warehouse/rebuild`;
- `POST /api/llm/simple`;
- the web client's `api.store()` method;
- the web client's `importBloodTest()` method.

These paths increase authorization, documentation, testing, and maintenance surface. Because the product is unreleased, remove them unless they support a current, documented developer workflow. If a diagnostic must remain, mount it only in an explicit development mode and keep it owner-only.

The supported `/api/query/ai` path already has deterministic fallback behavior, so the store-backed query prototype is especially redundant (`apps/api/src/routes/queryRoutes.ts:56-110,112-229`).

### P2 — Separate parser families and registry behavior from catalog data

`packages/shared/src/parsers.ts` contains CSV parsing, manual imports, body-composition extraction, blood-test extraction, date parsing, unit normalization, and identifier creation. These are cohesive at package level but not at file level. Split by input family while retaining common primitives for dates, CSV, units, and stable IDs.

`registry.ts` is large mainly because it is a declarative measurement catalog (`packages/shared/src/registry.ts:3-1076`). Do not fragment the catalog into many tiny files. Move only the executable lookup/classification/unit-conversion behavior (`packages/shared/src/registry.ts:1082-1236`) away from the data, and test the catalog as data integrity: unique codes, valid aliases, supported conversions, and valid reference ranges.

### P2 — Simplify small long-running state stores

The in-memory rate-limit map only removes expired buckets after exceeding 5,000 keys (`apps/api/src/createApp.ts:114-140`). In a local single-instance app this is not an immediate capacity threat, but periodic bounded cleanup is simpler and prevents stale entries from persisting indefinitely.

`PairingStore.validateToken` synchronously rewrites the complete device registry on every authenticated companion request (`apps/api/src/pairing.ts:139-148,183-188`). Persistence is also a direct write rather than temporary-file plus atomic rename. Debounce `lastUsedAt` persistence, make the registry write atomic, validate its schema on load, and delete expired denied requests rather than retaining them in memory (`apps/api/src/pairing.ts:165-175`).

These changes matter more for reliability than adding monitoring infrastructure to a local desktop process.

### P2 — Reconcile documentation with the simplified architecture

Documentation is extensive but contains historical layers:

- README still describes retained JSON rollback/fallback and an explicit warehouse rebuild (`README.md:9,25-29,49-52,196-206`);
- the two previous reviews mix original findings, later remediation, and stale status in a way that makes current truth difficult to identify;
- `DESIGN.md` and several release/privacy documents are not discoverable from a central documentation index;
- `.audit-allowlist.json` has package names and a reminder, but no advisory, owner, review date, expiry, or compensating-control record.

Keep past reviews immutable as historical records. Treat this report and product/release documents as current guidance, add a small documentation index, and update architecture text after deleting transitional code.

## Previous-review status

| Theme from earlier reviews | Current assessment |
| --- | --- |
| LAN owner authentication | Implemented; companion authorization remains overbroad |
| Central cloud-consent enforcement | Implemented in the model client and route checks |
| Model endpoint SSRF/key hardening | Implemented |
| JSON-to-encrypted-DuckDB migration | Canonical direction is implemented; transitional runtime code remains |
| Full-store startup payload | Resolved by `/api/bootstrap` |
| Incremental DuckDB import | Implemented; committed/duplicate/evicted accounting remains |
| Android pinning, cursor, chunking, provenance | Implemented; collection metadata is highly duplicated |
| Android least-privilege defaults and disclosure | Substantially improved: no default categories, 30-day default, disclosure gate |
| Web accessibility semantics | Strong foundation; independent WCAG verification remains |
| API lifecycle annotations | Partially implemented via headers; redundant experimental endpoints remain |
| Dependency audit ownership | Still informal |
| Current DuckDB backup/restore | Still absent and remains a release-readiness concern |

## Recommended simplification sequence

1. [DONE] **Fix the authorization model** with an owner-default policy and explicit companion capability allowlist.
2. [DONE] **Choose and enforce the canonical storage architecture**: preserve a one-time JSON importer, remove JSON runtime fallback and detached warehouse code, and update documentation.
3. [DONE] **Remove unused experimental endpoints and web client methods** before building more features on them.
4. [DONE] **Split web feature ownership** out of `App.tsx` and reduce `ImportPage` to composed feature panels.
5. **Split DuckDB persistence by responsibility** behind the existing repository contract; remove provider checks from orchestration.
6. **Make imports honest** by returning accepted, duplicate, and evicted counts and exposing retention warnings.
7. **Replace remaining non-export snapshots** with purpose-built repository projections.
8. [DONE] **Create shared API schemas and structured errors** for future web/mobile feature reuse.
9. [DONE] **Make Health Connect metadata descriptor-driven** and run Android TypeScript tests in the root test command.
10. **Split parser families and catalog behavior**, then address smaller persistence/configuration debt.

## Explicit non-recommendations

To avoid replacing current debt with new overengineering:

- Do not introduce an ORM or generic database-provider framework. Keep explicit SQL behind a narrow repository contract.
- Do not add a global frontend state library before feature ownership is separated.
- Do not create a speculative cross-platform health-sync provider before iOS work starts.
- Do not turn every page, query, or registry item into its own file; split only at stable responsibility boundaries.
- Do not preserve unused prototype endpoints for hypothetical compatibility. The app is unreleased, so deletion is cheaper now.

## Overall conclusion

The application is not broadly overengineered. Most complexity comes from valuable features plus unfinished architectural transitions. The code will become materially easier to release and extend if the next phase emphasizes deletion, capability boundaries, and feature ownership rather than more abstraction.

The target state should have one canonical runtime store, one supported query path, one public API contract, one root test configuration, and top-level components that coordinate features rather than implement them.