# Windows Release Runbook

## Ownership and credentials

Release Engineering owns the Windows code-signing certificate and the protected
`windows-release` GitHub Environment. Only the release approvers may approve a
job in that environment or change its secrets and variables.

The environment must contain:

- `WINDOWS_CODESIGN_PFX_BASE64`: the current code-signing PFX, encoded as base64.
- `WINDOWS_CODESIGN_PFX_PASSWORD`: the PFX password.
- `WINDOWS_SIGNING_SUBJECT`: a non-secret subject fragment expected on the
  Authenticode certificate.

Keep the certificate in the organization-managed certificate store or HSM and
rotate it before expiry. Do not place a PFX, its password, or a decoded
certificate in the repository, build logs, issues, or artifacts.

## Production release

1. Complete the normal CI gates, including the unsigned Windows package smoke
   test and its retained evidence.
2. Set `apps/desktop/package.json` to the release version and create the exact
   matching `vX.Y.Z` tag. The protected **Windows release**
   workflow is the only path that receives signing credentials.
3. Approve the `windows-release` environment. It packages with
   `forceCodeSigning`, verifies Authenticode on the installed application and
   NSIS installer, then installs, launches, restarts, and uninstalls the
   product. The smoke test verifies the signed extension's encrypted DuckDB
   activation, storage persistence, and firewall-rule creation/removal. The
   nightly full CI smoke test also performs a baseline-to-candidate installer
   upgrade before its restart and uninstall checks.
4. Review the workflow's `signed-windows-release` artifact. It retains the
   installer, `latest.yml`, block map, `SHA256SUMS.txt`, and smoke-test evidence
   for 90 days.
5. Confirm the non-draft matching GitHub Release contains those same assets.
   Upgrade a previous public version through **Settings > App**, then verify the
   installed version, encrypted profiles, background mode, login startup, and
   firewall rule.

## Background service release check

The installed desktop exposes an opt-in setting at **Settings > App**. When enabled,
closing the window must destroy the renderer while the tray-resident main process,
encrypted DuckDB API, and companion sync endpoint remain available. It registers
per-user login startup with `--background`; a login launch starts without a window.
Start menu and tray launches reuse that singleton process, while tray **Quit** performs
a full graceful shutdown.

The full Windows smoke path enables the setting through the authenticated local API,
checks health after window close, checks login registration and singleton reopen, then
disables it and verifies normal close stops health. Manually confirm the same flow
after sign-in or reboot, including the one-time notification and a paired Android sync.
Disabling the setting must restore foreground-only behavior.

## Desktop update channels

Production packages have an immutable, unauthenticated GitHub Releases provider
for `benleane83/local-fitness-advisor`. They consume stable releases only.
LAN packages have an immutable generic HTTP provider supplied at packaging time;
they never fall back to GitHub. Neither feed URL nor channel can be edited in the
application.

Both channels keep `verifyUpdateCodeSignature: true`. Updates are checked after
packaged startup but are never downloaded or installed silently. The owner must
select **Check for updates**, **Download update**, then **Restart to update** in
**Settings > App**. Web/Electron development mode performs no update request.

## One-time LAN setup

1. On the development PC, create a separate self-signed or internal Authenticode
   code-signing certificate. For a self-signed LAN test identity, run:

   ```powershell
   .\scripts\create-lan-signing-certificate.ps1
   ```

   Enter the PFX password only at the PowerShell prompt. The helper creates the
   protected `C:\secure\vitana-lan-test.pfx` and public
   `C:\secure\vitana-lan-test.cer`; neither belongs in this repository. Never
   copy or reuse the production PFX.
2. Export only the public certificate and install it on each trusted test PC in
   both **Trusted Root Certification Authorities** and **Trusted Publishers**
   (Local Machine). Remove the old certificate from both stores during rotation
   or when retiring the channel.
3. Reserve the development PC's private LAN address. Open only the selected feed
   port on the Windows **Private** firewall profile. Never port-forward it on the
   router or expose it to a public network.
4. Package and manually install one LAN build signed by that identity. Every
   later package must use the same identity until a deliberate trust rotation.
5. Verify the installer before use:

   ```powershell
   Get-AuthenticodeSignature .\Vitana-Health-Setup.exe | Format-List Status,SignerCertificate
   ```

   `Status` must be `Valid`, and the signer subject must be the expected LAN
   publisher.

## Routine LAN update

Configure the standard electron-builder signing inputs to reference the LAN test
PFX, then package a strictly higher SemVer without modifying tracked versions:

```powershell
$env:CSC_LINK = "C:\secure\vitana-lan-test.pfx"
$env:CSC_KEY_PASSWORD = Read-Host "LAN PFX password"
$env:VITANA_LAN_UPDATE_URL = "http://192.168.1.10:8082/"
$env:VITANA_LAN_UPDATE_VERSION = "0.1.1-lan.1"
npm run package:desktop:lan
   npm run serve:desktop:updates
   ```

   The npm command serves `apps/desktop/dist` on port `8082` in explicit LAN
   mode. For a nondefault root or port, invoke Node directly:

   ```powershell
   node .\scripts\serve-desktop-updates.mjs --lan --root <directory> --port <port>
   ```
```

For an accepted local DNS name, set `VITANA_LAN_UPDATE_ALLOW_HOST` to that exact
host. The package command rejects HTTPS/public hosts, credentials, query strings,
fragments, missing signing inputs, and invalid versions. Production packaging
ignores all LAN variables.

On each test PC, use **Check for updates**, **Download update**, and **Restart to
update**. After restart, verify the version, Authenticode signature, encrypted
DuckDB/profile persistence, background mode, login-start preference, and firewall
rule.

## Troubleshooting

- **LAN feed unreachable:** confirm the reserved address, Private network
  profile, firewall port, feed server, and packaged URL. Do not disable signature
  verification or expose the port publicly.
- **Stale metadata:** restart the strict feed server and confirm `latest.yml`
  returns `Cache-Control: no-store`. Artifacts are intentionally immutable.
- **No update offered:** versions must increase according to SemVer; verify
  `latest.yml` and the installed channel.
- **Signature/publisher mismatch:** sign the initial install and every update
  with the same trusted LAN identity. Reinstall trust only as part of a documented
  rotation.
- **GitHub unavailable:** normal app and local data remain available; retry later
  and confirm the matching stable Release has `latest.yml`, installer, block map,
  and checksums.
- **Restart failed:** close active work and retry **Restart to update**. Review
  the local startup diagnostics if the embedded API could not shut down safely.
