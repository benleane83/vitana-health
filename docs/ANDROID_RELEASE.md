# Android Production Release

This runbook applies to the Play Store Android companion. It defines the release owner, versioning rules, EAS environment separation, and the release checks required before production submission.

## Ownership and credentials

The release owner is responsible for executing this runbook and recording the release in the repository's release notes.

- Google Play App Signing must be enabled for `app.vitanahealth` before the first production submission.
- The Play upload credential is managed by Google Play and the authorized EAS/Expo account or CI secret store. Do not commit a keystore, upload key, service-account JSON, or access token.
- Access to the EAS project and the Play Console production track is limited to release owners.
- Production submissions require the public privacy-policy URL and completed Play Console declarations described in the privacy release work.

## Versioning

The release owner owns the user-visible application version in `apps/mobile-companion/app.config.js`.

- Increment `expo.version` for every Play Store release. Use semantic versioning: patch for compatible fixes, minor for user-visible compatible features, and major for incompatible changes.
- EAS owns the Android `versionCode` because `cli.appVersionSource` is `remote` in `apps/mobile-companion/eas.json`.
- The production and preview profiles both have `autoIncrement: true`; every build receives a new, monotonically increasing Android version code. Do not set or reuse an Android version code locally. Preview needs this as much as production: two testers on the same `expo.version` are otherwise indistinguishable in a bug report. The app shows the version code next to the marketing version, for example `Version 1.2.0 (57)`.
- The `development` profile deliberately does not auto-increment, because a development client is rebuilt constantly and its version code carries no reporting value.
- Record the `expo.version`, EAS Android version code, EAS build URL, commit SHA, and Play release name in the release notes.
- `runtimeVersion` is an explicit string that is **decoupled from `expo.version`**. It describes the native layer an OTA update can safely land on, not the marketing version.

### The `runtimeVersion` bump rule

Bump `expo.runtimeVersion` to the next integer **if and only if** the JavaScript bundle can no longer run on the previously shipped binary. In practice that means any of:

- a native module added, removed, or upgraded to a version with a changed native interface;
- an Expo SDK upgrade;
- a change to `expo-build-properties`, permissions, or anything else under `expo.android` that alters the built APK/AAB;
- a change to the standalone SQLite schema that an older binary could not read back.

Do **not** bump it for JavaScript-only changes — that is the whole point of the explicit string. A bump means every existing install stops receiving OTA updates until it takes the new binary from the Play Store, so it must be a deliberate decision recorded in the release notes.

## Environment and update separation

| Purpose | EAS build profile | Distribution | Update channel | Network policy |
| --- | --- | --- | --- | --- |
| Local native development | `development` | Internal development client | `development` | Cleartext allowed only for this profile |
| Device/QA testing | `preview` | Internal APK | `preview` | HTTPS required |
| Play Store | `production` | Signed AAB | `production` | HTTPS required |

- Never publish a production update to `preview`, or a preview update to `production`.
- Cleartext HTTP is enforced by three independent switches: `android.usesCleartextTraffic`, the network security config, and the `__DEV__` guards in `syncHealthConnect` and `PairScreen`. Two automatic gates keep them in agreement. `app.config.js` throws at build time if `VITANA_ALLOW_CLEARTEXT=1` is set on any EAS profile other than `development`, so a misconfigured preview or production build fails in EAS rather than shipping. `assertTransportSecurity` repeats the check at startup for release builds produced outside EAS, and surfaces it through the app error boundary as a readable screen.
- Store development, preview, and production EAS environment variables separately in the Expo dashboard or CI secret store. Production values must be reviewed before each release.
- The companion obtains its paired server address at runtime. Do not embed a production server URL, pairing token, private key, or certificate fingerprint in the app configuration or EAS environment.
- A native change requires a new build. This includes Expo configuration, Android permissions, native modules, SDK upgrades, and dependencies that alter native binaries. JavaScript/TypeScript-only changes may use an OTA update only when they are compatible with the installed runtime version.

## Production build and submission

The initial Play closed test is intentionally free. Keep
`PURCHASE_GATING_ENABLED` set to `false` for that build. The bundled Play Billing
support remains inactive and Scan and Sync stay available without a purchase.
Record the billing state in the release notes so the tested behavior is explicit.

Before the first billing-enabled build, create a managed one-time product in Play Console with
the product ID `scan_sync_unlock` and activate it for the app. Add license tester accounts, then
exercise purchase, cancellation, pending payment, acknowledgement, reinstall, and restore using
Google's test payment methods; license testers are not charged. Enable gating only in a new,
versioned AAB and return that artifact to closed testing before promotion. Do not activate billing
for an existing free-test binary through an EAS Update.

Run these commands from the repository root after the version bump is committed:

```powershell
npm ci
npm run typecheck
npm run build
npm test
npm run audit:prod:android
npm run build:android:production -w apps/mobile-companion
```

The production EAS profile intentionally omits `android.buildType: "apk"`; EAS produces an Android App Bundle (AAB) for Play submission. Download the signed AAB only from the recorded EAS build.

Before uploading, confirm the EAS build details show the expected commit, production channel, `VITANA_ALLOW_CLEARTEXT=0`, user-visible version, and auto-incremented Android version code.

