# Windows Preview Release Runbook

Windows preview builds are unsigned and distributed only through GitHub Releases.
There is no LAN update feed or test certificate. The packaged app uses the immutable
GitHub provider for `benleane83/vitana-health` on its single `production` channel.

## Trust model

GitHub HTTPS authenticates release downloads in transit. `electron-updater` also
requires the installer SHA-512 recorded in `latest.yml` and rejects a mismatch.
The workflow publishes `SHA256SUMS.txt` for independent manual verification.

Preview builds do not use Authenticode publisher verification. Windows therefore
shows **Unknown publisher**, and Microsoft Defender SmartScreen may show **Windows
protected your PC**. Smart App Control can block unsigned apps with no per-app
override. Testers must understand these limitations and obtain builds only from the
project's GitHub Releases page.

The Store AppX described below is a separate distribution artifact. It is not a
GitHub Release asset and does not change this NSIS channel.

This model does not protect against compromise of the repository's release-writing
credentials. Keep GitHub accounts protected with strong MFA, restrict write access,
and review release assets before sharing a build.

## Publish a preview

1. Complete the normal CI gates.
2. Set `apps/desktop/package.json` to a strictly higher SemVer version and commit it.
3. Create and push the exact matching tag, for example:

   ```powershell
   git tag v0.2.0
   git push origin v0.2.0
   ```

4. The **Windows release** workflow packages the unsigned NSIS installer and asserts
   that both installer and application are `NotSigned`. It validates `latest.yml`,
  its installer SHA-512, the block map, installation, packaged runtime, and encrypted
  DuckDB activation. The longer background, restart, upgrade, and uninstall lifecycle
  runs in full CI rather than delaying every tagged preview.
5. Review the `unsigned-windows-preview-release` workflow artifact and smoke evidence.
  Failed smoke runs upload startup diagnostics in the same artifact.
   The workflow creates or updates the matching non-draft GitHub Release with the
   installer, `latest.yml`, block map, and `SHA256SUMS.txt`.
6. Install on a test PC, then verify the version, encrypted profiles, background mode,
   login startup, companion connection, and Windows private-network consent when pairing.

The tag must exactly equal `v` plus the desktop package version. Reusing a version is
not supported because updaters only offer a strictly newer version.

## Native binding ABI gate

`build.npmRebuild` is `false`, so the DuckDB native binding shipped in the installer is
the prebuild that npm resolved for **Node**, never one recompiled for Electron. Node and
Electron use different module ABI versions, and a mismatch surfaces only as a failure to
open any profile in the packaged app — no Node-hosted test can catch it, because those
tests load the binding under the ABI it was built for.

`npm run package` and `npm run package:store` therefore both run `verify:native-abi`
first, which loads the binding under Electron and executes a query:

```powershell
npm run verify:native-abi -w apps/desktop
```

A pass prints the Electron version and module ABI it validated against. If it fails after
an Electron upgrade, either the dependency needs an Electron-targeted rebuild or
`npmRebuild` must be turned back on. The Windows smoke script asserts the same property
end to end in both scopes by requiring the packaged runtime to have created an encrypted
`.duckdb` file, which is only possible if the binding loaded.

## Tester update flow

The app checks GitHub Releases after packaged startup but never downloads or installs
an update silently. In **Settings > App**, select **Check for updates**, **Download
update**, then **Restart to update**. Web and Electron development modes perform no
update request.

A tester can also download the installer directly from the matching GitHub Release.
To verify it against the published checksum:

