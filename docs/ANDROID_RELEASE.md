# Android Production Release

This runbook applies to the Play Store Android companion. It defines the release owner, versioning rules, EAS environment separation, and the release checks required before production submission.

## Ownership and credentials

The release owner is responsible for executing this runbook and recording the release in the repository's release notes.

- Google Play App Signing must be enabled for `com.localfitnessadvisor.companion` before the first production submission.
- The Play upload credential is managed by Google Play and the authorized EAS/Expo account or CI secret store. Do not commit a keystore, upload key, service-account JSON, or access token.
- Access to the EAS project and the Play Console production track is limited to release owners.
- Production submissions require the public privacy-policy URL and completed Play Console declarations described in the privacy release work.

## Versioning

The release owner owns the user-visible application version in `apps/android-companion/app.config.js`.

- Increment `expo.version` for every Play Store release. Use semantic versioning: patch for compatible fixes, minor for user-visible compatible features, and major for incompatible changes.
- EAS owns the Android `versionCode` because `cli.appVersionSource` is `remote` in `apps/android-companion/eas.json`.
- The production profile has `autoIncrement: true`; every production build receives a new, monotonically increasing Android version code. Do not set or reuse an Android version code locally.
- Record the `expo.version`, EAS Android version code, EAS build URL, commit SHA, and Play release name in the release notes.
- `runtimeVersion` follows `appVersion`. A new app version therefore requires a new binary before a production OTA update targeting that runtime version can be used.

## Environment and update separation

| Purpose | EAS build profile | Distribution | Update channel | Network policy |
| --- | --- | --- | --- | --- |
| Local native development | `development` | Internal development client | `development` | Cleartext allowed only for this profile |
| Device/QA testing | `preview` | Internal APK | `preview` | HTTPS required |
| Play Store | `production` | Signed AAB | `production` | HTTPS required |

- Never publish a production update to `preview`, or a preview update to `production`.
- Store development, preview, and production EAS environment variables separately in the Expo dashboard or CI secret store. Production values must be reviewed before each release.
- The companion obtains its paired server address at runtime. Do not embed a production server URL, pairing token, private key, or certificate fingerprint in the app configuration or EAS environment.
- A native change requires a new build. This includes Expo configuration, Android permissions, native modules, SDK upgrades, and dependencies that alter native binaries. JavaScript/TypeScript-only changes may use an OTA update only when they are compatible with the installed runtime version.

## Production build and submission

Run these commands from the repository root after the version bump is committed:

```powershell
npm ci
npm run typecheck
npm run build
npm test
npm run audit:prod:android
npm run build:android:production -w apps/android-companion
```

The production EAS profile intentionally omits `android.buildType: "apk"`; EAS produces an Android App Bundle (AAB) for Play submission. Download the signed AAB only from the recorded EAS build.

Before uploading, confirm the EAS build details show the expected commit, production channel, `LFA_ALLOW_CLEARTEXT=0`, user-visible version, and auto-incremented Android version code.

Upload the AAB to the Play Console internal testing track first. Promote the exact tested artifact through closed testing and then production; do not rebuild between successful test-track validation and promotion.

## Release checklist

- [ ] `apps/android-companion/app.config.js` has the intended new `expo.version` and the commit is merged/tagged.
- [ ] EAS project access and Play Console production-track access are limited to authorized release owners.
- [ ] Play App Signing is enabled and no signing material is present in the repository or build logs.
- [ ] Development, preview, and production EAS environments are distinct; production has no development-only values.
- [ ] Repository checks pass: workspace typecheck, build, tests, and Android production dependency audit.
- [ ] Production AAB build completes with a new remote Android version code, `production` channel, and cleartext disabled.
- [ ] The exact AAB is tested on a physical Android device: launch, QR pairing, HTTPS certificate-pin validation, Health Connect permission flow, selected-category sync, disconnect, and recovery after a failed network request.
- [ ] A production-compatible OTA update is tested on the production channel only, or the release notes state that no OTA update is included.
- [ ] Play Console metadata, content rating, Data Safety, and Health apps/Health Connect declarations are completed from `docs/PLAY_DATA_SAFETY.md` and `docs/HEALTH_CONNECT_DECLARATION.md`; they match `docs/HEALTH_CONNECT_DATA_INVENTORY.md` and the released binary.
- [ ] The public privacy policy at `https://github.com/benleane83/local-fitness-advisor/blob/main/docs/PRIVACY_POLICY.md` is linked from the companion and matches `docs/HEALTH_CONNECT_DATA_INVENTORY.md`.
- [ ] The release starts on the internal testing track; crash/ANR, policy, and tester feedback are reviewed before staged production rollout.
- [ ] Release notes include the commit SHA, EAS build URL, Expo version, Android version code, Play release name, rollout percentage, and approver.

## Rollback

- Halt the Play production rollout immediately if a release is unsafe or fails policy review.
- Disable or roll back any incompatible EAS Update on the `production` channel using the EAS dashboard or CLI.
- Publish a corrective AAB with a higher Android version code. Google Play does not permit reusing a version code or replacing an already-uploaded binary.
- Record the incident, affected versions, remediation, and follow-up validation in the release notes.