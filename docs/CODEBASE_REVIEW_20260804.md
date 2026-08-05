# Pre-Beta Codebase Review

**Reviewed:** 2026-08-04
**Scope:** `apps/api`, `apps/web`, `apps/android-companion`, `apps/desktop`, `packages/shared`, `packages/api-client`, `scripts/`, root build & test config
**Goal:** find what is still cheap to change today and permanent once beta testers hold real encrypted profiles.

## Method

Unlike the 2026-07-29 review, this one ran the toolchain. `npm run typecheck` passes across all five workspaces, and `npm run test:core` is green at **109 files / 700 cases**. `npm run audit:ci` could not run — the review environment has no network access to the npm advisory endpoint — so dependency advisories are **unverified** in this pass and should be re-run locally before the beta cut.

Every finding below was re-derived from current source and verified by reading the code, not inherited from the prior review. Where an earlier backlog item turned out to be already fixed, it is called out as closed rather than repeated.

---

## Remediation status — 2026-08-05

The original findings below are retained as the point-in-time diagnosis. This table is the authoritative current status after the remediation pass.

| # | Status | Current implementation |
|---|---|---|
| 1 | **Resolved** | The API starts on `127.0.0.1` and serially rebinds the same port to `0.0.0.0` only while an active pairing challenge, pending request, or approved device requires LAN access. Rebind failure rolls back. The Windows installer is per-user and no longer installs an elevated firewall rule. |
| 2 | **Resolved** | Restore ownership is claimed immediately after owner authorization, before multipart parsing or decryption. Concurrent restore requests reach the route and return `409 RESTORE_IN_PROGRESS`; other requests receive maintenance mode. |
| 3 | **Resolved** | Backup creation pages each collection through `ProfileRepository`, emits canonical V1 JSON incrementally, and streams it through `createGzip()` and AES-256-GCM. Plaintext and encrypted output are bounded. |
| 4 | **Resolved** | Categories with an existing cursor advance after a successful empty read; categories with no prior cursor retain their backfill start. Focused tests cover both cases. |
| 5 | **Resolved** | Electron accepts the loopback certificate only when its fingerprint matches the TLS identity returned by the embedded API; mismatches fail closed. |
| 6 | **Resolved by invariant documentation** | The single-writer `enqueueMutation` boundary and the `firstOrdinal + index` reservation dependency are documented at both sides of the abstraction. A database sequence was intentionally not introduced. |
| 7 | **Resolved** | Query identifiers use a strict identifier grammar and runtime values are positional parameters carried by `CompiledQuery` into DuckDB execution. |
| 8 | **Resolved** | Browser CORS and local browser authentication now use an exact configured-origin allowlist rather than accepting arbitrary localhost ports. Native clients without an `Origin` remain supported. |
| 9 | **Resolved** | Inspect and restore accept bounded `multipart/form-data`; passphrases and restore decisions are body fields rather than request headers. |
| 10 | **Resolved** | SQLite acquisition separates pending opens from committed leases and closes partial handles on failure. Lease counts increment only after both databases are available. |
| 11 | **Resolved** | `ChunkBuilder` keeps exact running UTF-8 byte accounting and no longer serializes the accumulated chunk on each append/reset. |
| 12 | **Resolved** | Import source options hide Health Connect sync when no `HealthSourceProvider` is available. |
| 13 | **Resolved** | Transactions declare `TransactionImpact`; `countsCache` is invalidated only by mutations that can alter storage counts. |
| 14 | **Resolved for backup/export** | Portable backup no longer calls the whole-store snapshot and uses provider-neutral paged export methods. The legacy `snapshot()` remains for explicit non-backup full-export consumers. |
| 15 | **Resolved** | `apiErrorFromResponse` prefers structured JSON error parsing and retains a text fallback for non-JSON responses. |
| 16 | **Open** | `completedLocalDayRange` still uses the device's current local timezone, and the invariant is not yet documented next to the implementation. |
| 17 | **Resolved / confirmed** | Settings fetch failures render in `role="alert"` regions with retry actions; update failures also switch their live region to alert semantics. |
| 18 | **Ongoing by design** | The large files remain. Splitting continues opportunistically when a file is changed for functional work rather than as a standalone refactor campaign. |

Validation completed during remediation:

- Workspace typechecks and builds passed.
- Core suite: **112 files / 724 tests passed**.
- Focused remediation suites: **67 API**, **32 Android companion**, and **15 API-client** tests passed.
- Relevant backup/export integration and durability tests passed.
- Desktop suite: **57/57 tests passed**; desktop delivery checks: **10/10 passed**.
- The Android preview build completed successfully, closing the Kotlin pinned-HTTP compile-verification item.

