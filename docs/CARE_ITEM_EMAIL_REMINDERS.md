# Local-first care-item email reminders

## Status

Proposed design for issue #181. Research was last checked on 7 August 2026. This
document defines the implementation boundary; it does not enable email sending.

## Decision

Use a desktop-local worker to submit a generic transactional email when a
care-item reminder becomes due. Do not use Vitana-hosted infrastructure, the
mobile companion, Brevo Contacts, or Brevo's future scheduling as the source of
truth.

The worker will:

- read a bounded reminder projection from each explicitly identified local
  profile database;
- keep scheduling, attempts, deduplication, and status in that profile's
  encrypted database;
- obtain the provider credential from Electron `safeStorage`, outside the
  profile database and renderer;
- submit only the recipient address and generic message content to Brevo; and
- reconcile on desktop startup, resume, network recovery, care-item mutation,
  and a low-frequency timer.

This preserves the local encrypted database as the only durable scheduler and
keeps provider and platform details outside the reminder domain.

## Current application boundaries

- `CareItem.reminderAt` is already an optional ISO timestamp, persisted as
  `care_items.reminder_at TIMESTAMPTZ`.
- Care-item access already goes through `ProfileRepository`; DuckDB is an
  implementation detail behind that interface.
- Each profile has a separate encrypted DuckDB database. The worker must open a
  store by immutable `profileId`, never repeatedly resolve the mutable active
  profile while processing a batch.
- Electron already supports an opt-in background/tray mode launched at login,
  and already wraps secrets with OS-backed `safeStorage`.
- The mobile companion is profile-scoped and can consume API projections, but
  must not receive the provider credential or become a sender.

The existing `careItemReminderAt` helper subtracts days with the host
JavaScript timezone. It is not sufficient for the new feature because a host
timezone change and DST transition can alter the intended wall-clock time.

## Brevo investigation

### Future scheduling and cancellation

`POST /v3/smtp/email` accepts `scheduledAt`, but Brevo permits a send to be
scheduled only up to 72 hours in advance. A pending scheduled email can be
retrieved or deleted by its `messageId` or `batchId`; Brevo does not document an
in-place reschedule operation, so an edit requires delete and recreate.

That window is too short for care planned weeks or months ahead. Staging jobs
with Brevo shortly before they are due would also disclose the recipient and
message earlier, create a remote/local cancellation race, and require local
reconciliation anyway. The first implementation will therefore send
immediately when the local job is due and will not use `scheduledAt`.

Brevo scheduling remains a possible later, explicitly reviewed optimization,
not a fallback scheduler.

### Recipient and retained data

A transactional request accepts an inline `to` address. The recipient does not
need to be created as a Brevo Contact, and Vitana must not create one.

Brevo's transactional logs contain delivery events and identifying message
metadata, including recipient and subject. Brevo also offers stored message
previews. Logs are retained indefinitely by default unless the account owner
configures a retention rule; the documented configurable period is 1–24
months. Preview storage should be set to **Never store previews** in the Brevo
account, and the shortest operationally acceptable log retention should be
selected. These account settings reduce exposure but do not change the fact
that Brevo processes the recipient and message.

The settings UI must disclose that Brevo receives:

- recipient email address;
- configured sender address;
- generic subject and body;
- submission time and delivery metadata; and
- a random provider/idempotency identifier.

When one Brevo account is shared by several local profiles, its logs correlate
all recipient addresses under that account and sender. Per-profile database
isolation cannot prevent this provider-side association; disclose it during
setup and include it in the privacy/DPA review.

It must not receive the profile ID or name, care-item ID, kind, title, due date,
notes, provider/clinician details, medication, diagnosis, or other health data.
Use a fixed message such as:

> **Subject:** Vitana Health reminder  
> Open Vitana Health on your local device to review an upcoming reminder.

Do not include tracking links or provider tags containing local identifiers.
Disable open and click tracking for these messages where Brevo account/template
settings permit it.

### Authentication, limits, and idempotency

Brevo API keys are sent in the `api-key` header and are not granularly scoped.
The `transactional.email:write` permission belongs to Brevo's OAuth model, not
to ordinary API keys. Until a suitable desktop OAuth flow is designed, use a
dedicated Brevo account/API key where practical, wrap the key with Electron
`safeStorage`, never expose it to renderer code, and provide local replace and
revoke instructions.

