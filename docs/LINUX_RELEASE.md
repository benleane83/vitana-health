# Ubuntu AppImage preview

## Supported preview

The Linux preview supports **Ubuntu 24.04 LTS x64**, an AppImage package, and a graphical GNOME session with an unlocked Secret Service-compatible GNOME Keyring. Updates are manual downloads from GitHub Releases.

KDE/KWallet, ARM64, `.deb` packages, other Linux distributions, and in-app AppImage updates are not supported in this preview.

## Security and data

Vitana keeps the same encrypted local DuckDB design used by the Windows package. Electron `safeStorage` wraps the health-store key with GNOME Keyring. Startup fails closed before a profile is opened when Secret Service is unavailable, encryption is unavailable, Electron selects `basic_text`, the native platform is not approved, or the staged core-signed HTTPFS extension fails its pinned SHA-256 check. There is no plaintext key-wrapping fallback.

The default data directory is:

```text
~/.config/Vitana Health
```

`XDG_CONFIG_HOME` replaces `~/.config` when set. Back up this directory only while Vitana Health is closed. It contains encrypted databases, wrapped key metadata, logs, settings, and pre-update backups.

## Install and run

1. Download `Vitana-Health-<version>-linux-x86_64.AppImage` and `SHA256SUMS-linux-x64.txt` from the same GitHub Release.
2. Verify the download:

   ```bash
   sha256sum --check SHA256SUMS-linux-x64.txt
   ```

3. Make the AppImage executable and launch it from the GNOME session:

   ```bash
   chmod +x Vitana-Health-*-linux-x86_64.AppImage
   ./Vitana-Health-*-linux-x86_64.AppImage
   ```

Do not use `--password-store=basic`; Vitana rejects Electron's `basic_text` backend. If startup reports that GNOME Secret Service is unavailable, unlock the login keyring, confirm the `gnome-keyring-daemon` Secret Service component is running in the user session, and relaunch.

## Background mode and tray

When background operation is enabled, Vitana atomically manages:

```text
${XDG_CONFIG_HOME:-$HOME/.config}/autostart/vitana-health.desktop
```

The entry starts the exact packaged executable with `--background`. Disabling background operation removes it. Windows login-item behavior is unchanged. Vitana reports background operation as unsupported outside a graphical GNOME session or after tray creation fails, rather than leaving an unreachable process.

Ubuntu's GNOME session normally includes AppIndicator tray support. If the tray is unavailable, keep background mode disabled and quit Vitana before closing its window.

## Companion access and firewall

The HTTPS API remains local-network only. Pair the companion from Vitana and allow TCP port `4317` only from the trusted private subnet if UFW blocks it, for example:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 4317 proto tcp
```

Replace the subnet with the actual trusted LAN. Do not expose port `4317` to public networks. The AppImage does not modify firewall rules automatically.

## Updates

Linux builds report in-app updates as unsupported and never initialize `electron-updater`. Download the next AppImage and checksum manually, verify it, close Vitana cleanly, then replace the old AppImage. User data is outside the AppImage and remains in the XDG data directory.

## Build host prerequisites

The package workflow runs on Ubuntu 24.04, whose GitHub-hosted runner already has Electron's desktop runtime libraries. Install them before running `npm run package:linux` on a minimal Ubuntu 24.04 Server VM:

```bash
sudo apt-get update
sudo apt-get install --yes \
   libasound2t64 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 \
   libcups2 libdrm2 libgbm1 libgtk-3-0 libnotify4 libnss3 \
   libsecret-1-0 libx11-xcb1 libxcomposite1 libxdamage1 libxfixes3 \
   libxkbcommon0 libxrandr2 libxss1 libxtst6 xdg-utils
```

`--headless`, `--disable-gpu`, and `--no-sandbox` do not remove Electron's dynamic GTK library requirements. After `npm ci`, confirm that its executable has no unresolved shared libraries:

```bash
if ldd node_modules/electron/dist/electron | grep 'not found'; then
   echo "Electron has unresolved runtime libraries." >&2
   exit 1
fi
```

This installs enough runtime support to build and execute the native-ABI gate. It does not provide a graphical GNOME session or Secret Service; run the graphical smoke tier only on the approved GNOME/Keyring runner.

## Build and release gates

Both Linux workflows are manual-only:

- **Ubuntu AppImage package and smoke** builds on Ubuntu 24.04 after `npm ci --ignore-scripts` and `npm rebuild duckdb`. It runs tests, verifies encrypted DuckDB, packages the AppImage, rejects Windows binaries, and verifies Linux DuckDB, HTTPFS, PDF, and OCR resources.
- Its optional **graphical** tier runs the exact artifact on the approved GNOME/Secret Service runner, proving HTTPS API startup, encrypted DuckDB creation, wrapped-key persistence across restart, and clean shutdown. Tray Open/Quit and companion pairing are recorded as manual release evidence because a plain headless runner cannot prove desktop-shell interaction or a second physical device.
- **Ubuntu AppImage release** accepts only evidence from the exact selected tag and requires the graphical artifact. It stages the AppImage and `SHA256SUMS-linux-x64.txt` on a draft GitHub Release without Linux updater metadata or changes to Windows assets.

Run the package workflow with `smoke_scope: graphical`, complete the GNOME tray and private-LAN pairing checks, review its evidence, then dispatch the release workflow from the matching `v<desktop-version>` tag using that run ID.
