# Codebase and Release-Readiness Review

**Reviewed:** 2026-07-10  
**Scope:** Web app, API, shared package, Android companion, repository/release setup  
**Goal:** Prepare an open-source web app and paid Play Store companion for use beyond the current single-user prototype

## Executive summary

The prototype has a sound product direction: local-first storage, deterministic identifiers, runtime validation with Zod, authenticated encryption at rest, a constrained AI-to-SQL pipeline, and clear wellness rather than diagnosis boundaries. The code is understandable and the feature set is already coherent.

It is **not ready to ship to other users yet**. The primary blocker is the trust boundary created when the API is bound to `0.0.0.0` for phone sync: the API has no authentication and the Android app sends sensitive Health Connect data over unrestricted cleartext HTTP. Any client on the same network can read, alter, export, or delete health data. The next largest risks are the absence of tests and CI, non-atomic persistence/rebuild operations, incomplete Play Store privacy/release setup, and large monolithic frontend/API files.

### Recommended release gates

1. Authenticate every non-loopback API request and provide a secure pairing flow for the companion.
2. Do not ship a production Android build with global cleartext traffic enabled.
3. Add automated tests around parsers, storage, Health Connect mapping, and SQL safety, then enforce them in CI.
4. Make encrypted-store writes and DuckDB rebuilds atomic and add a store schema/migration strategy.
5. Complete Health Connect disclosure, privacy policy, Play data-safety, AAB, signing, and versioning work.
6. Add an open-source license and align privacy documentation with the optional cloud-model behavior.

## Architecture assessment

The monorepo separation into `apps/api`, `apps/web`, `apps/android-companion`, and `packages/shared` is appropriate. Shared types and deterministic import transforms are good foundations. The API, however, currently combines transport, validation, orchestration, persistence, warehouse lifecycle, model calls, and response shaping in a single process without explicit service boundaries.

The encrypted JSON store is suitable for a single-user prototype, but its whole-file, synchronous rewrite model will become slow and fragile as data grows. DuckDB is a good read-optimized companion, but rebuilding it from scratch after each import makes it a derived cache and should be treated as such with atomic replacement and recovery behavior.

The product is currently **local-first, not multi-user**. That is a valid architecture, but “local” must not be treated as authentication. A phone-accessible LAN service creates a remote trust boundary even if no internet deployment is planned.

## Findings

Priorities:

- **P0:** Release blocker; address before external testing.
- **P1:** Address before a stable public release.
- **P2:** Important hardening or maintainability work.
- **P3:** Lower-risk cleanup or product decision.

### Security and privacy

#### [IN PROGRESS] P0 — LAN API has no authentication or authorization

The README instructs users to bind the API to all interfaces for companion sync (`README.md:21-26`), but the API has no authentication middleware (`apps/api/src/server.ts:36-52`). CORS is not access control and does not restrict non-browser clients. Once exposed, any LAN client can:

- read the full store and profile (`server.ts:174-179`);
- export raw import content (`server.ts:709-712`);
- inject Health Connect, lab, body-composition, or Samsung data;
- delete observations (`server.ts:350-373`);
- invoke model-backed endpoints using the owner's configured quota.

**Recommendation:** Require authentication on all routes, refuse non-loopback startup without a configured credential, and pair the companion using a short-lived code or QR flow that provisions a revocable device token. Apply authorization and rate/body limits centrally.

#### [IN PROGRESS] P0 — Health Connect data is transmitted over unrestricted cleartext HTTP

The Android manifest enables cleartext globally (`apps/android-companion/app.json:9-12`). The `withDevNetworkSecurity` plugin applies `cleartextTrafficPermitted="true"` to every destination and every build (`plugins/withDevNetworkSecurity.js:5-30`). The sync sends 30 days of steps, heart rate, oxygen saturation, HRV, weight, and exercise data without authentication (`src/syncHealthConnect.ts:110-162`).

**Recommendation:** Separate development and production configuration. Production should require an authenticated encrypted channel. If local certificates are used, build a deliberate pairing/trust mechanism rather than silently accepting arbitrary endpoints.

