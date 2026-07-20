function loginItemOptions(enabled, executablePath) {
  return {
    openAtLogin: enabled,
    path: executablePath,
    args: enabled ? ["--background"] : []
  };
}

function createBackgroundServiceController({
  app,
  settingsStore,
  createTray,
  showNotification,
  executablePath = process.execPath,
  onOpen,
  onQuit
}) {
  let tray;

  function settingsResponse() {
    return {
      supported: true,
      backgroundServiceEnabled: settingsStore.read().backgroundServiceEnabled
    };
  }

  function setLoginRegistration(enabled) {
    app.setLoginItemSettings(loginItemOptions(enabled, executablePath));
  }

  function ensureTray() {
    if (!tray) tray = createTray({ onOpen, onQuit });
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
    setLoginRegistration(state.backgroundServiceEnabled);
    applyRuntimeState(state.backgroundServiceEnabled);
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

module.exports = { createBackgroundServiceController, loginItemOptions };
