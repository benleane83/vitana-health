# Pre-Beta Codebase Review

**Reviewed:** 2026-08-09
**Scope:** `apps/api`, `apps/web`, `apps/mobile-companion`, `apps/desktop`, `packages/shared`, `packages/api-client`, `scripts/`, `.github/workflows/`, root build & test config
**Goal:** confirm the 2026-08-04 remediation held, and find what is still cheap to change before beta testers hold real encrypted profiles.

## Method

This pass ran the toolchain, like the 2026-08-04 review did.

- `npm run typecheck` passes across all five workspaces.
- `npm run test:core` is green at **130 files / 832 tests** (was 112/724). The suite grew ~15% in a week and still finishes in about a minute, so the "fast and robust over large and complex" goal is intact.
- `npm run test:integration` could not complete: `server.integration.test.ts` requires the prepared DuckDB `httpfs` extension, which needs `npm run prepare:duckdb -w @vitana/api` and therefore network access this environment does not have. 34 tests passed, 51 skipped, 1 file failed on the missing prerequisite. This is an environment limitation, not a defect.
- `npm run audit:ci` again could not reach the npm advisory endpoint. **Dependency advisories remain unverified for the second review running.** This is now the longest-standing unverified item in the project and should be re-run locally before the beta cut.

Every finding below was derived from current source and verified by reading the code. Where a claim did not survive verification it was dropped rather than reported — several plausible-looking issues in the pairing rate limiter, the `measurement_code` indexes, the `sqlIdentifier` grammar, and the `provider` filter length bound turned out to be already handled, and are listed under "Checked and found sound" so they are not re-litigated next time.

---

## Executive assessment

The 2026-08-04 remediation genuinely held. Spot-checking findings 1–15 against source confirms they are still fixed, not regressed: the identifier grammar in `queryCompiler.ts:183` is now `^[A-Za-z0-9_]+$`, filter values are positional parameters, `browserOriginPolicy.ts` is an exact allowlist, backup creation streams through `createGzip()` and AES-256-GCM, the multipart body carries the passphrase instead of a header, and `hydrateHealthEventRows` batches its child lookups with a single `IN (...)` per table instead of per-row queries. There are still **zero `TODO`/`FIXME` comments** in `apps/*/src` or `packages/*/src`, and the only `console.log` calls outside tests are in `apps/api/src/dev/`, which is a CLI surface where they are correct.

So the code has no broad quality problem, and this review is again short by design. What it did find clusters into three themes.

**First, backup and restore are now asymmetric.** Finding 3 last time was "export blocks and materializes"; it was fixed for export only. Restore still does `gunzipSync` → `JSON.parse` → whole-store `hydrate` entirely in memory and entirely on the event loop. Worse, the streaming export's own size ceiling is enforced *mid-stream, after response headers are sent*, so the only available remedy is destroying the socket — which hands the user a silently truncated `.vitana` file. For a local-first health app whose backup is the user's only copy, that is the highest-severity item in the repo.

**Second, the Electron shell is hardened at the process boundary but not at the navigation boundary.** `contextIsolation`, `nodeIntegration: false`, and `sandbox: true` are all correct, and the certificate is now pinned. But there is no `setWindowOpenHandler` and no `will-navigate` guard, and there is no Content-Security-Policy anywhere in the stack — not from the API that serves the SPA, not as a `<meta>` in the web app.

**Third, the god-file backlog is losing ground.** The "split opportunistically, not as a campaign" policy from findings 18/61 was the right call, but a week of functional work moved the numbers the wrong way in every file but one.

### Do these first

