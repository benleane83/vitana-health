const path = require("node:path");

function loginItemOptions(enabled, executablePath) {
  return {
    openAtLogin: enabled,
    path: executablePath,
    args: ["--background"]
  };
}

function legacyExecutablePath(executablePath) {
  const pathApi = executablePath.includes("\\") ? path.win32 : path;
  return pathApi.join(pathApi.dirname(executablePath), "Local Fitness Advisor.exe");
}

function createBackgroundServiceController({
  app,
  settingsStore,
  startupRegistration,
  supported = true,
  platform = process.platform,
  createTray,
  showNotification,
  executablePath = process.execPath,
  onOpen,
  onQuit
}) {
  let tray;
  let backgroundSupported = supported;

  function settingsResponse() {
    return {
      supported: backgroundSupported,
      backgroundServiceEnabled: backgroundSupported && settingsStore.read().backgroundServiceEnabled
    };
  }

  function setLoginRegistration(enabled) {
    if (!backgroundSupported && enabled) {
      throw new Error("Background operation is unavailable in this desktop session.");
    }
    if (startupRegistration) {
      startupRegistration.setEnabled(enabled);
      return;
    }
    const options = loginItemOptions(enabled, executablePath);
    app.setLoginItemSettings(options);
    const actual = app.getLoginItemSettings?.({ path: options.path, args: options.args });
    if (actual && actual.openAtLogin !== enabled) {
      throw new Error("The operating system did not apply the login startup setting.");
    }
  }

  function ensureTray() {
    if (!tray) {
      try {
        tray = createTray({ onOpen, onQuit });
      } catch (error) {
        backgroundSupported = false;
        throw error;
      }
    }
    return tray;
  }

  function removeTray() {
    tray?.destroy();
    tray = undefined;
  }

  function applyRuntimeState(enabled) {
    if (enabled) ensureTray();
    else removeTray();
  }

  function reconcileStartup() {
    const state = settingsStore.read();
    if (platform === "win32") {
      const legacyPath = legacyExecutablePath(executablePath);
      if (legacyPath !== executablePath) app.setLoginItemSettings(loginItemOptions(false, legacyPath));
    }
    const enabled = backgroundSupported && state.backgroundServiceEnabled;
    try {
      setLoginRegistration(enabled);
      applyRuntimeState(enabled);
    } catch {
      setLoginRegistration(false);
      applyRuntimeState(false);
    }
    return settingsResponse();
  }

  function updateSettings({ backgroundServiceEnabled }) {
    const previous = settingsStore.read();
    if (previous.backgroundServiceEnabled === backgroundServiceEnabled) {
      setLoginRegistration(backgroundServiceEnabled);
      applyRuntimeState(backgroundServiceEnabled);
      return settingsResponse();
    }
    const next = {
      ...previous,
      backgroundServiceEnabled,
      closeNotificationShown: backgroundServiceEnabled ? false : previous.closeNotificationShown
    };
    try {
      settingsStore.write(next);
      setLoginRegistration(backgroundServiceEnabled);
      applyRuntimeState(backgroundServiceEnabled);
      return settingsResponse();
    } catch (error) {
      try {
        settingsStore.write(previous);
      } catch {}
      try {
        setLoginRegistration(previous.backgroundServiceEnabled);
      } catch {}
      try {
        applyRuntimeState(previous.backgroundServiceEnabled);
      } catch {}
      throw error;
    }
  }

  function handleLastWindowClosed() {
    const state = settingsStore.read();
    if (!state.backgroundServiceEnabled) return false;
    ensureTray();
    if (!state.closeNotificationShown) {
      try {
        showNotification();
      } catch {}
      try {
        settingsStore.write({ ...state, closeNotificationShown: true });
      } catch {}
    }
    return true;
  }

  return {
    getSettings: settingsResponse,
    updateSettings,
    reconcileStartup,
    handleLastWindowClosed,
    repairDisabledStartup: () => setLoginRegistration(false),
    open: onOpen,
    quit: onQuit,
    destroyTray: removeTray
  };
}

module.exports = { createBackgroundServiceController, legacyExecutablePath, loginItemOptions };