#### [DONE] P0 — Privacy claims do not match optional cloud-model behavior

The README says no remote AI/vendor upload paths are implemented (`README.md:28-33`) while also documenting an OpenAI-compatible cloud provider (`README.md:52-62`). When configured, query evidence and health-derived summaries are included in model prompts (`apps/api/src/server.ts:431-439,481-488,581-591`).

**Recommendation:** Correct the privacy model, make provider state and data scope explicit in-product, require informed opt-in before cloud processing, minimize prompt data, and document retention/provider responsibilities. Default to local processing.

#### [DONE] P1 — Samsung JSON endpoint can traverse arbitrary local directories

`uploadPath` is caller controlled (`server.ts:118-120,287-291`). It is resolved and recursively scanned without enforcing containment beneath `data/uploads` (`samsungJsonImport.ts:325-368`). Errors and diagnostics can also expose absolute paths.

**Recommendation:** Retire this endpoint as Health Connect replaces it.

#### [DONE] P1 — External font request conflicts with the local-only trust message

The web app imports Google Fonts at runtime (`apps/web/src/styles.css:1`). This makes a third-party request that reveals network metadata whenever the UI loads.

**Recommendation:** Self-host the required font files or use system fonts, and document any remaining external requests.

#### P2 — At-rest protections need clearer limits and safer file handling

AES-256-GCM with random IVs and scrypt is implemented correctly (`apps/api/src/store.ts:188-214`). However:

- the generated key and encrypted store live beside each other, so encryption mainly protects copied store files, not compromise of the same user account;
- `health-store.enc` is not explicitly created with mode `0600` (`store.ts:213`);
- writes replace the live file directly rather than using write/fsync/rename;
- health payloads are stored both normalized and as `rawContent`, with silent truncation above one million characters (`healthConnectImport.ts:115-127`, `store.ts:296-306`).

**Recommendation:** Document the threat model, set restrictive permissions, use atomic writes/backups, and make raw-payload retention configurable with visible truncation diagnostics.

#### P2 — Error and health responses expose unnecessary internals

The default non-production error response returns stack traces (`server.ts:714-727`) and import errors may contain absolute paths. `/api/health` returns the configured model endpoint (`server.ts:157-170`).

**Recommendation:** Use stable public error codes, log details locally with correlation IDs, and return only minimal health information.

### Data integrity, reliability, and performance

#### [DONE] P0 — Persistence and warehouse replacement are not crash-safe

The encrypted store is written directly to its final path (`store.ts:200-214`). A crash, power loss, or disk-full condition can leave it truncated. The warehouse rebuild deletes the active database before creating its replacement (`apps/api/src/warehouse.ts:27-32`), so a failed rebuild can remove the last usable warehouse.

**Recommendation:** Write both artifacts to temporary files, validate them, fsync where supported, then atomically rename. Keep a recoverable previous store and treat DuckDB as rebuildable derived state.

#### P1 — Persisted data has no application schema migration strategy

The encryption envelope has a version, but `HealthStoreData` does not have an application schema version (`packages/shared/src/types.ts:167-181`). Startup casts decrypted JSON directly to the current TypeScript type (`store.ts:188-197`); TypeScript does not validate persisted data at runtime.

**Recommendation:** Introduce a versioned runtime schema, explicit sequential migrations, startup validation, backup-before-migrate, and actionable recovery diagnostics. Since compatibility is not currently required, do this before establishing a public v1 format.

#### P1 — Full store rewrites and warehouse rebuilds will not scale well

Every mutation serializes, encrypts, and synchronously writes the whole store. `scryptSync` blocks the event loop on every persistence operation (`store.ts:200-214`). Every import then rebuilds all DuckDB tables. The web app also fetches the full store at startup (`server.ts:174-176`, `apps/web/src/App.tsx:201-204`), potentially returning hundreds of thousands of records.

**Recommendation:** In the near term, cache/async the key derivation, serialize mutations, stop returning the full store to normal UI paths, and rebuild DuckDB in the background with atomic swap. Before substantial growth, choose a transactional canonical store rather than extending whole-file JSON indefinitely.

