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

## Release procedure

1. Complete the normal CI gates, including the unsigned Windows package smoke
   test and its retained evidence.
2. Create and push a reviewed `v*` tag. The protected **Windows release**
   workflow is the only path that receives signing credentials.
3. Approve the `windows-release` environment. It packages with
   `forceCodeSigning`, verifies Authenticode on the installed application and
   NSIS installer, then installs, launches, restarts, and uninstalls the
   product. The smoke test verifies the signed extension's encrypted DuckDB
   activation, storage persistence, and firewall-rule creation/removal. The
   nightly full CI smoke test also performs a baseline-to-candidate installer
   upgrade before its restart and uninstall checks.
4. Review the workflow's `signed-windows-release` artifact. It retains the
   installer, `SHA256SUMS.txt`, and smoke-test evidence for 90 days.
5. The workflow publishes the signed installer and `SHA256SUMS.txt` to the
   matching GitHub Release. Publish only those release assets; never distribute
   installers from unprotected workflow artifacts.

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

## Distribution and updates

GitHub Releases are the supported update channel. Users must download an
installer only from the matching tagged release, verify its SHA-256 value
against `SHA256SUMS.txt`, and confirm a valid Authenticode signature from the
published certificate subject before installation.

The application does not currently perform automatic updates. A future updater
must use an HTTPS release feed controlled by Release Engineering and preserve
electron-builder's `verifyUpdateCodeSignature` check; it must not bypass
Authenticode or accept unsigned update packages.