---

## Executive assessment

The remediation work since 2026-07-29 landed and it shows. All 19 P1 findings from that review are genuinely resolved in the code, not just annotated: the schema is a single indexed, foreign-keyed, `TIMESTAMPTZ` baseline; units canonicalize at ingest; the whole-store replica snapshot is gone; reads run on a separate connection; the release workflow gates on `validate:fast`; the Android replica cache is a disposable file that rebuilds rather than migrates. Tiers 1–4 of the backlog are almost entirely struck through, and the strike-throughs check out against the source.

Two structural properties are worth protecting because they are what makes the rest of this tractable: storage genuinely sits behind `ProfileRepository` with a dialect-tagged `CompiledQuery`, and there are still **zero `TODO`/`FIXME` comments** anywhere in `apps/*/src` or `packages/*/src`.

So this review is short by design. The codebase does not have a broad quality problem. The remediation pass closed findings 1–15, confirmed finding 17 was already addressed, and leaves only the timezone invariant in finding 16 plus the intentionally ongoing file decomposition in finding 18.

### Do these first

| # | Finding | Current status |
|---|---|---|
| 1 | [Bind `127.0.0.1` and rebind only when paired](#f1) | **Resolved** |
| 2 | [Set the restore lock before the first `await`](#f2) | **Resolved** |
| 3 | [Make backup export streaming and non-blocking](#f3) | **Resolved** |
| 4 | [Advance sync cursors for empty categories](#f4) | **Resolved** |
| 5 | [Pin the loopback certificate instead of blanket-trusting it](#f5) | **Resolved** |

---

# P1 — Fix before beta testers have data

<a id="f1"></a>
## 1. The desktop app still binds `0.0.0.0` unconditionally

`apps/desktop/main.cjs:181` sets `process.env.HOST = "0.0.0.0"` before starting the embedded API, and `apps/api/src/server.ts:43` binds whatever it is handed. From the first launch — before any phone is paired, and for users who will never pair one — port 4317 answers on every interface the machine has.

This is the one item the 2026-07-29 review explicitly deferred (Tier 0, item 4), and it is still the highest-severity thing in the repo. It also blocks two other decisions that are already queued behind it: the `perMachine: false` switch in `docs/WINDOWS_RELEASE.md` is held back because the elevated `netsh` firewall rule is currently load-bearing, and it only needs to be load-bearing because the bind is unconditional.

The authorization layer is not the problem — companion routes are capability-scoped and the local-auth nonce is sound. The problem is exposure surface: an unpaired install has no reason to be reachable at all, and a beta tester on a café or coworking network will not know it is.

**Recommendation:** Bind `127.0.0.1` at startup. Bind a second listener on `0.0.0.0` only while at least one pairing record exists, and drop it when the last pairing is revoked. Then flip `perMachine: false` and delete the `netsh` rule.

<a id="f2"></a>
## 2. The restore mutex is set after three `await`s, so it does not exclude

`apps/api/src/routes/backupRoutes.ts:243-247` checks `activeRestoreId` and then assigns it. But the handler has already awaited body collection and `decryptBackup(body, passphrase)` (line 222) before reaching that point. Decryption of a real backup is not fast. Two restore requests arriving inside that window both find `activeRestoreId` undefined, both set it, and both proceed — the second overwrites the first's id, so the `finally` at line 289 (`if (activeRestoreId === restoreId)`) leaves the flag set forever after the first one finishes.

The outcome is two concurrent restores writing the same profile databases through two separate journals, and a permanently stuck `RESTORE_IN_PROGRESS` afterwards. This is a data-destruction path, not a nuisance.

**Recommendation:** Take the lock immediately after the owner-authz check, before any `await`. Release it in the same `finally`.

<a id="f3"></a>
## 3. Backup export materializes and compresses the whole profile synchronously

`apps/api/src/storage/duckdbExport.ts:41-68` reads every table into JS arrays; `apps/api/src/backupCrypto.ts:91` then calls `gzipSync` on the serialized result. For the ~152,000-row profiles this project already has locally, that is a multi-hundred-megabyte peak holding the array form, the JSON string, the gzip output, and the ciphertext at once — and `gzipSync` blocks the event loop for the duration, so every other request including the companion's sync stalls behind it.

Phase 10 already moved the audit write out of the mutation queue so backups do not block *writes*. This is the other half: it still blocks *everything*.

**Recommendation:** Page the export by table, pipe through `zlib.createGzip()`, and encrypt as a stream. Failing that, at minimum swap `gzipSync` for the callback/promise form so the loop stays live.

<a id="f4"></a>
## 4. A category that stops producing records never advances its cursor again

`apps/android-companion/src/syncHealthConnect.ts:401-405` advances `advanced[descriptor.category]` only for categories in `categoriesWithRecords`. The intent is visible in the user-facing string at line 418 — "The sync start date was kept for those categories" — and for a category that has *never* produced data that is right, because it preserves the backfill window.

But it does not distinguish that case from a category that produced data for months and then stopped, which is what happens when a user uninstalls the app that was writing to Health Connect, swaps watches, or revokes a single writer. That category's cursor is now frozen at its last productive sync and every subsequent sync re-reads the entire span from there to now, forever, growing without bound. On battery and on a phone radio.

**Recommendation:** Track whether the category has ever had a cursor. If it has, advance it on an empty read — the window was successfully queried, which is what the cursor records. Only categories with no cursor yet should hold their start date.

---

# P2 — Fix soon

## 5. Loopback certificate verification is unconditionally successful {#f5}

`apps/desktop/main.cjs:166-168` returns `0` from `setCertificateVerifyProc` for any certificate presented by `127.0.0.1` or `localhost`. The API mints and pins a self-signed certificate already (the TLS test asserts a restart reuses it rather than reminting), so the fingerprint is available — the renderer just is not checking it. Right now TLS between the window and the embedded API is encryption without authentication.

**Recommendation:** Compare the certificate fingerprint against the pinned one and return `-3` on mismatch. This is also the mechanism the LAN listener in finding 1 will need.

## 6. Ordinal assignment is `firstOrdinal + index` over a counted base

`apps/api/src/storage/duckdbRows.ts:143-156,181-195,224-231` assigns ordinals positionally from a caller-supplied base. Writes are serialized through `enqueueMutation` in `duckdbHealthStore.ts`, so this is correct today — but the safety is entirely a property of the queue, not of the schema, and nothing in `duckdbRows.ts` says so. A future caller that reaches the repository directly, or a second process opening the same profile, collides on the `UNIQUE` constraint.

**Recommendation:** Either document the queue as the invariant at the `insertRows` call sites, or move ordinal generation into the database with a sequence. The latter also survives the SQLite swap.

## 7. `sanitizeIdentifier` admits `.` and `-`, and values are interpolated

`apps/api/src/queryCompiler.ts:179-187` strips everything except alphanumerics, underscore, hyphen and dot. The surviving `.` is the interesting one: an identifier containing a dot is a qualified reference in both DuckDB and SQLite. Today the compiled output puts the metric inside a string literal escaped by `sqlString` (line 186), so it is a value rather than an identifier and the practical risk is low. But the function is *named* for identifier sanitization and will eventually be used where an identifier goes, and the whole pipeline exists to execute plans derived from LLM output.

The surrounding controls are good — `MAX_ROW_LIMIT = 200` is applied on every branch, external access is disabled, and reads go to the read connection. This is about the blocklist being the wrong shape for the job, not about a live exploit.

**Recommendation:** Bind filter values as parameters rather than interpolating, and restrict the identifier character class to `[A-Za-z0-9_]`.

## 8. CORS accepts any origin on any localhost port

`apps/api/src/createApp.ts:113` allows `https?://(127.0.0.1|localhost):\d+` with `credentials: true`. Any other local service the user runs — a dev server, another Electron app, a browser extension's local helper — can issue credentialed requests. Owner-token checks catch most of it, but the origin allowance is doing no work here and is worth narrowing while the port set is still known.

**Recommendation:** Allow only the packaged web origin and the Vite dev port, or drop origin trust entirely and rely on the owner token plus nonce.

## 9. The backup passphrase travels in a request header

`apps/api/src/routes/backupRoutes.ts:139` reads `x-backup-passphrase`. Headers are the most-logged part of an HTTP request; anything that ever sits in front of this — and finding 1 means something on the LAN might — sees it. Body placement is strictly better for no cost.

**Recommendation:** Move it into the request body.

## 10. Lease counting increments before both databases are open

`apps/android-companion/src/standalone/sqliteLocalStore.ts:86-103` increments `databaseLeases` first, then opens the durable database, then the replica. If the replica open throws, the catch decrements the lease — but `sharedDatabase` stays resolved. The next acquire skips the durable open, increments again, and the accounting now describes a state that does not exist. Under enough retries a release can close a handle another caller holds.

**Recommendation:** Increment only after both opens resolve.

## 11. `ChunkBuilder` re-serializes to measure

`apps/android-companion/src/syncHealthConnect.ts:459,487` stringifies each value to size it, and `reset()` re-stringifies the accumulated chunk for its base size. On a 365-day first sync this is the hot loop, and it is quadratic in chunk length.

**Recommendation:** Keep a running byte total and compute the chunk's constant base size once at module scope.

## 12. The "Sync" import source is offered where no provider exists

`apps/android-companion/src/screens/ImportScreen.tsx:112-128` lists the `sync` source unconditionally, with copy that already branches on `Platform.OS`. `healthSourceProvider.ts:31` correctly returns `undefined` off Android, which was the whole point of the `HealthSourceProvider` seam — but the screen does not consult it, so on iOS the tile is present and tapping it fails. iOS is not a target yet; fixing it now costs one filter and stops the seam from rotting.

**Recommendation:** Hide the tile when `activeHealthSourceProvider()` is undefined.

## 13. `countsCache` is cleared by every transaction

`apps/api/src/storage/duckdbRepository.ts:810,824` clears the cache around every write regardless of whether the write can change a count. During a Health Connect backfill of dozens of chunks, each chunk forces the next reader to re-run six `COUNT(*)` scans over growing tables.

**Recommendation:** Have `transaction()` invalidate only when the declared entity set is non-empty, or adjust counts from the changes it already knows about.

---

# P3 — Worth doing, not urgent

14. **`snapshot()` and the export path still assume whole-store reads** (`duckdbExport.ts`), which is at odds with the project's own "no full profile reads" rule. Folding finding 3 in is the natural time to fix the shape too.
15. **`apiErrorFromResponse` reads `.text()` then `JSON.parse`s it** (`packages/api-client/src/index.ts:344-348`) rather than preferring `.json()`. Harmless, one extra copy of the error body.
16. **`completedLocalDayRange` buckets by device-local time** (`syncHealthConnect.ts:979-989`). Correct by intent, but a timezone change mid-sync shifts boundaries. Worth a comment stating the invariant.
17. **Fetch failures are not announced to screen readers** on `apps/web/src/pages/SettingsPage.tsx:93` and siblings — errors land in state with no `role="alert"` region.
18. **The god files persist.** `duckdbProjections.ts` (1638), `registry.ts` (1319), `sqliteLocalStore.ts` (1240), `apiContract.ts` (1025), `syncHealthConnect.ts` (1025), `ImportScreen.tsx` (944), `TrackDetailScreen.tsx` (920), `SummaryPage.tsx` (744), `MobileApiProvider.tsx` (672). This was Tier 5 item 61 and remains the right call: split them opportunistically as each is opened for something else, not as a campaign.

---

# Carried forward from 2026-07-29

These were deferred rather than missed. Their current status is:

- **Tier 5 item 44 — Open:** generate the SQL allowlist from the schema, or test it against `information_schema`.
- **Tier 5 item 48 — Open:** sweep rate-limiter buckets on a timer; document that the state is process-local.
- **Tier 5 item 52 — Open:** converge TypeScript majors (root/api/web on 5.x, android-companion/website on 6.x).
- **Tier 5 item 54 — Open:** add and enforce `expiresAt` on `.audit-allowlist.json` entries.
- **Tier 5 item 58 — Open:** drop the dead purchase gating, unlink `react-native-iap`, remove `react-native-nitro-modules`, and move web-only packages out of production `dependencies`.
- **Kotlin pinned-HTTP cancellation — Closed:** the Android preview build completed successfully after the implementation.

# Closed since the last review

Spot-checked and confirmed fixed, so they should not be re-litigated: the Health Connect permission set in `app.config.js:35-51` now matches `HEALTH_SOURCE_CATEGORIES` exactly (Tier 0 item 1 — the only Tier 0 entry besides the LAN bind that was still open); the `SELECT * EXCLUDE` occurrences are gone in favour of the `duckdbColumns.ts` registry; `CompiledQuery` carries its dialect; the replica cache is a separate rebuildable file.

# Strengths worth protecting

- Storage abstraction is real, not aspirational — the dialect-tagged compiled query and `storage/types.ts` are what will make the SQLite swap a week rather than a quarter.
- Zero `TODO`/`FIXME` in production source across six workspaces.
- 700 tests over 109 files that run in a couple of minutes, with integration and durability split out. This matches the stated goal of a fast, robust suite over a large one; resist growing it for coverage's own sake.
- `validate:fast` / `validate:all` are a genuinely usable gate, and the release workflow now runs one.

# Suggested sequencing

**Before the next tester build:** re-run `npm run audit:ci` with network access; dependency advisories remain unverified by this review.

**Next quiet week:** document or harden the timezone invariant in finding 16, then take the carried Tier 5 items in risk/order-of-effort priority.

**Opportunistically:** continue the finding 18 file splits as those modules are opened for functional changes.