Brevo publishes endpoint rate limits and limit/reset response headers. Reminder
volume is expected to be far below those limits, but the provider adapter must
honour `429` and `Retry-After`/reset information.

Brevo supports an `idempotencyKey` in the transactional request's `headers`
object, but its documented deduplication lifetime is only 30 minutes. Persist
and reuse that key for short retries, while treating local delivery state as
the durable restart boundary. Exactly-once delivery cannot be guaranteed
across an ambiguous network failure after the provider's idempotency window.

### Sources

- [Schedule batch sendings](https://developers.brevo.com/docs/schedule-batch-sendings)
- [Send a transactional email](https://developers.brevo.com/reference/send-transac-email)
- [Delete a scheduled email](https://developers.brevo.com/reference/delete-scheduled-email-by-id)
- [API key authentication](https://developers.brevo.com/docs/api-key-authentication)
- [OAuth scopes](https://developers.brevo.com/docs/oauth-scopes)
- [API limits](https://developers.brevo.com/docs/api-limits)
- [Transactional log and preview management](https://help.brevo.com/hc/en-us/articles/360021533839-Manage-your-transactional-logs-and-email-previews)
- [Custom transactional retention](https://help.brevo.com/hc/en-us/articles/4415743225746-Configure-a-custom-retention-period-for-your-transactional-logs-and-email-previews)
- [Email-event retention FAQ](https://help.brevo.com/hc/en-us/articles/19317424653586-FAQs-About-the-data-retention-policy-for-email-events)

Brevo plan limits and account controls can change. Verify them in a test
account before enabling production sending.

## Provider-neutral contracts

Keep these concepts independent:

```text
ReminderScheduler
  reconcile(profileId, reason, now)

ReminderRepository
  listDue(profileId, now, limit)
  claim(profileId, jobId, expectedVersion, lease)
  recordAccepted(...)
  recordRetry(...)
  recordPermanentFailure(...)
  supersedeForCareItem(...)

EmailProvider
  send(GenericEmailRequest, ProviderCredential, idempotencyKey)

CredentialStore
  read/write/delete provider credential

BackgroundHost
  startup, resume, connectivity-restored, shutdown
```

`ReminderRepository` belongs beside `ProfileRepository`. Its DuckDB adapter
owns SQL and transactions; neither the scheduler nor provider may import a
DuckDB connection. A later SQLite adapter must implement the same claim and
state-transition contract.

Use the platform `fetch` implementation initially rather than adding a Brevo
SDK dependency. The small adapter needs only the transactional send endpoint,
strict timeouts, bounded response reads, and sanitized error mapping.

## Configuration model

Email reminders require all of the following opt-ins:

1. Instance setting: provider configured and email reminders enabled.
2. Profile setting: recipient, IANA timezone, catch-up policy, and consent
   timestamp.
3. Care-item setting: email delivery enabled for this reminder.
4. Desktop setting: background operation enabled if the user expects delivery
   while the window is closed.

Store the API key only as a wrapped OS secret in desktop user data. Store the
profile recipient and reminder preferences in that profile's encrypted
database. Store only non-secret provider status and a masked recipient in
general desktop settings/API responses.

The care-item opt-in should be provider-neutral (for example, channel
`"email"`), not named after Brevo. Removing `reminderAt`, disabling email,
completing/cancelling/skipping/deleting the item, deleting the profile, or
revoking profile consent makes the job ineligible.

The profile timezone is an IANA identifier. For an opted-in reminder, persist
the canonical wall-clock intent (local date/time, IANA timezone, and lead rule)
as well as the derived `reminderAt` UTC instant. `reminderAt` remains the
bounded-query and API convenience field, but the wall-clock intent is the
source for recalculation. Renderer writers and the worker must use the same
shared resolver rather than independently deriving timestamps.

The UI must show the resolved local time and UTC offset. Use calendar arithmetic
in the selected timezone:

- a nonexistent DST wall time advances to the first valid time;
- an ambiguous wall time uses the earlier occurrence; and
- changing the selected timezone recalculates unsent jobs and increments their
  version.

The default behavior is a fixed profile timezone; changing the desktop's
timezone alone does not move a reminder. When changing the profile timezone,
the UI must ask whether unsent reminders keep their UTC instant or keep their
wall-clock time. The latter replaces the timezone in their canonical intent,
resolves a new UTC instant, and supersedes the old job. Timers are only wake-up
hints: persisted UTC instants and reconciliation decide eligibility, which also
protects against clock jumps.

## Minimum durable state

Add provider-neutral tables to each encrypted profile database. Exact names may
follow the migration conventions, but the logical model is:

### Profile notification preference

- channel and enabled flag;
- recipient address;
- IANA timezone and timezone behavior;
- missed-reminder grace period;
- consent version and timestamp; and
- created/updated timestamps.

### Reminder delivery

- random job ID;
- care-item ID and channel;
- canonical hash of the relevant care-item and reminder configuration (care
  items do not currently have a version field);
- resolved scheduled UTC instant and catch-up deadline;
- state: `pending`, `leased`, `accepted`, `retry_wait`, `failed`,
  `missed`, or `superseded`;
- attempt count, next attempt time, lease owner/expiry;
- stable random idempotency key;
- provider message ID after acceptance;
- accepted timestamp; and
- sanitized last error category/code/timestamp.

Keep a small append-only attempt table if product support needs history:
attempt number, start/end timestamps, outcome, HTTP status/error category, and
retry time. Never store the API key, raw provider response, recipient, email
body, or care-item content in attempt rows or logs.

Indexes must support a bounded query on `(state, next_attempt_at)` and lookup by
`care_item_id`. The due projection should return at most 100 rows and only the
fields needed to validate and send a generic email. It must not hydrate a full
profile or export `HealthStoreData`.

## Scheduling and state transitions

1. A care-item create/update transaction upserts or supersedes its delivery
   row in the same profile database.
2. Reconciliation queries due `pending`/`retry_wait` rows in bounded pages.
3. Claiming uses an atomic compare-and-set on job ID, configuration hash,
   state, and an expired-or-empty lease.
4. Immediately before network I/O, re-read the bounded care-item projection
   and verify profile ID, open status, reminder opt-in, configuration hash, and
   time.
5. Submit the fixed generic message with the persisted idempotency key.
6. Atomically record `accepted` and the provider message ID before processing
   another job.
7. On restart, reclaim expired leases. Never submit an `accepted`,
   `superseded`, `missed`, or permanently `failed` job.

Mutations and the final eligibility check must run through the same
per-profile serialized write boundary. A cancellation that commits before the
provider call starts prevents that call. No system can recall a request already
accepted by a provider; the UI should describe this narrow race accurately.

Use exponential backoff with full jitter for network failures, timeouts, `408`,
`429`, and `5xx`, respecting a longer provider retry time. A starting policy is
1 minute, capped at 6 hours, with no more than 8 automatic attempts and no
attempt after the catch-up deadline. Treat authentication, malformed request,
and invalid-recipient responses as permanent until configuration changes.

For a timeout or connection loss after request submission:

- retry with the same provider idempotency key within its 30-minute window;
- if acceptance remains unknown when that window expires, set a locally
  visible `failed` state with outcome `delivery-unknown`;
- do not automatically resend with a new key, because avoiding a duplicate is
  safer than silently sending twice; and
- allow an explicit user retry, warning that delivery may already have
  occurred.

The default catch-up window lasts until the care item is due, capped at seven
days after `reminderAt`. Thus a one-day reminder can catch up for at most one
day and a one-week reminder for at most seven days. If the item has no due
instant, use the seven-day cap. After the deadline, mark the job `missed`
instead of sending an obsolete "upcoming" reminder.

## Desktop lifecycle

Use the existing opt-in Electron background/tray process for the first
Windows implementation:

- reconcile after encrypted stores and credentials are available at startup;
- reconcile on Electron `powerMonitor` resume;
- reconcile when connectivity returns, where detectable;
- run an unreferenced, low-frequency safety timer;
- schedule a short timer for the next due instant, but never rely on it as
  durable state; and
- stop accepting work, await or safely expire leases, then checkpoint stores
  during shutdown/update.

Behavior is explicit:

| Desktop state | Behavior |
| --- | --- |
| Window closed, background enabled | Tray process continues and sends due jobs. |
| Fully quit or user not logged in | No send; startup reconciliation applies the catch-up rule. |
| Asleep/hibernating | No wake request; reconcile on resume. |
| Offline/provider unavailable | Persist retry with bounded backoff. |
| Clock/timezone changed | Reconcile from persisted state; recalculate only when the selected timezone policy requires it. |

Do not install a Windows Service. It complicates per-user DPAPI access,
installation, UI ownership, and database locking. Do not create one Windows
Scheduled Task per care item. It duplicates scheduler state outside the
encrypted database and makes edits, profile deletion, and upgrades harder to
make atomic. Revisit a single per-user scheduled launcher only if real-world
testing shows login/tray startup is inadequate.

`BackgroundHost` keeps domain logic portable. Windows uses the existing login
item and Electron power events; Linux can use the existing XDG autostart path
and Secret Service; macOS can later use login items and Keychain after its
packaged runtime is validated.

## UI and API boundary

Desktop/web settings should provide:

- provider setup, replace/remove credential, and generic test email;
- explicit privacy/retention disclosure and consent;
- profile recipient and timezone behavior;
- care-item email opt-in;
- background-delivery requirement and current background status; and
- local status: scheduled time, masked recipient, accepted/retrying/failed/
  missed/superseded, last attempt, and safe corrective action.

Do not return the API key or full recipient after saving. Keep provider setup
owner-only. Test sends use the same generic body and provider adapter but a
separate idempotency key and local audit outcome.

The mobile companion may later read a profile-scoped, sanitized reminder status
and update the care-item opt-in through the local PC API. It must not receive
credentials, call Brevo, retain a second delivery queue, or independently
schedule/send reminders. Offline mobile configuration is out of scope for the
first implementation.

## Security and observability

- Allow only HTTPS to the fixed Brevo API origin and never accept a provider
  base URL from care/profile data.
- Redact `api-key`, recipient, request/response bodies, and provider errors
  before structured local logging.
- Log random job ID, profile-local outcome category, attempt number, duration,
  and retry time; do not log health or message content.
- Bound request time, response size, concurrency, query page size, attempts,
  and backoff.
- Keep one worker leader per desktop instance and use database leases as the
  final concurrency guard.
- A profile deletion must stop its in-memory work before closing/removing its
  database.
- No public webhook is needed. Local status means provider acceptance, not
  guaranteed inbox delivery; adding an internet callback solely for delivery
  events would violate the first implementation's local-only boundary.

## Implementation phases

### 1. Contracts and time calculation

- Add shared provider-neutral reminder preference/status contracts, including
  canonical local date/time, IANA timezone, lead rule, and derived UTC instant.
- Replace host-timezone date subtraction with an IANA-zone calculation and
  explicit DST disambiguation.
- Add unit tests for normal dates, offsets, DST gaps/overlaps, device timezone
  changes, invalid zones, and catch-up deadlines.

### 2. Repository and migrations

- Add notification preference, delivery, attempt, and index migrations.
- Extend the repository interface with bounded projection and atomic state
  methods; implement them in a DuckDB-specific adapter.
- Integrate create/update/complete/delete with job upsert/supersession.
- Add integration tests proving profile isolation, bounded reads, transaction
  rollback, compare-and-set claims, and cancellation.
- Add durability tests for a crash before/after claim, expired-lease recovery,
  accepted-state restart, edits, completion, and profile deletion.

### 3. Worker and provider

- Implement the provider-neutral scheduler and a minimal Brevo adapter.
- Implement OS-wrapped provider credential storage in Electron.
- Connect startup, tray, resume, connectivity, timer, and shutdown lifecycle.
- Add fake-clock/fake-provider tests for ordering, concurrency, backoff,
  `Retry-After`, short-window idempotency, ambiguous outcomes, clock jumps, and
  missed reminders.

### 4. Settings and care UI

- Add owner-only provider setup/test/removal and privacy disclosure.
- Add per-profile recipient/timezone/catch-up settings and per-item opt-in.
- Show masked, sanitized local status and actionable failures.
- Verify keyboard, screen-reader, and narrow viewport behavior.

### 5. Mobile read-only status

- Only after desktop sending is stable, expose the sanitized profile-scoped
  projection through the local PC API.
- Keep credentials, provider operations, and delivery persistence on the PC.

## Release gates

Before enabling the feature:

- verify the cited Brevo behavior and account retention/tracking settings with
  a non-production account;
- complete a privacy/DPA review for each intended release region;
- test Windows login startup, close-to-tray, quit, sleep/resume, hibernate,
  offline recovery, update shutdown, and multi-profile deletion;
- demonstrate no full-profile read in worker traces;
- demonstrate no duplicate after restart and a safe `delivery-unknown` outcome;
- scan persisted files and logs to confirm the API key, recipient, and health
  content are absent outside their approved stores; and
- keep sending behind an explicit, default-off feature flag until soak testing
  is complete.
