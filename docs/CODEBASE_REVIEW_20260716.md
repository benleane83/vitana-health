# Pre-launch Code Review

**Reviewed:** 2026-07-16  
**Revision reviewed:** `c1e700c`  
**Scope:** shared analytics, encrypted DuckDB projections, API security and persistence, profile validation, web profile editing, desktop recovery, CI/release controls, public documentation, and existing automated tests

## Executive assessment

The application has a strong local-first foundation: encrypted per-profile canonical storage, bounded runtime projections, capability-scoped companion access, explicit cloud consent, TLS pinning, and broad automated coverage. The review found no reason to redesign those foundations before a first release.

The principal launch risk remains disaster recovery. Packaged database keys are protected by OS `safeStorage`, so copying application data to another machine or Windows account is not a portable backup. The product has no complete restore workflow. This should remain a release blocker unless the initial release clearly states that portable recovery is unavailable and the risk is accepted.

Eight other correctness, security, durability, validation, and documentation findings were addressed after the review. A tagged-release artifact gate also remains open.

## Method and validation

The review traced supported user flows from web and Android clients through Express authorization and validation, repository projections and transactions, shared analytics, desktop key handling, and release scripts. Findings were checked against the code path that directly controls the behavior and against neighboring tests.

Baseline validation before remediation:

| Check | Result |
| --- | --- |
| Production build | Passed |
| Android companion typecheck | Passed |
| Core tests | 167 passed |
| Integration tests | 66 passed |
| Durability tests | 2 passed |
| Desktop tests | 6 passed |
| Raw `npm audit --omit=dev --json` | Registry TLS failure; no vulnerability result obtained |

## Findings

### [OPEN] P0 - No portable backup and restore path

The packaged desktop database key is wrapped with OS `safeStorage`. A copy of the application-data directory will generally be unreadable on another computer or Windows account. The clinician PDF is not a restorable backup, and the complete JSON export has no supported import path.

Before public launch, implement a versioned, passphrase-protected portable backup containing all profiles and required metadata, plus a tested restore flow that works on a fresh OS account. Until then, documentation must not imply that copying local key files provides disaster recovery.

### [ADDRESSED] P1 - DuckDB analytics ignored imperial units

The canonical analytics projection did not read the profile unit preference, causing shared analytics to default to metric. The projection now supplies `units`, and focused coverage exercises an imperial DuckDB profile.

### [ADDRESSED] P1 - Historical lab abnormalities appeared current

Analytics previously classified every historical lab result and truncated the alert list in storage order. An old abnormal result could remain visible after a newer normal result. Current alerts now use only the latest observation per marker and carry `observedAt` for downstream presentation.

### [ADDRESSED] P1 - Adult reference ranges applied to children and pets

`subjectKind` was not passed into analytics, so generic adult classifications could be emitted for child and pet profiles. Analytics now carries profile kind and suppresses reference-range statuses and lab alerts for non-adult profiles until validated subject-specific ranges exist.

### [ADDRESSED] P1 - Dependency audit failed open

The custom audit gate treated npm registry error JSON as a vulnerability-free report. It now validates the report schema and exits with an infrastructure failure when npm returns an error or omits the vulnerability map. Unit tests cover valid, registry-error, and malformed reports.

### [ADDRESSED] P1 - OpenRouter callback trusted the request Host header

The OAuth redirect URL was built from request protocol and `Host`, permitting a forged header to influence the callback supplied to OpenRouter. The server now injects a trusted loopback runtime origin; integration coverage asserts the resulting callback URL.

### [ADDRESSED] P2 - Pairing token validation rewrote registry synchronously and non-atomically

Every companion request rewrote the complete registry directly. Registry writes now use a temporary file plus atomic rename. `lastUsedAt` updates are coalesced, while approvals and revocations remain immediately durable.

### [ADDRESSED] P2 - Profile dates and heights accepted implausible values

The API accepted future dates and near-zero heights. It now rejects future birth dates, adult/child age mismatches, and subject-specific implausible height ranges. The profile form exposes matching date and unit-aware height constraints.

### [ADDRESSED] P2 - Public documentation described removed behavior

The README referenced a missing `dev:duckdb` script and removed LLM diagnostic route. The API contract described removed query endpoints and stale auth, pairing, profile, and analytics response shapes. Public documentation now reflects the supported commands and route behavior.

### [OPEN] P2 - Tagged release artifacts are not gated end to end

CI validates source builds and tests, but the release process should prove that the exact signed desktop installer and Android artifact associated with a tag passed smoke, signature, checksum, and provenance checks. Add a tag-triggered protected release workflow that builds once, tests those artifacts, and publishes only the verified outputs.

## Launch recommendation

Do not represent the application as recoverable across machine or OS-account loss until portable backup and restore are implemented and tested. After that, add the tagged artifact gate before broad distribution. The remediated analytics, audit, OAuth, pairing, validation, and documentation items should be retained as regression coverage in the normal release checks.