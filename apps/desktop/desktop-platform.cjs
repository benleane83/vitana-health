const path = require("node:path");
const { createXdgAutostartRegistration } = require("./xdg-autostart.cjs");

function electronLoginRegistration(app, executablePath) {
  const options = {
    path: executablePath,
    args: ["--background"]
  };
  return {
    setEnabled(enabled) {
      app.setLoginItemSettings({ ...options, openAtLogin: enabled });
      const actual = app.getLoginItemSettings?.(options);
      if (actual && actual.openAtLogin !== enabled) {
        throw new Error("The operating system did not apply the login startup setting.");
      }
    }
  };
}

function isSupportedGnomeSession(environment) {
  const desktop = `${environment.XDG_CURRENT_DESKTOP ?? ""}:${environment.XDG_SESSION_DESKTOP ?? ""}`;
  return /(^|:)gnome(?=:|$)/i.test(desktop) && Boolean(environment.DISPLAY || environment.WAYLAND_DISPLAY);
}

function createDesktopPlatformCapabilities({
  app,
  executablePath = process.execPath,
  platform = process.platform,
  environment = process.env,
  homeDirectory,
  fileSystem
}) {
  if (platform === "win32") {
    return {
      backgroundSupported: true,
      startupRegistration: electronLoginRegistration(app, executablePath),
      trayIconPath: path.join(__dirname, "build", "tray-icon.ico")
    };
  }
  if (platform === "linux") {
    return {
      backgroundSupported: isSupportedGnomeSession(environment),
      startupRegistration: createXdgAutostartRegistration({
        executablePath,
        environment,
        homeDirectory,
        fileSystem
      }),
      trayIconPath: path.join(__dirname, "build", "tray-icon.png")
    };
  }
  return {
    backgroundSupported: false,
    startupRegistration: { setEnabled() {} },
    trayIconPath: path.join(__dirname, "build", "tray-icon.png")
  };
}

module.exports = { createDesktopPlatformCapabilities, electronLoginRegistration, isSupportedGnomeSession };
