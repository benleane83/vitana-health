const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const {
  createDesktopPlatformCapabilities,
  isSupportedGnomeSession
} = require("./desktop-platform.cjs");

test("supports background operation only in a graphical GNOME Linux session", () => {
  assert.equal(isSupportedGnomeSession({ XDG_CURRENT_DESKTOP: "ubuntu:GNOME", WAYLAND_DISPLAY: "wayland-0" }), true);
  assert.equal(isSupportedGnomeSession({ XDG_CURRENT_DESKTOP: "GNOME" }), false);
  assert.equal(isSupportedGnomeSession({ XDG_CURRENT_DESKTOP: "KDE", DISPLAY: ":0" }), false);
});

test("selects Linux PNG assets and XDG startup registration", () => {
  const configRoot = mkdtempSync(path.join(tmpdir(), "vitana-platform-"));
  try {
    const capabilities = createDesktopPlatformCapabilities({
      app: {},
      executablePath: "/opt/Vitana Health",
      platform: "linux",
      environment: {
        XDG_CURRENT_DESKTOP: "GNOME",
        DISPLAY: ":0",
        XDG_CONFIG_HOME: configRoot
      }
    });
    assert.equal(capabilities.backgroundSupported, true);
    assert.match(capabilities.trayIconPath, /tray-icon\.png$/);
    capabilities.startupRegistration.setEnabled(true);
    assert.equal(capabilities.startupRegistration.isEnabled(), true);
  } finally {
    rmSync(configRoot, { recursive: true, force: true });
  }
});

test("preserves Electron login registration on Windows", () => {
  const calls = [];
  const capabilities = createDesktopPlatformCapabilities({
    app: { setLoginItemSettings: (options) => calls.push(options) },
    executablePath: "C:\\Vitana Health.exe",
    platform: "win32"
  });
  capabilities.startupRegistration.setEnabled(true);
  assert.deepEqual(calls, [{
    path: "C:\\Vitana Health.exe",
    args: ["--background"],
    openAtLogin: true
  }]);
  assert.match(capabilities.trayIconPath, /tray-icon\.ico$/);
});

test("loads the Windows tray icon from the unpacked packaged resources", () => {
  const capabilities = createDesktopPlatformCapabilities({
    app: { isPackaged: true },
    platform: "win32",
    resourcesPath: "C:\\Users\\vitana\\AppData\\Local\\Programs\\Vitana Health\\resources"
  });

  assert.equal(
    capabilities.trayIconPath,
    "C:\\Users\\vitana\\AppData\\Local\\Programs\\Vitana Health\\resources\\tray-icon.ico"
  );
});
