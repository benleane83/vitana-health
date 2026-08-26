function createDesktopUpdaterController({
  app,
  updater,
  diagnostics,
  channel,
  distributionChannel,
  prepareToInstall,
  schedule = setTimeout,
  startupDelayMs = 5_000
}) {
  const supported = Boolean(app.isPackaged && distributionChannel === "github" && channel === "production");
  const storeManaged = Boolean(app.isPackaged && distributionChannel === "store");
  let operation;
  let installStarted = false;
  let state = {
    status: supported ? "idle" : storeManaged ? "managed" : "unsupported",
    currentVersion: app.getVersion(),
    channel: supported ? channel : null,
    distributionChannel
  };

  function snapshot() {
    return { ...state, ...(state.progress ? { progress: { ...state.progress } } : {}) };
  }

  function update(next) {
    state = { ...state, ...next };
    return snapshot();
  }

  function safeError(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/signature|publisher/i.test(message)) return "The update signature or publisher could not be verified.";
    return "The update service is unavailable. Check your connection and try again.";
  }

  function diagnosticError(error) {
    const message = (error instanceof Error ? error.message : String(error))
      .replace(/https?:\/\/[^\s"'<>]+/gi, "[update-url]");
    return new Error(message);
  }

  function finite(value) {
    return Number.isFinite(value) ? value : 0;
  }

  if (supported) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.on("checking-for-update", () => update({ status: "checking", error: undefined }));
    updater.on("update-available", (info) => update({
      status: "available",
      availableVersion: info.version,
      progress: undefined,
      error: undefined,
      lastCheckedAt: new Date().toISOString()
    }));
    updater.on("update-not-available", () => update({
      status: "up-to-date",
      availableVersion: undefined,
      progress: undefined,
      error: undefined,
      lastCheckedAt: new Date().toISOString()
    }));
    updater.on("download-progress", (progress) => update({
      status: "downloading",
      progress: {
        percent: Math.max(0, Math.min(100, finite(progress.percent))),
        transferred: Math.max(0, finite(progress.transferred)),
        total: Math.max(0, finite(progress.total))
      }
    }));
    updater.on("update-downloaded", (info) => update({
      status: "downloaded",
      availableVersion: info.version,
      progress: { percent: 100, transferred: 0, total: 0 },
      error: undefined
    }));
    updater.on("error", (error) => {
      diagnostics.error("Desktop updater operation failed", diagnosticError(error));
      update({ status: "error", error: safeError(error), progress: undefined });
    });
  } else {
    diagnostics.info(storeManaged
      ? "Desktop updates are managed by Microsoft Store"
      : "Desktop updates unsupported in development mode or invalid package channel");
  }

  let startupScheduled = false;
  function start() {
    if (!supported || startupScheduled) return;
    startupScheduled = true;
    schedule(() => void check(), startupDelayMs);
  }

  async function run(status, action) {
    if (!supported) return snapshot();
    if (operation) return operation;
    update({ status, error: undefined });
    operation = Promise.resolve()
      .then(action)
      .then(snapshot)
      .catch((error) => {
        diagnostics.error("Desktop updater command failed", diagnosticError(error));
        return update({ status: "error", error: safeError(error), progress: undefined });
      })
      .finally(() => {
        operation = undefined;
      });
    return operation;
  }

  function check() {
    diagnostics.info(`Checking ${channel} desktop update channel`);
    return run("checking", () => updater.checkForUpdates());
  }

  function download() {
    if (state.status !== "available") return Promise.resolve(snapshot());
    diagnostics.info(`Downloading ${channel} desktop update`);
    return run("downloading", () => updater.downloadUpdate());
  }

  function restartToInstall() {
    if (state.status !== "downloaded" || installStarted) return Promise.resolve(snapshot());
    installStarted = true;
    update({ status: "installing", error: undefined });
    diagnostics.info("Preparing to restart for desktop update installation");
    schedule(async () => {
      try {
        await prepareToInstall({
          fromVersion: state.currentVersion,
          toVersion: state.availableVersion
        });
        updater.quitAndInstall(false, true);
      } catch (error) {
        installStarted = false;
        diagnostics.error("Desktop update restart failed", diagnosticError(error));
        update({
          status: "downloaded",
          error: "Vitana could not close safely to install the update. Try again."
        });
      }
    }, 0);
    return Promise.resolve(snapshot());
  }

  return { getState: snapshot, start, check, download, restartToInstall };
}

module.exports = { createDesktopUpdaterController };
