const { app, BrowserWindow, dialog, Menu, Notification, safeStorage, session, Tray } = require("electron");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { createBackgroundServiceController } = require("./background-service.cjs");
const { createBackgroundServiceSettingsStore } = require("./background-service-settings.cjs");
const { loadOrCreateSecureStoreKey, prepareSecureStoreKey } = require("./secure-store-key.cjs");
const { createStartupDiagnostics } = require("./startup-diagnostics.cjs");
const { createDesktopUpdaterController } = require("./desktop-updater.cjs");
const { migrateUserDataDirectory } = require("./user-data-migration.cjs");
const { createPreUpdateBackup } = require("./pre-update-backup.cjs");
const { createDesktopLifecycle } = require("./desktop-lifecycle.cjs");

let mainWindow;
let launchPromise;
/** Kept in memory for the lifetime of this process only; see the two uses below. */
const launchNonce = randomBytes(32).toString("base64url");
const backgroundLaunch = process.argv.includes("--background");
let startupPathError;
const packageMetadata = require("./package.json");
const distributionChannel = packageMetadata.vitanaDistributionChannel;
const brandedUserDataPath = path.join(
  app.getPath("appData"),
  distributionChannel === "store" ? "Vitana Health Store Test" : "Vitana Health"
);
app.setPath("userData", brandedUserDataPath);

// The lock has to be taken before the legacy user-data directory is moved. Two copies launching
// together would otherwise both see the old directory and race their renames, and the loser can
// leave the store half-moved between the two paths.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (hasSingleInstanceLock) {
  try {
    if (distributionChannel === "github") migrateUserDataDirectory(app.getPath("appData"));
  } catch (error) {
    startupPathError = error;
  }
}
const diagnostics = createStartupDiagnostics({ userDataPath: app.getPath("userData") });
const lifecycle = createDesktopLifecycle({ app, diagnostics });
const settingsStore = createBackgroundServiceSettingsStore({ userDataPath: app.getPath("userData") });
const updateChannel = packageMetadata.vitanaUpdateChannel;
const desktopUpdater = createDesktopUpdaterController({
  app,
  updater: distributionChannel === "github" ? require("electron-updater").autoUpdater : undefined,
  diagnostics,
  channel: updateChannel,
  distributionChannel,
  prepareToInstall: shutdownApiForUpdate
});

function trayIconPath() {
  return path.join(__dirname, "build", "tray-icon.ico");
}

function requestQuit() {
  lifecycle.markQuitting();
  app.quit();
}

async function shutdownApiForUpdate(versions = {}) {
  await lifecycle.prepareForUpdateInstall(async () => {
    backgroundService.destroyTray();
    // Only safe now that the API has closed and checkpointed the databases. A failure here must not
    // block the update, so it is recorded and swallowed.
    try {
      const backupPath = createPreUpdateBackup({
        userDataPath: app.getPath("userData"),
        fromVersion: versions.fromVersion ?? app.getVersion(),
        toVersion: versions.toVersion
      });
      if (backupPath) diagnostics.info(`Pre-update backup written to ${backupPath}`);
    } catch (error) {
      diagnostics.error("Pre-update backup failed.", error);
    }
  });
}

async function createOrFocusWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }
  if (!lifecycle.hasServer()) return undefined;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 640,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.once("closed", () => {
    mainWindow = undefined;
  });
  /**
   * The fragment never leaves the browser, so the nonce reaches the renderer without appearing in
   * the request line, the API log, or anything a bystanding process can read. The renderer stashes
   * it in session storage and strips it from the address immediately.
   */
  await mainWindow.loadURL(`https://127.0.0.1:${process.env.PORT}#launch=${launchNonce}`);
  diagnostics.info("Main window loaded");
  return mainWindow;
}

const backgroundService = createBackgroundServiceController({
  app,
  settingsStore,
  executablePath: process.execPath,
  onOpen: () => void createOrFocusWindow(),
  onQuit: requestQuit,
  createTray: ({ onOpen, onQuit }) => {
    const tray = new Tray(trayIconPath());
    tray.setToolTip("Vitana Health");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Open Vitana Health", click: onOpen },
      { type: "separator" },
      { label: "Quit", click: onQuit }
    ]));
    tray.on("double-click", onOpen);
    return tray;
  },
  showNotification: () => {
    if (!Notification.isSupported()) return;
    new Notification({
      title: "Vitana Health is still running",
      body: "Mobile sync remains available. Use Quit in the tray menu to stop the service.",
      icon: trayIconPath()
    }).show();
  }
});