#### P1 — Store retention contains correctness and growth issues

- `insights` and `auditEvents` grow without bounds (`store.ts:133-138,179-186`);
- lab-marker eviction sorts on hashed ID rather than collection time (`store.ts:120-124`);
- large fixed record caps silently discard data;
- generated Samsung import IDs include the current timestamp, weakening stable provenance (`samsungJsonImport.ts:34`).

**Recommendation:** Define an explicit retention policy, never silently discard health records, fix chronological lab-marker retention, cap non-clinical history separately, and surface retention/import diagnostics.

#### P2 — Health and query operations do avoidable work

The health endpoint computes full analytics (`server.ts:157-170`). DuckDB opens a new database/connection for each query. Several overlapping query endpoints use different planners and safety paths (`server.ts:385-620`), and the legacy NL/ask paths bypass `validateCompiledSql`.

**Recommendation:** Make liveness O(1), consolidate query contracts, clearly mark experimental endpoints, and route all executable SQL through one validation/execution boundary.

#### P2 — Import checksums are too weak for canonical deduplication

Shared CSV import deduplication uses 32-bit FNV-1a (`packages/shared/src/parsers.ts:72-79`), while other paths use SHA-256.

**Recommendation:** Standardize on a cryptographic content digest for import identity and retain source/provider record IDs where available.

### Android companion and Play Store readiness

#### P0 — Production release configuration is incomplete

Only a preview APK profile exists (`apps/android-companion/eas.json:1-12`). There is no explicit production AAB profile, release-specific network policy, or documented signing/submission process. `android.versionCode` is absent (`app.json:9-27`).

**Recommendation:** Add a production app-bundle profile, managed signing, monotonic versioning, release environment separation, and a documented release checklist.

#### P0 — Health Connect disclosure and Play privacy work are missing

The app immediately requests all supported permissions and has no first-run explanation of why each data type is needed (`syncHealthConnect.ts:42-87`, `App.tsx:60-88`). No privacy-policy flow or Play Data Safety/Health Connect declaration is present in the repository.

**Recommendation:** Add just-in-time rationale, a privacy-policy link, data inventory and retention/deletion language, least-privilege permissions, and complete the Play Console declarations before submission.

#### P1 — Denying one optional permission prevents all sync

If any requested Health Connect permission is missing, the app aborts the entire sync (`syncHealthConnect.ts:75-87`). Users cannot choose to share steps but not weight, for example.

**Recommendation:** Sync only granted types, clearly report omissions, and allow users to change selected categories later.

#### P1 — Sync is inefficient and loses useful provenance

Every tap reads and resends the full previous 30 days (`syncHealthConnect.ts:89-108`), the device label is hard-coded (`:110-115`), and exercise energy/distance supported by the server are not mapped (`:148-153`). Dense reads can create very large in-memory payloads.

**Recommendation:** Persist a per-device identifier and incremental sync cursor with overlap, chunk uploads, preserve provider record/origin metadata, and map all supported exercise fields.

#### P1 — Endpoint handling is unsafe and difficult to support

The endpoint is accepted if merely non-empty and stored in AsyncStorage (`apps/android-companion/App.tsx:16-37`). There is no identity check, pairing confirmation, TLS requirement, timeout, cancellation, or retry policy.

**Recommendation:** Replace free-form endpoint configuration with pairing, validate scheme/host, show the server identity, add bounded timeout/retry behavior, and provide an explicit unpair/delete action.

#### P2 — Dependency setup needs cleanup

`eas-cli` is a runtime dependency and brings a large vulnerable build-tool tree into production dependency audits (`apps/android-companion/package.json:5-14`). Both `expo-health-connect` and `react-native-health-connect` are installed while source imports only the latter. `npm audit --omit=dev` reported 30 advisories (10 high, 19 moderate, 1 low), heavily concentrated in Expo/EAS tooling; the DuckDB finding is transitive through `node-gyp` and requires advisory-level triage rather than blindly downgrading.

**Recommendation:** Move build tooling to development dependencies, remove the unused Health Connect wrapper after verification, establish a supported-version upgrade cadence, and review advisories for runtime reachability.

