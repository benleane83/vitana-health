# Pre-Beta Codebase Review

**Reviewed:** 2026-09-01
**Scope:** `apps/api`, `apps/web`, `apps/mobile-companion`, `apps/desktop`, `packages/shared`, `packages/api-client`, `scripts/`, `.github/workflows/`, root build & test config
**Goal:** re-check the 2026-08-09 findings after three weeks of feature work (40 commits), and find what is still cheap to change before beta testers hold real encrypted profiles.

## Method

This pass ran the toolchain and verified every claim against source. Where a suspicion did not survive verification it was dropped rather than reported; the ones most likely to be re-raised next time are listed under "Checked and found sound".

- `npm run typecheck` passes across all six workspaces.
- `npm run test:core` **does not pass**, and does not pass the same way twice. Two full runs on an idle machine produced different failure sets (2 failed / 872 passed, then 5 failed / 860 passed) plus 4 and 9 worker-startup timeouts respectively. Duration was **337s and 349s** — the 2026-08-09 review recorded the same suite at "about a minute". See finding 4; this is now the single biggest drag on the project.
- `npm run test:integration` was not run: `server.integration.test.ts` still needs the prepared DuckDB `httpfs` extension, which requires network access this environment does not have. Unchanged environment limitation, not a defect.
- `npm run audit:ci` again could not reach the npm advisory endpoint. **Dependency advisories remain unverified for the third review running.** See finding 12 — the gate has a second problem that makes it weaker than it looks even when it does run.

---

## Remediation status — 2026-09-01

The following findings have been remediated and verified after this review:

| # | Status | Verification |
|---|--------|--------------|
| 1 | **Remediated** | `mg/dL ↔ mmol/L` conversion is now allowlisted by analyte; calcium is converted correctly and unsupported sodium input is rejected. |
| 2 | **Remediated** | Desktop owner tokens are encrypted with Electron `safeStorage`; plaintext legacy tokens migrate on the next desktop launch and standalone use fails closed against the protected format. |
| 5 | **Remediated** | `VITANA_SECRET` documentation identifies its role as the health-store master key, and runtime accepts only a high-entropy 32-byte base64url value. |
| 8 | **Remediated** | Static SPA responses have a CSP and related browser security headers, covered by an API test. |
| 10 | **Remediated** | Backup preflight uses indexed storage counts rather than serializing all collections twice; the exact streaming cap remains the backstop. |
| 16 | **Remediated** | Standalone detail and chart ranges use the selected profile's subject kind. |
| 24 | **Remediated** | Standalone schema v11 migrates profile fields into typed SQLite columns; runtime profile reads and writes no longer use `profile_json`. |

Validation after remediation:

- `npm run typecheck` passes across all workspaces.
- Shared conversion tests: 6 passed.
- API backup and CSP tests: 17 passed.
- Standalone SQLite migration and reference-range tests: 44 passed.

---

## Executive assessment

Three of the five items from 2026-08-09 are genuinely fixed, and fixed well. `estimateBackupV1PlaintextSize` now runs before response headers are committed, so a too-large backup gets a real `413` instead of a truncated file (F1). `parseBackupMultipart` destroys the request on `stream.on("limit")` instead of buffering to completion (F5). `setWindowOpenHandler` and `will-navigate` guards are both present in the Electron main process (F3). The query compiler remains fully parameterized, the DuckDB abstraction has held (exactly one `duckdb`-prefixed import outside `storage/`, and it is an error class), and the AI path still validates compiled SQL against a whitelist before execution.

But this review found something the previous three did not look for, and it outranks everything else in the repo.

**First, the unit-conversion layer silently corrupts common lab values.** `mgPerDlFactor` in `measurementRegistry.ts` returns glucose's `18.0182` as an *unconditional default*. Every mmol/L analyte that is not cholesterol or triglycerides inherits it. Calcium is registered with `canonicalUnit: "mmol/L"`, and mg/dL is the standard US reporting unit for calcium — so a normal US blood panel showing `Calcium 9.5 mg/dL` is accepted, converted, and stored as **0.53 mmol/L** against a `normalLow` of `2.1`. The app will then present a healthy person with a critically low calcium reading. This is not theoretical; it is reproduced below.

**Second, the most powerful credential in the system is the least protected one.** The DuckDB key is wrapped by Electron `safeStorage`. The model API key is wrapped by Electron `safeStorage`. The owner bearer token — which grants full read/write on every profile, plus backup creation — is written to `security.json` in plaintext. `createApp.ts:186-194` explains at length why loopback is not an authorization decision and why a launch nonce is needed, and that reasoning is correct; but the nonce only protects `POST /api/auth/local`. Any process running as the user can skip that path entirely by reading the token off disk and sending `Authorization: Bearer`.

**Third, the test suite has stopped being a gate.** It is 5.8× slower than three weeks ago, fails nondeterministically, and three separate `vitest.config.ts` files now carry comments explaining that timeouts were raised because the parallel run is flaky. The root cause is measurable and fixable in one change.

Two 2026-08-09 findings are unfixed and are restated here, briefly, rather than re-argued: restore is still fully synchronous and fully in memory (F2), and nothing in the app stack sets a Content-Security-Policy (F4).

### Do these first

