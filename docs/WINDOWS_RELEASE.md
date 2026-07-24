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
   login startup, companion connection, and firewall rule.

The tag must exactly equal `v` plus the desktop package version. Reusing a version is
not supported because updaters only offer a strictly newer version.

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