### Web design and accessibility

The visual direction is distinctive and appropriately calm, evidence-focused, and non-clinical. Responsive and reduced-motion rules exist (`styles.css:1309-1427`), and visible focus styling is present (`styles.css:102-107`). The main gap is semantic/accessibility implementation rather than visual concept.

#### P1 — Core interactive semantics are incomplete

- A clickable summary `<button>` is overridden with `role="row"`, hiding button semantics (`App.tsx:1726`).
- `tablist` containers lack `role="tab"`/`aria-selected` children (`App.tsx:863-866,1045-1055`).
- active navigation, sorting, and disclosure state lack `aria-current`, `aria-pressed`, or `aria-expanded` (`App.tsx:508-518,1685-1689,1714`).
- lab value/unit inputs rely on placeholders rather than programmatic labels (`App.tsx:1109-1119`).

**Recommendation:** Perform a semantic HTML/ARIA pass and test with keyboard plus at least one screen reader.

#### P1 — Dialog and destructive-action focus management is insufficient

The profile dialog declares `aria-modal` but does not move/trap/restore focus or handle Escape (`App.tsx:727-778`). Health-data deletions use `window.confirm` (`App.tsx:411-416,441-446`) instead of an accessible in-app confirmation workflow.

**Recommendation:** Create shared accessible dialog/alert-dialog primitives with focus trapping, restoration, Escape handling, and explicit destructive scope/count.

#### P1 — Dynamic status and errors are not announced

Global notices and page errors lack live-region semantics (`App.tsx:522,1519-1520,1692-1693`); the Android status card has the same issue (`apps/android-companion/App.tsx:84-88`).

**Recommendation:** Standardize status, alert, loading, and empty-state components across both apps.

#### P2 — Several visual elements lack equivalent context

The density bar has no progressbar semantics (`App.tsx:538`), sparkline labels are generic (`App.tsx:1883`), route titles remain static, and mobile body-composition headers are removed without per-field labels (`styles.css:1405-1408`). Deselected rows use opacity that may reduce contrast below AA (`styles.css:596-598`).

**Recommendation:** Include these in an automated axe/manual WCAG AA pass at desktop and narrow breakpoints.

#### P2 — Web architecture makes design changes risky

`apps/web/src/App.tsx` is 2,055 lines and `styles.css` is 1,427 lines. Routing, state, network actions, dialogs, every page, and many domain transforms are coupled in one file. Import pages pass dozens of props through multiple layers.

**Recommendation:** Split by route/feature, introduce shared UI primitives and feature-level state hooks/reducers, and keep API response mapping outside presentation components.

### Maintainability and engineering quality

#### [DONE] P0 — No automated tests exist

No test files, test framework, or test script exists. The highest-risk untested areas are:

- encrypted-store load/write/recovery and retention;
- parsers and import deduplication;
- Health Connect mapping, partial permissions, pagination, and chunking;
- query compiler and SQL validator;
- analytics/reference-range classification;
- API authorization and destructive endpoints;
- web accessibility and critical user flows.

**Recommendation:** Start with characterization tests before refactoring. Add unit, API integration, component accessibility, and a small end-to-end smoke suite. Use synthetic fixtures only.

#### [DONE] P0 — No CI quality gates exist

There are no GitHub Actions workflows. Pull requests can merge without install, typecheck, build, tests, audit review, or secret scanning.

**Recommendation:** Add least-privilege, pinned CI for workspace typecheck/build/tests, dependency review, and security scanning. Keep Android cloud builds separate from fast PR checks.

#### P1 — API composition is monolithic

`apps/api/src/server.ts` is 813 lines and contains environment loading, schemas, route definitions, orchestration, query response shaping, chart logic, error handling, and startup. This complicates testing and consistent policy enforcement.

**Recommendation:** Introduce an app factory and separate route modules, domain services, repositories, and infrastructure adapters. Keep one centralized auth/error/logging boundary.

#### P2 — Observability and operations are minimal

Only startup is logged. Server errors are returned but not reliably logged, there are no request IDs or structured audit-safe logs, and no graceful shutdown behavior is defined.