diagnostics.info(`Process started (Electron ${process.versions.electron}, Node ${process.versions.node})`);
process.on("uncaughtException", (error) => void lifecycle.handleFatalError("Uncaught exception", error));
process.on("unhandledRejection", (error) => void lifecycle.handleFatalError("Unhandled rejection", error));
app.on("child-process-gone", (_event, details) => {
  diagnostics.error(`Child process exited (${details.type}, reason ${details.reason}, exit code ${details.exitCode})`);
});
app.on("render-process-gone", (_event, _webContents, details) => {
  diagnostics.error(`Renderer process exited (reason ${details.reason}, exit code ${details.exitCode})`);
});

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    void launchPromise?.then(() => createOrFocusWindow());
  });
  app.on("activate", () => {
    void launchPromise?.then(() => createOrFocusWindow());
  });
  launchPromise = app.whenReady().then(launch).catch(handleStartupFailure);
}

async function launch() {
  if (startupPathError) throw startupPathError;
  const persisted = backgroundService.getSettings();
  if (backgroundLaunch && !persisted.backgroundServiceEnabled) {
    diagnostics.info("Ignoring stale disabled background launch");
    backgroundService.repairDisabledStartup();
    requestQuit();
    return;
  }

  backgroundService.reconcileStartup();
  diagnostics.info("Electron ready; starting embedded API");
  const packaged = app.isPackaged;
  process.env.NODE_ENV = "production";
  process.env.HOST = "0.0.0.0";
  process.env.PORT = process.env.PORT || "4317";
  process.env.VITANA_DATA_DIR = app.getPath("userData");
  process.env.VITANA_APP_VERSION = app.getVersion();
  process.env.VITANA_LOG_FILE = path.join(app.getPath("userData"), "logs", "api.ndjson");
  // Proves a caller of /api/auth/local is the window this launch opened, rather than merely another
  // process that reached loopback. Regenerated every launch and never written to disk.
  process.env.VITANA_LOCAL_AUTH_NONCE = launchNonce;
  process.env.VITANA_STORAGE_BACKEND = "duckdb";
  process.env.VITANA_WEB_ROOT = packaged
    ? path.join(process.resourcesPath, "web")
    : path.resolve(__dirname, "../web/dist");
  process.env.VITANA_DUCKDB_HTTPFS_EXTENSION = packaged
    ? path.join(process.resourcesPath, "duckdb-extensions", "httpfs.duckdb_extension")
    : path.resolve(__dirname, "build", "duckdb-extensions", "httpfs.duckdb_extension");

  const serverPath = require.resolve("@vitana/api");
  const { configureAiCredentialProtector, startServer } = await import(pathToFileURL(serverPath).href);
  diagnostics.info("Embedded API module loaded");
  configureAiCredentialProtector({
    encryptString: (value) => safeStorage.encryptString(value),
    decryptString: (value) => safeStorage.decryptString(value)
  });
  const configuredSecret = process.env.VITANA_SECRET;
  const secureKeyInitialization = configuredSecret
    ? undefined
    : await prepareSecureStoreKey({ safeStorage, userDataPath: app.getPath("userData") });
  let secureKey;
  try {
    secureKey = configuredSecret
      ? undefined
      : loadOrCreateSecureStoreKey({
          safeStorage,
          userDataPath: app.getPath("userData"),
          legacyKeyPath: path.join(app.getPath("userData"), "local.key")
        });
  } finally {
    secureKeyInitialization?.finalize();
  }
  const apiServer = await startServer({
    storeSecurity: configuredSecret
      ? { passphrase: configuredSecret, securityMode: "env-secret" }
      : { passphrase: secureKey.passphrase, securityMode: "os-secure-storage" },
    desktopRuntimeController: backgroundService,
    desktopUpdaterController: desktopUpdater
  });
  lifecycle.setServer(apiServer);
  secureKey?.finalize();
  diagnostics.info(`Embedded API listening on port ${process.env.PORT}`);
  desktopUpdater.start();

  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    callback(request.hostname === "127.0.0.1" || request.hostname === "localhost" ? 0 : -3);
  });
  if (!backgroundLaunch) await createOrFocusWindow();
}

function handleStartupFailure(error) {
  diagnostics.error("Startup failed", error);
  console.error(error);
  dialog.showErrorBox(
    "Vitana Health could not start",
    error instanceof Error ? error.message : String(error)
  );
  requestQuit();
}

app.on("window-all-closed", () => {
  if (lifecycle.isQuitting()) return;
  if (!backgroundService.handleLastWindowClosed()) requestQuit();
});

app.on("before-quit", (event) => lifecycle.handleBeforeQuit(event));