| # | Finding | Severity |
|---|---------|----------|
| 1 | [Non-glucose analytes are converted with the glucose factor](#f1) | P1 — Remediated |
| 2 | [The owner token is stored in plaintext, defeating the launch-nonce design](#f2) | P1 — Remediated |
| 3 | [Windows updates are unsigned and signature verification is disabled](#f3) | P1 |
| 4 | [`npm run test:core` is no longer green, and is 5.8× slower](#f4) | P1 |
| 5 | [`.env.example` mislabels the database master key as a "session secret"](#f5) | P2 — Remediated |

---

# P1 — Fix before beta testers have data

<a id="f1"></a>
## 1. Non-glucose analytes are converted with the glucose factor — remediated 2026-09-01

`packages/shared/src/measurementRegistry.ts:260-264`:

```ts
function mgPerDlFactor(code: string): number {
  if (code === "triglycerides") return 88.57;
  if (code === "total_cholesterol" || ... ) return 38.67;
  return 18.0182;              // <- glucose, applied to everything else
}
```

Lines 220-221 apply it to any `mmol/l ↔ mg/dl` pair without consulting the analyte:

```ts
if (from === "mmol/l" && to === "mg/dl") return reciprocal(mgPerDlFactor(code));
if (from === "mg/dl" && to === "mmol/l") return reciprocal(1 / mgPerDlFactor(code));
```

`registry.ts` registers calcium (`:691-699`), potassium (`:796-806`) and sodium (`:809-817`) with `canonicalUnit: "mmol/L"`. Running the built package against them:

```
sodium    322 mg/dL -> 17.87 mmol/L    (correct: 140)
calcium   9.5 mg/dL ->  0.53 mmol/L    (correct: 2.37)
potassium 4.0 mg/dL ->  0.22 mmol/L    (correct: 1.02)
glucose    90 mg/dL ->  4.99 mmol/L    (correct)
```

This is on the write path, not a display quirk: `canonicalizeMeasurement` is called from `duckdbCommands.ts:410,473,488` and `duckdbRows.ts:165,204`, so the wrong number is what gets persisted. The original is not retained in a recoverable form — only `sourceUnit` is kept.

Calcium is the case that matters. US labs report calcium in mg/dL essentially universally, a 9.5 mg/dL result is unremarkable, and the registry's `normalLow: 2.1` means the stored 0.53 will be rendered as severely abnormal wherever reference ranges are applied. The blood-test import path reads units straight from the document, so no user error is required to trigger it.

The design mistake is the `return` on line 263. A per-analyte molar-mass table with no default is the same amount of code and cannot fail silently.

**Recommendation:**
- Change `mgPerDlFactor` to return `number | undefined`, with entries for the analytes that genuinely have a defined mg/dL↔mmol/L conversion (glucose 18.0182, calcium 4.0, urea/BUN 2.8, cholesterol fractions 38.67, triglycerides 88.57). Return `undefined` for everything else so `conversionFactor` falls through and the row is rejected as `unconvertible-unit` — which is the correct outcome for sodium and potassium, whose mg/dL form is not something a lab reports.
- Add one test asserting `canonicalizeMeasurement("calcium", 9.5, "mg/dL")` yields ~2.37 mmol/L and one asserting `canonicalizeMeasurement("sodium", 322, "mg/dL")` is rejected. The existing `canonicalizeMeasurement.test.ts` has good coverage of the *shape* of results and none of the *arithmetic*.
- Audit existing local profiles for stored electrolyte and calcium values that carry `sourceUnit: "mg/dL"`; those rows are wrong and, since this is pre-release, are cheapest to delete and re-import.

**Resolution:** `mgPerDlFactor` now returns `number | undefined`, explicitly handles glucose, calcium, urea, lipids, and triglycerides, and rejects any unsupported analyte/unit pair. The regression test covers calcium `9.5 mg/dL → 2.375 mmol/L` and rejects sodium `mg/dL`.

<a id="f2"></a>
## 2. The owner token is stored in plaintext, defeating the launch-nonce design — remediated 2026-09-01

`apps/api/src/security.ts:79-83` mints a 256-bit owner token and writes it as JSON:

```ts
const ownerToken = randomBytes(32).toString("base64url");
const content = JSON.stringify({ ownerToken } satisfies StoredSecurity, null, 2);
writeFileSync(securityPath, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
```

Verified on this machine's installed build — `%APPDATA%\Vitana Health\security.json`, 65 bytes, token in cleartext. The `mode: 0o600` is a no-op on Windows: the ACL is the inherited `SYSTEM / Administrators / <user>: FullControl`.

That token is checked by `ownerTokenIsValid` (`createApp.ts:167-184`) against `Authorization: Bearer` **or** the `vitana_owner` cookie, and it is the credential behind every owner-only route: all profile reads and writes, `POST /api/backups/create`, `POST /api/backups/restore`, and the AI settings that hold the model API key.

The reason this is a P1 rather than a shrug is that the codebase has already reasoned its way to the opposite conclusion elsewhere. `createApp.ts:186-194`:

> Loopback alone is not an authorization decision: every process on the machine shares it, including anything a tester downloads.

That is right, and the launch nonce that follows from it is a good control. But it only guards `POST /api/auth/local`. An adversary matching that exact threat model — "anything a tester downloads" — does not need to defeat the nonce; it reads `security.json` and authenticates directly. Meanwhile the two *less* dangerous secrets in the same product, the DuckDB key (`apps/desktop/secure-store-key.cjs:69`) and the model API key (`apps/api/src/aiSettings.ts:95-99`), are both wrapped with `safeStorage.encryptString`. The protection is inverted relative to the value of the secret.

**Recommendation:**
- Wrap the owner token with the same `AiCredentialProtector` seam that already exists. `configureAiCredentialProtector` is injected from `main.cjs:218-221` before `startServer`; give `security.ts` the same treatment and store `{ version: 1, credentialStorage: "electron-safe-storage-v1", wrappedToken }`. The standalone server keeps the plaintext branch and fails closed on a desktop-wrapped file, exactly as `readApiKey` already does.
- Since the token is regenerated when absent, no migration is needed — delete `security.json` on upgrade and let it re-mint.
- While there: the token has no expiry and no rotation path. A `POST /api/settings/rotate-owner-token` that re-mints and invalidates the cookie is a small addition that makes a leaked token recoverable.

**Resolution:** `security.ts` now persists a desktop-owned token as `{ credentialStorage: "electron-safe-storage-v1", wrappedOwnerToken }`, encrypted through Electron `safeStorage`. The desktop configures the new protector before it starts the embedded API. Existing plaintext `security.json` files migrate in place on the next desktop launch; standalone servers retain explicit plaintext persistence only when no protector is configured, and refuse to open a desktop-wrapped token rather than silently generating a replacement. `security.test.ts` verifies wrapped generation, legacy migration, restart decryption, and standalone fail-closed behavior.

<a id="f3"></a>
## 3. Windows updates are unsigned and signature verification is disabled

`apps/desktop/package.json:8` sets `"vitanaDistributionChannel": "github"`, `:117` publishes to the GitHub provider, and the Windows target at `:90,92` sets both:

```json
"signExecutable": false,
"verifyUpdateCodeSignature": false
```

So the auto-update trust chain for the primary distribution channel is TLS to GitHub plus the SHA-512 in `latest.yml` — and `latest.yml` is itself served from the same place, so it authenticates transport integrity, not publisher identity. Anything that can serve the feed can serve an update. `verifyUpdateCodeSignature: false` explicitly removes the one check electron-updater performs on Windows that would catch it.

The secondary cost is ordinary usability: an unsigned NSIS installer gets a SmartScreen "unrecognized app" interstitial, which for a health app asking users to trust it with medical records is a poor first impression on the very first screen they see.

**Recommendation:**
- Obtain an Authenticode certificate (an OV cert is sufficient to remove the block; EV gets immediate SmartScreen reputation) and set `signExecutable: true` and `verifyUpdateCodeSignature: true` before the public cut.
- Until then, treat the update path as untrusted: the `store` channel (`package:store`, line 27) is signed by the Store pipeline and does not have this problem, so if the GitHub channel must ship unsigned first, disable auto-update on it and require a manual download, as `package:linux` already does with `vitanaUpdateChannel=manual`.

<a id="f4"></a>
## 4. `npm run test:core` is no longer green, and is 5.8× slower

Two consecutive full runs on an otherwise idle machine:

| Run | Files | Tests | Duration | Worker startup errors |
|-----|-------|-------|----------|----------------------|
| 1 | 2 failed / 132 passed | 2 failed / 872 passed | 337s | 4 |
| 2 | 3 failed / 126 passed | 5 failed / 860 passed | 349s | 9 |

The failure sets differed between runs. Every failure that surfaced a reason was `Error: Test timed out in 30000ms`, and every worker error was `Timeout waiting for worker to respond`. So the suite is not detecting a regression — it is failing to finish.

The cause is measurable. `packages/shared/src/backup.ts:22` sets `SCRYPT_N = 2 ** 17`, and `backupCrypto.ts:217-228` derives a key with it on every encrypt and every decrypt. On this machine that is **1308 ms per derivation** (2^14 would be 175 ms). Running `backupCrypto.test.ts` and `backupRoutes.test.ts` *alone*, with the rest of the monorepo idle, takes **108 seconds for 30 tests**. Under the full parallel run they exceed even their hand-raised 30s budgets.

The suite has been absorbing this rather than fixing it. All three of `apps/api`, `apps/web` and `apps/mobile-companion` now carry a `testTimeout: 20_000` with a comment explaining that the parallel monorepo run made the previous budget flaky, and the backup tests then override that again to `30_000` inline. That is four escalations around one root cause.

`SCRYPT_N` is also asserted as a literal in `packages/shared/src/__tests__/backup.test.ts:44`, so there is currently no seam to lower it.

**Recommendation:**
- Make the scrypt cost injectable — e.g. `backupScryptParameters()` in `backup.ts` returning the production constants unless `VITANA_TEST_KDF_COST` is set. Keep `backup.test.ts:44` asserting the production value so the parameter choice is still guarded, and let `backupCrypto.test.ts` / `backupRoutes.test.ts` run at `N = 2**12`. That alone should return the suite to roughly its former runtime.
- Keep exactly one test that exercises the real cost factor end to end, so a misconfiguration that shipped `N = 2**12` to production would still fail.
- Once the runtime is back under control, walk the three `testTimeout: 20_000` values back down. They are currently masking whatever the *next* slow test will be.

---

# P2 — Should fix before the beta cut

<a id="f5"></a>
## 5. `.env.example` mislabels the database master key as a "session secret" — remediated 2026-09-01

`.env.example`:

```
# Session secret used to sign pairing tokens. Must be ≥16 chars.
VITANA_SECRET=
```

That is wrong in both halves. `VITANA_SECRET` does not sign pairing tokens — `pairing.ts:191` mints those from `randomBytes(32)` and never reads it. What `VITANA_SECRET` actually does is become the master key material for every profile's encrypted database, via `resolveStoreSecurityConfig` (`profileStoreManager.ts:723-731`) → `deriveProfileStorageKey` (`storage/profileKey.ts:16-21`):

```ts
return createHash("sha256")
  .update(keyNamespaces[purpose], "utf8")
  .update(profileId, "utf8").update("\0", "utf8")
  .update(passphrase, "utf8")
  .digest("base64");
```

A single unsalted SHA-256 pass. That is a perfectly good KDF when the input is the desktop's 256-bit random key, which is the path `secure-store-key.cjs:68` takes — and for the desktop app this is fine. It is not a good KDF for a human-chosen string, and the only guard is `configuredSecret.length >= 16`, which a documentation comment is actively encouraging users to satisfy with a passphrase. An attacker with a copy of the `.duckdb` file can then brute-force it at full SHA-256 speed, with no salt, no memory hardness, and no iteration count.

The inconsistency is stark next to `backupCrypto.ts`, which uses scrypt at N=2^17 to protect a *backup* of the same data.

`docs/API_CONTRACT.md:752` compounds the confusion by documenting `PAIRING_SECRET_REQUIRED` as "VITANA_SECRET not configured"; that error is actually raised by `createApp.ts:259-262` when the `x-pairing-secret` header is missing. Only `docs/ENCRYPTED_DUCKDB_ARCHITECTURE.md:45` describes the variable correctly.

**Recommendation:**
- Rewrite the `.env.example` comment to say what it is: the master key for encrypted health storage, that losing it means losing every profile, and that it must be generated (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`), not chosen.
- Raise the floor in `resolveStoreSecurityConfig` to reject anything that is not high-entropy — requiring 43 base64url characters, the same shape `decryptPersistedKey` already enforces at `secure-store-key.cjs:128`, closes the weak-passphrase path entirely and costs one regex.
- If human-chosen secrets must be supported for the Linux/headless path, run them through scrypt with a per-profile stored salt rather than widening `deriveProfileStorageKey`'s contract.
- Fix `docs/API_CONTRACT.md:752`.

**Resolution:** [`.env.example`](../.env.example) now describes `VITANA_SECRET` as the encrypted health-store master key and gives the correct `crypto.randomBytes(32).toString("base64url")` generation command. `resolveStoreSecurityConfig` requires a 43-character base64url secret with sufficient character diversity, and the API contract now correctly documents `PAIRING_SECRET_REQUIRED` as a missing `x-pairing-secret` header.

## 6. User-derived measurement codes are written to the unencrypted request log

`logger.ts:5-8` states the rule clearly:

> DO NOT log profile display names. They are the names of the household's people and pets, and the log file sits unencrypted beside the encrypted databases those names live in.

The reasoning is right and the display-name rule is honoured. But `log.request` (`logger.ts:95-102`) writes `request.path` verbatim, and `createApp.ts:132-146` calls it for every request. Several routes carry health-meaningful path segments:

- `dataRoutes.ts:203,217,231,244,253,262` — `/summary/:measurementCode[...]`
- `dataRoutes.ts:543` — `/observations/by-type/:measurementCode`

For registry codes that is harmless. But `measurementCode` is not always a registry code: `parserPrimitives.ts:303-305` mints one by slugifying arbitrary text off an imported document —

```ts
export function fallbackMeasurementCode(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")...
  return normalized ? `manual_${normalized}` : `manual_${cryptoId("marker_code")}`;
}
```

— so a lab marker line becomes `manual_hiv_1_2_antibody`, and viewing it writes that string into `VITANA_LOG_FILE`. `main.cjs:203` always sets that to `userData/logs/api.ndjson`. The existing log on this machine confirms the mechanism (`"msg":"GET /summary/weight 200 64ms"`); only the specific codes happen to be benign.

The rotation policy makes it worse rather than better: `maxLogFileBytes` keeps one prior generation, so the evidence persists across restarts in a file no one thinks of as health data — and which is exactly the file a user would attach to a bug report.

Separately, `redactMessage` is only applied on the `log.error` branch (`logger.ts:93`). `log.info` and `log.warn` write their message unredacted, so the module's stated redaction rule holds for one of its three levels.

**Recommendation:**
- Log the matched route pattern rather than the concrete path. Express exposes it as `request.route?.path` post-dispatch, or keep a small map; `/summary/:measurementCode` is exactly as useful for debugging and carries no data.
- Failing that, hash or elide any path segment matching `^(manual|body_comp)_`.
- Apply `redactMessage` in `write()` so it covers all three levels rather than in `log.error` alone.

## 7. The companion capability model is inert

`pairing.ts` defines fourteen capabilities (`:8-38`), `companionRouteCapabilities.ts` maps routes onto them, and `createApp.ts:286-292` enforces the match. That machinery reads as least-privilege. It is not: every pairing request is created with the complete set (`pairing.ts:170`):

```ts
capabilities: [...companionCapabilities],
```

and `approve` (`:181-200`) never narrows it. Worse, the persistence loader actively rejects anything narrower (`pairing.ts:105-114`):

```ts
record.capabilities?.length === companionCapabilities.length &&
companionCapabilities.every((capability) => record.capabilities.includes(capability)) &&
```

A record with a reduced capability set is silently dropped from the registry on restart. So the system cannot express a restricted companion today, and any future attempt to add one will fail in a confusing way — the device works until the API restarts, then quietly unpairs.

That means a paired phone — the credential for which lives on a device that can be lost or stolen — holds `entitlement:write`, `standalone:migrate` and `care:write` on the assigned profile, whether or not the user wanted a read-only dashboard.

**Recommendation:**
- Decide which of these is true and make the code say it. If every companion is fully trusted, delete the capability plumbing; it is ~60 lines plus a route table that currently buys nothing but the appearance of a control.
- If capability scoping is the intent (and given the mobile app is growing dashboards and read-only mirrors, it looks like it should be), then: replace the equality check at `:105-114` with a subset check against `companionCapabilities`, add a capability set to the approve call, and default new pairings to a read-only bundle with write capabilities opt-in at approval time. The approval UI already asks the owner to pick a profile; picking an access level is the same interaction.

## 8. Nothing in the app stack sets a Content-Security-Policy — remediated 2026-09-01

Restating 2026-08-09 F4 because it is still true. A repo-wide search for `content-security-policy` returns exactly two hits: the prior review that raised it, and `website/public/_headers`, which protects the marketing site. The application itself has none — not from `express.static` (`createApp.ts:326-331`), not as a `<meta>` in `apps/web/index.html`, and `apps/api/package.json` still has no `helmet`. The same applies to `x-content-type-options`, `referrer-policy` and `x-frame-options`.

This matters slightly more than it did three weeks ago because the manual owner-token fallback keeps a bearer token in `sessionStorage`, which a CSP would help contain.

**Recommendation:** set the headers once, in the Express layer, so both the desktop shell and any browser hitting the LAN port get them. `default-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'` is close to the website's policy and should need only a `style-src 'self' 'unsafe-inline'` concession for current inline styles.

**Resolution:** the static-serving branch in `createApp.ts` now applies a CSP (`default-src 'self'`, restricted image/connect/style/frame/base/form sources) plus `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `X-Frame-Options: DENY`. `browserSecurityHeaders.test.ts` verifies the SPA fallback response carries every header.

## 9. Restore is still fully synchronous and fully in memory — unchanged

Restating 2026-08-09 F2. The export half was fixed; the import half was not.

`backupMultipart.ts:9-11,87` buffers the upload to a single `Buffer` of up to `BACKUP_MAX_SIZE_BYTES` (100 MB). `backupCrypto.ts:295-296` then decrypts it whole and `gunzip`s to a single string, `:304-308` `JSON.parse`s that string, `backupPayloadSchema.safeParse` walks the entire object graph, and `backupRoutes.ts:239-244` hands `backupEntry.data` to `storeManager.restoreProfiles` in one piece.

Peak resident set is the upload buffer, plus the decompressed string, plus the parsed object graph — which for this shape of data is comfortably 5-10× the JSON — plus whatever `insertStore` builds on the way into DuckDB, all while DuckDB itself is capped at 64-256 MB (`duckdbRuntime.ts:268-269`). The largest local profile database here is 90 MB.

One thing did improve and is worth crediting: `DuckDbRepository.hydrate` no longer calls `snapshot()` for its digest check, using the streaming `digestBackupExportData` instead (`duckdbRepository.ts:234-238`). That removes one full copy from the peak.

**Recommendation:** unchanged from last time — stream the restore. The export side now has all the pieces (`profileExportPage`, the chunked digest); the import side needs a streaming JSON reader over the decompressed stream so profiles are inserted one page at a time rather than materialized whole.

## 10. Export now serializes every profile twice — remediated 2026-09-01

This is a new cost introduced by the F1 fix, and it is worth paying down before it becomes normal.

`backupRoutes.ts:102-103`:

```ts
await estimateBackupV1PlaintextSize(stores, { scope, createdAt, signal });
const encrypted = await createBackupV1Stream(stores, { passphrase, scope, createdAt, signal });
```

Both call `serializeBackupPayload`, which pages through `store.profileExportPage(collection, offset, 250)` for every collection of every profile (`backupCrypto.ts:186-197`). So a `scope: "all"` backup now reads the entire dataset out of DuckDB twice, canonically stringifies every row twice, and SHA-256s every row twice, to answer a question — "is this over 100 MB?" — that row counts can answer approximately for a tiny fraction of the cost.

The 2026-08-09 recommendation actually said this: *"a row-count-based estimate that refuses up front"*. The implementation chose exactness instead, which is correct but expensive.

**Recommendation:**
- Use `storageCounts()` (already cached behind `countsCache`, `duckdbRepository.ts:204`) with a conservative bytes-per-row constant to reject obviously-oversized exports before headers. Keep the existing mid-stream `limitPlaintextSize` guard as the exact backstop — it is now safe to rely on, because the up-front estimate makes reaching it rare.
- If exactness is preferred, stage the serialized plaintext to a temp file on the first pass and stream *that* into gzip/cipher on the second. One DuckDB read, one disk write, no double hashing.

**Resolution:** `estimateBackupV1PlaintextSize` now uses `ProfileRepository.storageCounts()` and a conservative per-record estimate. It no longer calls `profileExportPage`; the existing streaming plaintext and ciphertext limits remain the exact safety backstop.

## 11. The Windows release smoke gate never sends the owner token

`scripts/windows-desktop-smoke.ps1:82-96`:

```powershell
function Invoke-DesktopApi([string]$Method, [string]$Path, $Body, [string]$OwnerToken) {
  ...
    Headers = @{ Authorization = "******" }
```

`$OwnerToken` is declared and never used; the header is the literal string `******`. This looks like a secret-scrubbing pass that overwrote the interpolation instead of the value.

The caller at `:204-208` reads the real token out of `security.json`, validates its length, passes it in, and then asserts on the response:

```powershell
$enabledSettings = Invoke-DesktopApi "PUT" "/api/settings/desktop" @{ backgroundServiceEnabled = $true } $ownerToken
if (-not $enabledSettings.backgroundServiceEnabled) { throw ... }
```

`ownerTokenIsValid` compares buffer lengths first, so `******` cannot match a 43-character token — the request gets a 401 and the assertion throws. Either the full-scope gate is not being run in CI, or it is being run and its failure tolerated. Either way the release check for authenticated desktop settings is not testing what it claims, and the companion test at `windows-desktop-smoke.test.mjs:37-43` asserts on the literal placeholder, locking the bug in.

**Recommendation:** interpolate `$OwnerToken` into the header, keep it out of anything written to `$evidenceRoot`, and change the test to assert that the header is derived from the parameter rather than matching a fixed string.

## 12. The audit allowlist suppresses packages, not advisories

`.audit-allowlist.json:2-16` lists bare package names, and `scripts/audit-ci.mjs:50-70` filters on them. So once a package is listed, *every* future high or critical advisory against it passes silently — including one unrelated to whatever was originally triaged. The current audit output is entirely allowlisted (Expo/Metro/`image-size` findings), which means the gate cannot presently distinguish "the known, accepted set" from "something new arrived".

Combined with the fact that `audit:ci` has now been unable to reach the advisory endpoint for three reviews running, the practical state is that dependency advisories are unverified *and* the mechanism that would verify them is weaker than it appears.

**Recommendation:**
- Key allowlist entries on advisory ID plus package and version range, with a note and an expiry date.
- Fail the run on allowlist entries that no longer match anything, so stale suppressions get removed instead of accumulating.
- Run `npm run audit:ci` from a networked machine before the beta cut. This is the longest-standing unverified item in the project.

## 13. Companion credentials are not marked device-only in SecureStore

`apps/mobile-companion/src/endpointStore.ts:57-60,155,227` stores the device ID, companion token and pending revocation token with default `SecureStore` options, while `standalone/sqliteLocalStore.ts:97-100` correctly stores the database key with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`.

On Android today the practical difference is small (`allowBackup` is already false). It matters for the stated iOS plan: Keychain items without `ThisDeviceOnly` are included in encrypted iCloud backups and restored onto a *different* device, which would clone a paired companion's access to the PC without any re-pairing.

**Recommendation:** add `keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY` to `DEVICE_ID_KEY`, `TOKEN_KEY` and `PENDING_REVOCATION_KEY`. It is a one-line change per key and it is much cheaper to do before iOS exists than after.

## 14. The Health Connect resume marker is cleared before cursors are persisted

`syncHealthConnect.android.ts:400` calls `onSessionKey(null)` once uploads complete, but cursor advancement happens afterwards in `useHealthSourceSync.ts:66` via `updateHealthSourceCursors`. If the process is killed in that window — plausible on Android, where a long sync is exactly when the OS reclaims a backgrounded app — the next run starts with stale cursors *and* no session key, so it mints fresh batch IDs and re-uploads records the PC already acknowledged.

**Recommendation:** do not clear the session key inside `syncHealthConnect`. Let `updateHealthSourceCursors` clear it in the same write that advances the cursors, so the marker and the cursors can never disagree.

## 15. The standalone medication status filter queries a column that does not exist

`screens/CareScreen.tsx:405-415` offers Active/Past filters. `standalone/sqliteLocalStore.ts:1652-1658` implements them with a predicate on `end_date`. `standalone/migrations.ts:308-313` declares the medications table with `start_date`, `name` and `payload_json` — there is no `end_date` column.

So in standalone mode, choosing either filter should raise a SQLite error and fail the medications load. This is recent (the Status filter landed in `6be35a0`, the mobile medications page in `2821810`) and looks untested against the standalone path.

**Recommendation:** either promote `end_date` to a real column with an index, or read it via `json_extract(payload_json, '$.endDate')` and align the SQL with the existing `medicationMatchesStatus` logic so connected and standalone modes agree.

## 16. Standalone measurement detail applies adult reference ranges to every profile — remediated 2026-09-01

`standalone/localRepository.ts:210-216` resolves reference ranges from `this.defaultProfile.subjectKind`, which `createStandaloneRepository.native.ts:10-17` fixes to `adult`, even though `localRepository.ts:79-82` can switch the active dataset to another profile.

For a product whose distinguishing feature is that a household's children and pets each keep their own records, showing a cat or a six-year-old adult-human reference ranges on the detail screen is a correctness failure in the feature that justifies the multi-profile design.

**Recommendation:** load the active profile inside `healthDataDetail` and resolve ranges from its `subjectKind` and units, rather than from the repository's construction-time default.

**Resolution:** `healthDataDetail` and `healthDataChartSeries` now load the selected profile and pass its `subjectKind` to `resolveReferenceRange`. Detail-entry classifications now use that resolved range too. The standalone repository test verifies a selected child profile receives no adult glucose catalog range.

## 17. Manual numeric fields silently truncate malformed input

`SummaryPage.tsx:342-349,724-732`, `ManualImportFeature.tsx:341-345`, `ImportPage.tsx:370-377`, `UploadImportFeature.tsx:473-486` and `ImportDraftReview.tsx:146-152` accept health values through text-like inputs with `inputMode="decimal"` and parse them with `Number.parseFloat`. `Number.parseFloat("120abc")` is `120`, and `Number.parseFloat("1.2.3")` is `1.2`.

So a mistyped or pasted value is accepted and stored as a plausible-looking number with no warning. For manually entered blood pressure or glucose that is a silent data-integrity bug in the one input path where the user is the only source of truth.

**Recommendation:** validate with `Number(value)` (which rejects trailing garbage) or a strict decimal regex before saving, and surface a field-level error rather than coercing.

---

# P3 — Worth doing

## 18. Every god file grew, again

The 2026-08-09 review noted the split-opportunistically policy was losing ground. Measured against `c5912bba` (the last commit before that review):

| Lines then | Now | File |
|-----------|-----|------|
| 1874 | 2041 | `apps/api/src/storage/duckdbProjections.ts` |
| 1406 | 1657 | `apps/mobile-companion/src/standalone/sqliteLocalStore.ts` |
| 1056 | 1163 | `apps/api/src/storage/duckdbCommands.ts` |
| 994 | 1095 | `packages/shared/src/apiContract.ts` |
| 835 | 882 | `apps/api/src/storage/duckdbRepository.ts` |
| 620 | 740 | `apps/web/src/App.tsx` |
| 608 | 794 | `apps/web/src/features/care/CareRoute.tsx` |
| 1576 | 1576 | `packages/shared/src/registry.ts` |

Seven of eight grew; `registry.ts` is flat and is fine, because it is a data table where length is not complexity.

The one that has crossed from "large" to "genuinely over-concentrated" is `CareRoute.tsx` (+31%). It owns loading, filtering, editing, completing and deleting for care items, health events *and* medications in one component (`:79-97`, `:155-222`, `:311-408`). `App.tsx` and `SummaryPage.tsx` are large but cohesive and can be left alone.

**Recommendation:** split `CareRoute` into `useCareItems` / `useHealthEvents` / `useMedications` hooks plus separate list and editor panels. Leave the rest to the existing opportunistic policy — but the trend line says the policy is not currently producing splits, so it is worth agreeing a ceiling (say, 800 lines) that forces the decision rather than deferring it each time.

## 19. The pinned-HTTP native module is Android-only but imported unconditionally

`modules/vitana-pinned-http/expo-module.config.json:1-5` declares Android support only, and `src/VitanaPinnedHttpModule.ts:20` calls `requireNativeModule("VitanaPinnedHttp")` at module scope. That module is reached from `App.tsx:10`, `MobileApiProvider.tsx:35`, `api.ts:3` and `pinnedFetch.ts:2` — i.e. from app startup, not from a feature branch.

An iOS build will therefore throw during startup, not degrade gracefully. Given iOS is a stated goal and the custom instruction is to keep native features behind abstractions, this is the abstraction that is missing.

**Recommendation:** add a `.ios.ts` sibling that either implements pinning with `URLSessionDelegate` or throws a typed `PinnedHttpUnsupportedError` on first *use* rather than on import, and gate connected mode on a capability check.

## 20. The orphan sweep cannot match the largest orphans

`storage/orphanedTempFiles.ts:18-22` matches three PID-bearing patterns. Several full-size database copies do not have a PID in their name and are therefore never swept:

- `.pre-migration-<iso>` (`duckdbRuntime.ts:199-214`). Cleaned on migration success (`:164-166`) and on handled failure (`duckdbRepository.ts:281-284`), but a hard kill between the copy and either outcome leaves a full-size encrypted database behind permanently.
- `.pre-baseline-<ts>` (`dev/importProfiles.ts:173`) and `export-staging-<pid>-<ts>/` (`dev/exportProfiles.ts:68`) from the dev profile tooling.

On this machine `data/duckdb-storage` currently holds ~2.8 GB of these: three 639 MB `export-staging-*` directories, a 639 MB `.pre-baseline-*`, and two `.pre-schema-reversion-*` copies at 90 MB and 24 MB. All of them are encrypted health data the user would reasonably believe was deleted.

The dev-tool ones are a housekeeping annoyance. The `.pre-migration-*` one is on the production path, which is why this is listed at all.

**Recommendation:** add an age-based rule for the non-PID patterns — `.pre-migration-*` older than 24h with no migration in flight is unambiguously garbage — and have `export-staging-<pid>-*` directories match the existing PID rule by renaming them to the `.tmp-<pid>-<ts>` convention the sweep already understands.

## 21. The wire contract hard-caps a device to one profile

`packages/shared/src/apiContract.ts:137-142,179-184` types `allowedProfileIds` as a one-element tuple and caps assigned profiles with `.max(1)`. `pairing.ts:53` mirrors it.

For a household product this is the wrong shape: a parent's phone plausibly wants their own profile plus their child's plus the dog's. Changing a tuple to a bounded array is trivial now and a breaking wire change later.

**Recommendation:** move to `allowedProfileIds: string[]` with an explicit server-side limit while the contract is still unreleased.

## 22. `@vitana/shared` publicly exports a DuckDB runtime pin

`packages/shared/src/index.ts:19` re-exports `duckdbPin.ts`, so `apps/web`, `apps/mobile-companion` and `@vitana/api-client` all take a public dependency on a detail of the current storage engine. Given the stated intent to keep the DuckDB/SQLite swap cheap, this is the one place the abstraction leaks — the API's own `storage/` boundary is otherwise clean (verified: exactly one `duckdb`-named import outside `storage/`, and it is `ReplicaDeltaGapError`).

**Recommendation:** move the pin into the API workspace, or expose it as provider-neutral storage capability metadata.

## 23. The registry carries LOINC and FHIR references but no Health Connect / HealthKit identifiers

`packages/shared/src/types.ts:324-336` gives measurement types `loincCode` and FHIR-oriented fields, and the registry populates them well. There is no field for the Health Connect record type or a future HealthKit identifier, so that mapping lives implicitly in `healthConnectImport.ts:81-105` field names instead of in the registry.

Since interoperability with Health Connect and HealthKit is an explicit product goal and the iOS app will need the HealthKit half, encoding it as data now avoids writing the same mapping a second time in a different shape.

**Recommendation:** replace the flat code fields with a `standardReferences: { system: "loinc" | "fhir" | "health-connect" | "healthkit"; code: string }[]`, and drive the importer off it.

## 24. Standalone profiles still use the retired JSON-profile pattern — remediated 2026-09-01

`standalone/migrations.ts:85-88` stores the active profile as `profile_json`; `sqliteLocalStore.ts:349-354,421,465-471` writes and re-parses it whole. Profile attributes that the app branches on — `subjectKind`, `units` — are therefore invisible to SQL and to migrations, which is directly connected to finding 16.

**Recommendation:** promote `subject_kind`, `units` and `birth_date` to typed columns now, while there is no compatibility cost.

**Resolution:** local schema v11 adds typed columns for all profile fields used by the standalone store, including `display_name`, `setup_status`, `subject_kind`, `birth_date`, `units`, and structured optional profile data. The migration backfills those fields from legacy `profile_json`; subsequent inserts, dataset listings, and profile reads use the typed columns.

## 25. Popovers claim ARIA menu semantics without implementing them

`App.tsx:417-472`, `SummaryOverviewPage.tsx:158-173` and `CareRoute.tsx:667-700` use `role="menu"` / `role="menuitem"` but implement only Escape and outside-click. Opening leaves focus on the trigger, and arrow-key navigation is absent. A screen reader announces a menu and then the expected interaction does not work, which is worse than plain buttons would have been.

**Recommendation:** either implement the full pattern (focus first item on open, arrow-key roving tabindex, `aria-activedescendant`) or drop the menu roles and use a plain button list.

---

## Checked and found sound

Listed so they are not re-litigated next review.

- **The AI query path is properly defended.** `queryCompiler.ts` uses positional parameters throughout, `sqlIdentifier` (`:190-195`) is `^[A-Za-z0-9_]+$`, `escapeLikePattern` is applied to `LIKE` filters, and `aiQueryService.ts:83-86` runs `validateCompiledSql` — which is genuinely reachable, not dead code — before execution. Row and time-window caps are enforced at `:146-149`.
- **Cloud AI consent is real and enforced.** `privacy.ts:37-45` requires an explicit `providerScopeAccepted` plus a timestamp, and it is checked at both call sites (`queryRoutes.ts:26,55`, `insights.ts:25`). Rows and questions are sanitized before leaving the machine (`privacy.ts:19-35`).
- **The OpenRouter OAuth callback is safe despite being auth-exempt.** `createApp.ts:275` grants owner principal to `/settings/ai/openrouter/callback`, but `settingsRoutes.ts:205-212` requires an unexpired single-use `state` that only the authenticated `/connect` route can mint, and `callbackPage` interpolates only fixed strings.
- **The DuckDB runtime is hardened.** Community and unsigned extensions are disabled, autoload/autoinstall are off, `enable_external_access = false` and `lock_configuration = true` are set immediately after attach (`duckdbRuntime.ts:262-317`), the attach path is confined beneath a marked root (`:236-240`), and the encryption key format is validated (`:320-329`).
- **The storage abstraction has held.** One `duckdb`-named import outside `apps/api/src/storage/`, and `analyticsBackend.ts:73-83` refuses to hand DuckDB SQL to a non-DuckDB backend rather than failing later at parse time.
- **Electron process isolation and navigation guards are correct.** `contextIsolation`, `nodeIntegration: false`, `sandbox: true`, no preload IPC surface, `setWindowOpenHandler` and `will-navigate` present (`main.cjs:95-123`), certificate pinned (`:246-248`).
- **Mobile transport security is sound.** Android cleartext disabled and gated (`app.config.js:14-20,31-35`), `allowBackup` false, SQLCipher enabled (`:33,96-97`), and Android HTTPS verifies the scanned public key (`pinnedFetch.ts:27-31`, `VitanaPinnedHttpModule.kt:125-143`).
- **CI supply chain is above average.** Actions are SHA-pinned, no `pull_request_target`, `contents: read` by default with `contents: write` only on release jobs, and `prepare-duckdb-httpfs.mjs` verifies the downloaded extension's SHA-256 before writing it.
- **There are still zero `TODO`/`FIXME` comments** in `apps/*/src` or `packages/*/src`, and the only `console.log` calls outside tests remain in `apps/api/src/dev/`, where they are correct.