**Recommendation:** Add local structured logs with PHI redaction, correlation IDs, useful operation timing, startup config validation, and graceful shutdown. Do not log request bodies or model prompts.

#### P2 — Environment and API documentation are fragile

There is no `.env.example`; a hand-written environment parser lives in `server.ts:737-767`; examples are mostly PowerShell-only; API stability and endpoint lifecycle are undocumented.

**Recommendation:** Document supported platforms/configuration, validate environment at startup, provide cross-platform examples, and publish a versioned API contract for the companion boundary.

### Open-source and product readiness

#### P0 — The repository has no open-source license

There is no root `LICENSE`. Publishing source without one does not grant others permission to use, modify, or redistribute it.

**Recommendation:** Choose a license intentionally (including how it supports the paid companion strategy), add SPDX/package metadata where appropriate, and complete a third-party license review.

#### P1 — Community and security documentation are missing

There is no `SECURITY.md`, `CONTRIBUTING.md`, code of conduct, support policy, release policy, or vulnerability-reporting process. Health-data software needs an especially clear security scope and disclaimer.

**Recommendation:** Add these before publicizing the repository, including supported versions, responsible disclosure, privacy threat model, backup/recovery guidance, and non-medical-use boundaries.

#### P2 — Product boundaries and deprecations need explicit decisions

The API exposes four overlapping query endpoints, multiple import routes, and both legacy Samsung and Health Connect ingestion. Keeping all prototype paths multiplies security and maintenance obligations.

**Recommendation:** Mark endpoints/features as supported, experimental, or deprecated. Given the stated direction, retire Samsung CSV/JSON after confirming Health Connect coverage and providing a simple migration/export story.

## Proposed implementation order

### Milestone 1 — Safe external testing

1. LAN API authentication, companion pairing, transport protection, and request limits.
2. Atomic store/warehouse writes plus backup/recovery.
3. Tests for auth, storage, parsers, Health Connect mapping, and query safety.
4. CI gates.
5. Accurate privacy disclosures and cloud-model opt-in.

### Milestone 2 — Play Store/internal track

1. Production AAB/signing/version configuration.
2. Health Connect rationale, least-privilege partial sync, privacy policy, and Play declarations.
3. Incremental/chunked sync with stable device identity and resilient networking.
4. Android accessibility and release smoke testing.

### Milestone 3 — Public open-source release

1. License and third-party notices.
2. Security, contribution, support, architecture, configuration, and recovery documentation.
3. Feature/endpoint lifecycle decision, including Samsung import retirement.
4. Dependency/secret/code scanning and release automation.

### Milestone 4 — Sustainable development

1. Split frontend and API monoliths behind tested boundaries.
2. Version and migrate persisted data and the companion API.
3. Reduce full-store transfers/rebuilds and establish a scalable canonical store.
4. Complete WCAG AA remediation and regression testing.

## GitHub issue grouping

Priority findings should be tracked as these grouped workstreams:

1. **Secure LAN API access and companion pairing**
2. **Harden persistence and warehouse recovery**
3. **Add automated tests and CI quality gates**
4. **Complete Android production and Health Connect Play readiness**
5. **Make Health Connect sync selective, incremental, and resilient**
6. **Align privacy behavior, cloud AI consent, and documentation**
7. **Fix web and Android accessibility release blockers**
8. **Establish open-source licensing and project governance**
9. **Reduce monoliths and consolidate API/query boundaries**
10. **Retire or sandbox legacy Samsung import paths**

## Positive foundations to preserve

- AES-GCM authenticated encryption and generated local key permissions.
- Zod validation and bounded request schemas.
- Deterministic Health Connect record IDs and deduplication intent.
- Compiler-generated SQL, identifier allowlisting, read-only query connections, and explicit SQL validation.
- No use of `dangerouslySetInnerHTML`; model text is rendered as text.
- Clear product safety language avoiding diagnosis and treatment advice.
- Shared domain types/registries and a coherent local-first product direction.
- Responsive/reduced-motion CSS and an existing visible focus style.