| # | Finding | Severity |
|---|---|---|
| 1 | [Backup export truncates silently when it hits its own size ceiling](#f1) | P1 |
| 2 | [Restore is still fully synchronous and fully in memory](#f2) | P1 |
| 3 | [The Electron window has no navigation or window-open guard](#f3) | P1 |
| 4 | [Nothing in the stack sets a Content-Security-Policy](#f4) | P2 |
| 5 | [Oversized uploads are read to completion before being rejected](#f5) | P2 |

---

# P1 — Fix before beta testers have data

<a id="f1"></a>
## 1. Backup export truncates silently when it hits its own size ceiling

`apps/api/src/backupCrypto.ts:100,107,129` enforces `BACKUP_MAX_SIZE_BYTES` (100 MB, `packages/shared/src/backup.ts:27`) on both the plaintext and the emitted ciphertext, by throwing `BackupTooLargeError` from inside the generator that is already being piped to the response.

`apps/api/src/routes/backupRoutes.ts:124-133` sets `content-type`, `content-disposition`, and `res.status(200)` *before* `await pipeline(encrypted, res)`. So by the time the ceiling is hit, headers are sent, and the catch block at line 130 can only do:

```
if (res.headersSent) { res.destroy(); return; }
```

The browser has already been told this is a `200 OK` attachment named `vitana-backup-<name>-<timestamp>.vitana`. It has already begun writing that file to the user's Downloads folder. The connection then drops mid-body. Detection depends entirely on how strictly the client treats a truncated chunked response, and the desktop shell's own download path is not the same code as a browser's. The realistic outcome is a file on disk that looks like a backup, is named like a backup, and is not restorable.

This is not hypothetical headroom. The 100 MB limit is on the **plaintext** JSON, and this project already has local profiles around 152,000 rows. A multi-profile `scope: "all"` backup is the obvious first thing to cross it.

Two things are wrong and both need fixing:

**Recommendation:**
- Estimate the export size before sending headers. `backupExportMetadata()` and `storageCounts()` already exist and are cheap; a row-count-based estimate that refuses up front with a proper `413 BACKUP_TOO_LARGE` is far better than discovering it at byte 100,000,001.
- If the ceiling is still hit mid-stream despite the estimate, do not rely on socket destruction alone. `recordExportAudit()` is already correctly skipped on this path — extend the same idea by making the format self-verifying, so a truncated file fails fast and loudly at restore rather than looking plausible. The `VITANA` header plus GCM tag means a truncated file already fails authentication, but it fails with `BACKUP_DECRYPTION_ERROR` — the generic "wrong passphrase or corrupted file" message. A user who typed the right passphrase will conclude their passphrase is wrong.
- Reconsider whether 100 MB is the right ceiling at all, or whether the real fix is that a streaming format should not need one.

<a id="f2"></a>
## 2. Restore is still fully synchronous and fully in memory

Finding 3 of the last review was fixed for export. The mirror image was not touched.

`apps/api/src/backupCrypto.ts:278` calls `gunzipSync(decrypted, { maxOutputLength: BACKUP_MAX_SIZE_BYTES })` — up to 100 MB of decompression on the event loop in one call. Line 287 then `JSON.parse`s that entire string, and `backupPayloadSchema.safeParse` walks the whole object graph. `apps/api/src/routes/backupRoutes.ts:161,217` calls this for both inspect and restore, and `apps/api/src/storage/profileStoreManager.ts:244-259` then holds the resulting `HealthStoreData` in memory and passes it whole to `DuckDbHealthStore.hydrate`.

Peak resident memory is the 100 MB buffer, plus the decompressed string, plus the parsed JS object graph — which for this shape of data is comfortably 5–10× the JSON size — plus everything `insertStore` builds on the way into DuckDB. And `DuckDbRepository.hydrate` at `duckdbRepository.ts:222` then calls `repository.snapshot()` to read the *entire profile back out* for digest comparison, doubling it again.

Maintenance mode (`createApp.ts:154-165`) bounds the availability damage — other requests get a clean 503 rather than hanging. So this is a memory and reliability finding, not an availability one. But restore is exactly the operation a distressed user runs on a machine that may already be low on resources, and an OOM here is the single worst possible time for one.

**Recommendation:** Page the restore the way the export was paged. `backupExportPage()` and the canonical V1 collection framing already exist on the write side; the read side needs the same treatment — stream-decrypt, stream-decompress, and insert per collection inside the staged database, rather than materializing `HealthStoreData`. The whole-store `snapshot()` digest check in `hydrate` should become an incremental per-collection digest at the same time.

<a id="f3"></a>
## 3. The Electron window has no navigation or window-open guard

`apps/desktop/main.cjs:90-108` creates the main `BrowserWindow`. The process-boundary hardening is correct and deliberate — `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, no preload, and certificate pinning now enforced via `certificate-pin.cjs`. That is a genuinely good baseline.

What is missing is the navigation boundary. There is no `setWindowOpenHandler` and no `will-navigate` listener anywhere in the file. Any `target="_blank"` link, any `window.open`, and any `location.assign` in the renderer will be honoured — either navigating the main window away from `https://127.0.0.1:<port>` or opening a second Electron window pointed at an arbitrary origin. That second window inherits the app's chrome and gets no pinned-certificate treatment.

The renderer's content is not fully first-party. `MarkdownText.tsx` renders LLM output, and `aiQueryPlanner` can be pointed at a cloud model. That is a content path where a hostile string reaching a link is plausible enough to warrant the two handlers that every Electron hardening guide asks for.

The launch nonce makes this slightly worse than the general case: `main.cjs:108` puts it in the URL fragment, and the renderer stashes it in session storage. A same-window navigation to an attacker origin is a navigation *within the session storage origin boundary* only if the origin matches — it does not — so the nonce itself is safe. But the window is no longer the app.

**Recommendation:** Add both handlers. Deny window-open by default and route `http`/`https` to `shell.openExternal`; on `will-navigate`, `preventDefault()` anything whose origin is not `https://127.0.0.1:<port>`.

---

# P2 — Fix soon

<a id="f4"></a>
## 4. Nothing in the stack sets a Content-Security-Policy

`apps/api/src/createApp.ts:327-328` serves the built SPA with `express.static` and a catch-all. There is no `helmet` dependency in `apps/api/package.json`, no `res.setHeader("content-security-policy", ...)` anywhere in `apps/api/src`, and no `<meta http-equiv="Content-Security-Policy">` in the web app. The same is true of `x-content-type-options`, `referrer-policy`, and `x-frame-options`.

The good news first: there is **no `dangerouslySetInnerHTML`, no `innerHTML`, and no `eval` in `apps/web/src` or `apps/mobile-companion/src`**. React's default escaping is doing the real work and doing it well, which is why this is P2 and not P1.

But CSP is the control that limits blast radius when the primary control fails, and this app has an LLM output path rendering into a shell that will happily fetch remote resources. `frame-ancestors 'none'`, `object-src 'none'`, and a `connect-src` restricted to `self` cost nothing here — the app is local-first and does not legitimately load third-party subresources, so the policy can be unusually strict.

**Recommendation:** Set a strict CSP and the three companion headers on the static route. Given the app never loads cross-origin assets, start from `default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'` and widen only where the build demonstrably needs it. Prefer explicit `setHeader` calls over adding `helmet` — the dependency is not worth it for four headers, and the project's own convention favours not adding libraries.

<a id="f5"></a>
## 5. Oversized uploads are read to completion before being rejected

`apps/api/src/backupMultipart.ts:75-82`:

```
stream.on("limit", () => { fileTooLarge = true; });
stream.on("data", (chunk) => { size += chunk.length; if (!fileTooLarge) chunks.push(chunk); });
```

Busboy's `fileSize` limit is correctly configured at line 39, and once tripped the chunks are correctly discarded rather than accumulated — so there is no memory exhaustion here. But the stream is never destroyed and the request is never aborted. The server reads the remaining bytes off the socket and throws them away. A 5 GB upload is fully transferred before the client learns it was rejected at 100 MB.

Rate limiting bounds this (`backupRoutes.ts` restricts restore attempts), and the attacker must be authenticated as owner, so the practical severity is low. But this is a one-line fix and the LAN listener from finding 1 of the last review means the socket is not always loopback.

**Recommendation:** Destroy the file stream and the request in the `limit` handler, and settle the promise with the existing `FILE_TOO_LARGE` error immediately rather than waiting for `end`.

## 6. The pairing polling secret never expires and is never rotated

`apps/api/src/pairing.ts:156` mints a 256-bit polling secret; `getStatus` at line 216 accepts it forever. The pairing *record* expires (line 305, `prune()`), which bounds the pending window — but once a pairing is approved, the record is retained and the polling secret keeps working against it indefinitely. Line 220-225 does correctly deliver the token exactly once and null it out, so the secret cannot re-fetch a token. Its residual value is status disclosure on a pairing that already exists.

The severity is genuinely low, and the token-delivery one-shot is the control that matters and is present. What makes it worth an entry is shape rather than exploitability: a credential with no expiry, in a store that persists to disk (line 351), on a component whose whole purpose is short-lived bootstrap.

Related, and more likely to bite in practice: `PairScreen.tsx:156` polls `/api/pairing/status` every 5 seconds, and `createApp.ts:149` gives the *entire* `/api/pairing` prefix a shared 30-request/minute bucket. A polling companion consumes 12 of those 30 per minute by itself. Two phones pairing simultaneously, or one phone plus an owner refreshing the pending list, will hit the limiter during a normal flow.

**Recommendation:** Expire the polling secret when the pairing resolves, or give it the same lifetime as the record. Separately, give `/api/pairing/status` its own bucket sized for a 5-second poll, so status polling cannot starve `/api/pairing/request`.

## 7. The god files grew in every case but one

The last review listed these and correctly declined to run a decomposition campaign. One week later, measured against that review's own numbers:

| File | 2026-08-04 | 2026-08-09 | Δ |
|---|---|---|---|
| `apps/api/src/storage/duckdbProjections.ts` | 1638 | **1956** | +318 |
| `packages/shared/src/registry.ts` | 1319 | **1584** | +265 |
| `apps/mobile-companion/src/standalone/sqliteLocalStore.ts` | 1240 | **1496** | +256 |
| `apps/mobile-companion/src/screens/TrackDetailScreen.tsx` | 920 | **1134** | +214 |
| `apps/mobile-companion/src/syncHealthConnect.android.ts` | 1025 | **1048** | +23 |
| `packages/shared/src/apiContract.ts` | 1025 | **1078** | +53 |
| `apps/mobile-companion/src/MobileApiProvider.tsx` | 672 | **736** | +64 |
| `apps/web/src/pages/SummaryPage.tsx` | 744 | **760** | +16 |
| `apps/mobile-companion/src/screens/ImportScreen.tsx` | 944 | **805** | **−139** |

`apps/api/src/storage/duckdbCommands.ts` also joined the list at **1107**.

`ImportScreen.tsx` is the proof the policy works when applied — it shrank while being worked on. Everything else grew, which means the "split it when you open it for functional work" rule is being stated but not practised. The policy is still right; it just needs to actually happen.

**Recommendation:** Keep the policy, but make it enforceable rather than aspirational: treat these nine files as a checklist, and require that any PR touching one of them leaves it no larger than it found it. `duckdbProjections.ts` at 1956 lines is the one to take first, because it is the file most likely to be reopened for the SQLite evaluation.

## 8. The Linux release path never runs the core test suite

`.github/workflows/release-windows.yml:53` runs `npm run validate:fast`, which covers typecheck, build, `test:core`, and `test:desktop`. That gate was added in response to the last review and it works.

`.github/workflows/package-linux.yml` runs `npm run build`, `npm run test:desktop`, and `npm run test:integration` — but never `npm run test:core`. `.github/workflows/release-linux.yml` then verifies the artifact hash against graphical evidence and stages it, without running any tests of its own. So a Linux AppImage can be built, smoke-tested in GNOME, and staged on a draft release without the 832-test core suite ever having run against that commit on that platform.

In practice `ci.yml` runs `test:core` on every push, so a tagged commit has almost certainly been covered. "Almost certainly" is the problem: the Windows path does not rely on that inference and the Linux path should not either.

**Recommendation:** Add `npm run test:core` to `package-linux.yml`, or replace the build/test steps there with `validate:fast` for symmetry with Windows.

## 9. `LIKE` wildcards in the provider filter are not escaped

`apps/api/src/queryCompiler.ts:465-468`:

```
clauses.push("LOWER(COALESCE(provider, '')) LIKE LOWER(?)");
parameters.push(`%${filters.provider}%`);
```

The value is bound as a parameter, so this is not an injection. The Zod schema bounds it to 120 characters (`aiApiContract.ts:29`), so it is not a DoS either. But `%` and `_` inside the user's own string are still interpreted as wildcards, so a provider filter of `_` matches every single-character provider and a filter of `%` matches everything. Since the DSL is generated from LLM output, an unintended wildcard is a plausible way to silently widen a query the user thought was narrow.

**Recommendation:** Escape `%`, `_`, and the escape character in the value, and add `ESCAPE '\'` to the clause.

---

# P3 — Worth doing, not urgent

10. **The storage abstraction still leaks dialect in three specific places.** `duckdbRuntime.ts` hardcodes `TIMESTAMPTZ` throughout the schema DDL; `duckdbProjections.ts:944,952,961,970,980` calls DuckDB's `timezone()` function; `duckdbRows.ts:98-103` mixes `INSERT OR IGNORE` with `ON CONFLICT ... DO UPDATE`. None of these is a defect today — the abstraction boundary at `ProfileRepository` and the dialect-tagged `CompiledQuery` are real and hold everywhere else. But these three are the concrete work items a SQLite swap would hit first, and they are worth naming now so the estimate is honest. Extracting a `timeInZone(column, tz)` helper and parameterizing the schema DDL by backend would remove most of it.

11. **`snapshot()` and `duckdbExport.ts:178-179` still read `immunizations` and `medication_administrations` whole.** This is the last of the whole-store reads and it is bounded in practice — the only production caller is `DuckDbRepository.hydrate`, which is a whole-store operation by nature. Worth folding into finding 2's rework rather than fixing separately. Note that the *paged* read path is already correct: `hydrateHealthEventRows` at `duckdbProjections.ts:1641-1655` batches both child lookups into one `IN (...)` query each.

12. **`closeDatabase` closes the read connection before detaching.** `duckdbRuntime.ts:361-378` awaits `readConnection.close()` first; if that rejects, the `DETACH` never runs and the write connection stays open on the encrypted file. On Windows that means a locked file the app cannot reopen. Wrap the detach and both closes so every handle is attempted regardless of earlier failures.

13. **`completedLocalDayRange` still buckets by device-local time and the invariant is still undocumented.** `apps/mobile-companion/src/syncHealthConnect.android.ts:1002-1012`. This was finding 16 last time and the only item the last remediation pass left open. It is a two-line comment; it has now survived two reviews.

14. **The audit allowlist still has no expiry.** `.audit-allowlist.json` lists twelve packages under a `notes` field that says "remove these entries when the active Expo/React Native release train ships compatible fixes", with no `expiresAt` on any entry and no enforcement in `scripts/audit-ci.mjs`. Carried from Tier 5 item 54. Given `audit:ci` has now been unverifiable in two consecutive reviews, the allowlist is the only thing standing between the project and an unnoticed advisory.

15. **TypeScript majors still diverge.** Root, `apps/api`, `apps/web`, `packages/*` are on `^5.8.3`; `apps/mobile-companion` is on `~6.0.3`. Carried from Tier 5 item 52. `packages/shared` is consumed by both, so the two compilers must agree on its emitted `.d.ts` forever.

16. **`react-native-iap` and `react-native-nitro-modules` are still production dependencies.** Both are in `apps/mobile-companion/package.json:35-36`, and the purchase surface behind them (`entitlementService.ts:64` — `async purchase(): Promise<void> {}`) is a no-op stub on the default path. Carried from Tier 5 item 58. Two native modules in every build for a feature that does nothing yet.

17. **`react-dom` and `react-native-web` are production dependencies of the mobile app.** `apps/mobile-companion/package.json` lists both under `dependencies`. They exist for `preview:web`, which is a development affordance. Also carried from Tier 5 item 58, and also two extra packages in a shipped Android bundle.

18. **A few React nits worth a pass when the files are next opened.** `Charts.tsx` recomputes tick and reference-range derivations on every render without `useMemo`; `MarkdownText.tsx` keys list items by array index. Neither is a live bug — the chart inputs are small and the markdown list is not reordered — but both are in files on the god-file list and would be free to fix while there.

---

# Checked and found sound

These looked like findings and are not. Recorded so the next review does not spend time on them:

- **Pairing bootstrap routes are rate limited.** `createApp.ts:149` mounts `rateLimit` on the `/api/pairing` prefix at line 149, well before the inline `POST /api/pairing/request` (line 236) and `GET /api/pairing/status/:id` (line 258) handlers. Express applies prefix middleware in mount order, so both are covered. (The bucket is undersized — see finding 6 — but it exists.)
- **`measurement_code` is indexed.** `duckdbRuntime.ts:562,563,602` create composite indexes on `observations(measurement_code, observed_at)`, `time_series_samples(measurement_code, end_at)`, and `measurement_aggregates(measurement_code, end_at)`. These are better than the single-column indexes a reviewer would suggest, because the projection queries order by the second column.
- **`sqlIdentifier` is strict.** `queryCompiler.ts:183` is `^[A-Za-z0-9_]+$` and throws on anything else. The permissive `.`/`-` grammar from the last review is gone.
- **Filter values are bound, not interpolated.** Every `filters.*` branch in `queryCompiler.ts:462-468` pushes to `parameters`. Only `LIMIT` is interpolated, and only from `capLimit()`, which is `Math.min(requested, MAX_ROW_LIMIT)` over a Zod-validated integer.
- **The `provider` filter is length-bounded** at 120 characters by `aiApiContract.ts:29`.
- **Backup export and restore size ceilings are symmetric.** `limitPlaintextSize` caps the plaintext at 100 MB on the way out (`backupCrypto.ts:129`) and `gunzipSync`'s `maxOutputLength` caps it at the same value on the way in (line 278). A backup that was successfully written will not fail restore on size. (What happens when the ceiling is *hit* is finding 1.)
- **The token comparison is timing-safe and the length check does not weaken it.** `createApp.ts:177-183` guards `length >= 24` and `length ===` before `timingSafeEqual`, which is the standard and correct construction — the length of a token is not a secret.
- **No XSS sinks.** Zero occurrences of `dangerouslySetInnerHTML`, `innerHTML`, or `eval` across `apps/web/src` and `apps/mobile-companion/src`.

# Strengths worth protecting

- The last remediation pass held completely. Fifteen findings closed a week ago are all still closed. That is not the usual outcome and it is worth noting explicitly.
- Storage abstraction remains real rather than aspirational. The three leaks in finding 10 are specific and enumerable, which is exactly the position you want to be in before a provider swap.
- Still zero `TODO`/`FIXME` across six workspaces, and `console.log` confined to `apps/api/src/dev/`.
- 832 tests over 130 files, up 15% in a week, still running in about a minute, with integration and durability split out. The suite is growing with the features rather than as a coverage exercise.
- Electron process hardening (`contextIsolation`, `sandbox`, no preload, pinned certificate) is a strong baseline; finding 3 is the one gap in an otherwise deliberate posture.
- The backup format is authenticated — AES-256-GCM with the header as AAD — so tampering and truncation are cryptographically detectable. Finding 1 is about the *message* on that path, not the absence of the check.

# Suggested sequencing

**Before the next tester build:** findings 1 and 3. Finding 1 because a silently truncated backup is unrecoverable and the user will not know until they need it; finding 3 because it is two handlers and closes the last Electron gap. And re-run `npm run audit:ci` with network access — advisories are now unverified across two consecutive reviews.

**Next quiet week:** finding 2 (paged restore), then findings 4, 5, and 8, which are all small and independent.

**Ongoing:** finding 7. Pick `duckdbProjections.ts` first and hold the line that a PR touching a listed file does not grow it.