```powershell
Get-FileHash .\Vitana-Health-Setup-0.2.0.exe -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

The hash must match the installer entry exactly. Do not redistribute installers by
email, file share, or an HTTP server.

## Background service release check

When **Keep the service running in the background** is enabled, closing the window
must leave the tray process, encrypted DuckDB API, and companion sync endpoint
available. Login startup uses `--background`; Start menu and tray launches reuse the
singleton process, while tray **Quit** performs a graceful shutdown.

Manually verify this after sign-in or reboot, including the one-time notification and
a paired Android sync. Disabling the setting must restore foreground-only behavior.

## Install scope and private-network access

The NSIS installer is `perMachine: false`, installs into `%LOCALAPPDATA%`, and does not
run `netsh` or require UAC for install and update. The embedded API listens on loopback
until a pairing challenge is created, a request is pending, or an approved companion
exists. It returns to loopback after the temporary challenge expires or the last device
is revoked.

Windows may show its private-network consent prompt the first time pairing opens LAN
access. Allow private networks only; public-network access is neither requested nor
required. Managed devices can suppress that prompt, in which case an administrator must
allow Vitana Health on private networks before a phone can pair.

Switching from an older per-machine preview changes the install location. Uninstall the
old preview before installing this build; profile data remains in the branded user-data
directory because uninstall does not delete app data.

## Troubleshooting

- **No update offered:** confirm the release is not a draft, contains `latest.yml`, and
  has a version strictly newer than the installed build.
- **Checksum error:** do not install the artifact. Remove the release assets and rerun
  the trusted workflow after investigating the mismatch.
- **SmartScreen warning:** expected for unsigned previews. Confirm the GitHub release
  URL and SHA-256 before proceeding. Smart App Control may prevent installation.
- **GitHub unavailable:** local app data remains available. Retry later; do not create
  an alternate HTTP feed.
- **Restart failed:** close active work and retry **Restart to update**. Review local
  startup diagnostics if the embedded API could not shut down safely.

## Moving to signed releases

When a trusted code-signing service is available, first publish a signed update that
is still accepted by the unsigned preview configuration. That build can restore
`verifyUpdateCodeSignature` and publisher metadata so all subsequent updates require
the trusted publisher. Test this transition from the latest unsigned preview before
making signing mandatory.

## Experimental Microsoft Store AppX

The AppX target is an investigation path, not a release channel. It uses a distinct
package identity, display name, output directory, updater channel, and Electron
user-data directory. This prevents a Store test from opening or replacing an NSIS
testing profile and prevents the Store artifact from being uploaded by the Windows
release workflow.

Build it on Windows x64 with:

```powershell
npm ci --ignore-scripts
npm rebuild duckdb
npm run package:store
```

The unsigned package is written to `apps/desktop/dist-store`. To install locally,
create a temporary code-signing certificate whose subject exactly matches the
Partner Center publisher, trust only its public certificate in the current user's
`TrustedPeople` store, and sign the AppX with Windows SDK SignTool:

```powershell
$cert = New-SelfSignedCertificate -Type Custom `
  -Subject "CN=ED882BA6-5AB9-46D8-927C-C72EC1A38D56" `
  -KeyUsage DigitalSignature `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3")
Export-Certificate -Cert $cert -FilePath "$env:TEMP\vitana-store-test.cer"
Import-Certificate -FilePath "$env:TEMP\vitana-store-test.cer" `
  -CertStoreLocation "Cert:\LocalMachine\TrustedPeople"
signtool sign /fd SHA256 /sha1 $cert.Thumbprint /s My `
  (Get-ChildItem apps/desktop/dist-store/*.appx | Select-Object -First 1).FullName
```

Run this from an elevated session because AppX deployment requires trust in the
local-machine certificate store. Delete the exported public certificate and remove
both temporary certificate copies after testing. Do not export, commit, or upload
private signing material. Microsoft will sign the package for Store distribution
after it passes certification.

Run the installed-package smoke test from an elevated PowerShell session:

```powershell
./scripts/windows-store-smoke.ps1 `
  -Package (Get-ChildItem apps/desktop/dist-store/*.appx | Select-Object -First 1).FullName `
  -EvidenceDirectory desktop-store-evidence
```

The script installs and launches through the package identity, checks API health,
encrypted DuckDB creation and restart persistence, and the packaged `httpfs`
checksum. It records package/process state, port `4317`, startup registration,
firewall state, effective data location, and application logs before removing the
test package. Run the **CI** workflow manually with `desktop_package_format=store`
for the same flow using a runner-only certificate. The existing `nsis` option and
tagged release workflow remain unchanged.

### Package behavior and capability rationale

- `runFullTrust` is required for Electron, native Node/DuckDB modules, local API,
  tray process, and filesystem-backed encrypted storage.
- `internetClientServer` is required for network client/server behavior.
- `privateNetworkClientServer` is required for private-LAN mobile companion access.
- Store data is intentionally isolated beneath the package's redirected
  per-user data root. It does not migrate or share `%APPDATA%\Vitana Health`.
- Windows removes package-scoped Store data on package removal. Document this
  behavior clearly before publishing if package removal is intended to delete data.
- GitHub update checks, downloads, and restart-to-install are disabled. Store
  builds report that Microsoft Store owns updates.
- AppX cannot use the NSIS installer firewall action. The smoke evidence records
  firewall state, but localhost success does not prove inbound private-LAN access.

### Remaining Store readiness work

Current decision: **blocked pending clean-device evidence**. A Partner Center
submission must not proceed until all of the following are completed and retained:

1. Test mobile pairing on a clean private-network Windows device and document the
   firewall consent experience. If inbound access is unavailable, implement a
   narrowly scoped user-consented alternative; do not broaden firewall profiles.
2. Verify background/tray behavior, packaged launch-at-login consent, singleton
   relaunch, and graceful shutdown in an interactive Windows user session.
3. Exercise OCR/PDF native functionality from an installed package.
4. Decide and expose the real-product uninstall/export policy. Package removal
   currently deletes isolated package data, which is acceptable only for this
   disposable test identity.
5. Run the Windows App Certification Kit against the signed package and retain its
   report with the smoke evidence.
6. Complete the Partner Center submission with the reserved product name, listing
  assets, privacy-policy URL, certification notes, and reviewed capability
  justifications. The package identity and publisher are now configured in the
  repository.

Passing CI proves packaging, local installation, process startup, UI/API startup,
encrypted storage, native DuckDB loading, restart persistence, and channel
isolation. It does not by itself clear the device- and Store-specific blockers
above.