Upload the AAB to the Play Console internal testing track first. Promote the exact tested artifact through closed testing and then production; do not rebuild between successful test-track validation and promotion.

## Reviewer demo mode

Reviewers can inspect the Dashboard and Track experience without installing or pairing the PC application:

1. Open **Connection** from the top-right of any main tab.
2. Turn on **Demo mode**.
3. Browse the read-only sample profile, dashboard metrics, Track categories, trends, history, and pagination.

Demo mode does not contact a local PC, alter pairing credentials, or write sample records. Import, report scanning, manual entry, and Health Connect sync remain unavailable because they require a paired PC or native health provider. Turning Demo mode off restores the existing paired connection, if present.

Local-only use is separate from Demo mode. It stores the user's local profile and imported health records in a SQLCipher-encrypted database on the phone. Turning Demo mode off reopens the same local profile and data when the phone is not paired.

## Release checklist

### Every release

- [ ] `apps/mobile-companion/app.config.js` has the intended new `expo.version` and the commit is merged/tagged.
- [ ] `expo.runtimeVersion` has been reviewed against the bump rule under "Versioning" — bumped if the native layer changed, left alone if the change is JavaScript-only — and the decision is recorded in the release notes.
- [ ] `PURCHASE_GATING_ENABLED` matches the intended release state, and that state is recorded in the release notes.
- [ ] EAS project access and Play Console production-track access are limited to authorized release owners.
- [ ] Play App Signing is enabled and no signing material is present in the repository or build logs.
- [ ] Development, preview, and production EAS environments are distinct; production has no development-only values.
- [ ] Repository checks pass: workspace typecheck, build, tests, and Android production dependency audit.
- [ ] Production AAB build completes with a new remote Android version code, `production` channel, and cleartext disabled.
- [ ] The exact AAB is tested on a physical Android device with the phone assigned to a profile different from the PC active profile: Dashboard refresh, Track search/detail/pagination, Care lists and offline read-only behavior, manual import, both camera/gallery scan types and row exclusion, HTTPS certificate-pin validation, Health Connect selected-category/cursor sync, revoke/disconnect, PC restart, maintenance, and offline recovery.
- [ ] Local-only use is tested by importing data, force-closing and relaunching the app, and confirming the same profile and records remain. Turning Demo mode on and off also restores usable persisted data.
- [ ] Health Connect is tested with a 30-day window and a window over 30 days. The extended run requests `READ_HEALTH_DATA_HISTORY`; the 30-day run does not request extended history access.
- [ ] Report drafts clear on backgrounding, cancellation, commit, and disconnect; small and large accessibility font scales remain usable.
- [ ] Storage inspection confirms that report images, OCR text, and review drafts are not persisted; the paired Dashboard, Track, and Care replica and local health records exist only in the SQLCipher-encrypted database; its key remains in device-only SecureStore; and unpairing removes the identity-bound replica.
- [ ] EAS Update traffic is inspected to confirm update requests contain no personal health records, and Play Data Safety answers match Expo's current disclosure for the shipped SDK version.
- [ ] Reviewer Demo mode works without network access, exposes Dashboard and Track sample data, blocks all import actions, and preserves any existing paired connection when turned off.
- [ ] A production-compatible OTA update is tested on the production channel only, or the release notes state that no OTA update is included.
- [ ] Play Console metadata, content rating, Data Safety, and Health apps/Health Connect declarations are completed from `docs/PLAY_DATA_SAFETY.md` and `docs/HEALTH_CONNECT_DECLARATION.md`; they match `docs/HEALTH_CONNECT_DATA_INVENTORY.md` and the released binary.
- [ ] The public privacy policy at `https://vitanahealth.app/privacy` is linked from the companion and matches `docs/HEALTH_CONNECT_DATA_INVENTORY.md`.
- [ ] The release starts on the internal testing track; crash/ANR, policy, and tester feedback are reviewed before staged production rollout.
- [ ] Release notes include the commit SHA, EAS build URL, Expo version, Android version code, Play release name, billing state, rollout percentage, and approver.

### Billing-enabled releases only

- [ ] Cached entitlement handling cannot permanently retain ownership after an authoritative online Play query reports no active purchase; the offline grace policy is defined and tested.
- [ ] The active `scan_sync_unlock` managed one-time product is tested with Play license testers for purchase, cancellation, pending payment, acknowledgement, refund/revocation, reinstall, offline expiry, and restore.
- [ ] Existing free-test users either become locked or are grandfathered according to the documented launch decision, without losing access to existing health data.
- [ ] Purchase metadata handling is reflected in the privacy policy and Play Data Safety answers.
- [ ] Billing is enabled in a new versioned AAB, and that exact artifact completes internal and closed-track testing before promotion; billing is not introduced by OTA update.

## Rollback

- Halt the Play production rollout immediately if a release is unsafe or fails policy review.
- Disable or roll back any incompatible EAS Update on the `production` channel using the EAS dashboard or CLI.
- Publish a corrective AAB with a higher Android version code. Google Play does not permit reusing a version code or replacing an already-uploaded binary.
- Record the incident, affected versions, remediation, and follow-up validation in the release notes.