const { app, BrowserWindow, dialog, Menu, Notification, safeStorage, session, Tray } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createBackgroundServiceController } = require("./background-service.cjs");
const { createBackgroundServiceSettingsStore } = require("./background-service-settings.cjs");
const { loadOrCreateSecureStoreKey } = require("./secure-store-key.cjs");
const { createStartupDiagnostics } = require("./startup-diagnostics.cjs");
const { createDesktopUpdaterController } = require("./desktop-updater.cjs");
const { migrateUserDataDirectory } = require("./user-data-migration.cjs");

let apiServer;
let mainWindow;
let quitting = false;
let shutdownStarted = false;
let updateInstallPending = false;
let launchPromise;
const backgroundLaunch = process.argv.includes("--background");
let startupPathError;
const packageMetadata = require("./package.json");
const distributionChannel = packageMetadata.vitanaDistributionChannel;
const brandedUserDataPath = path.join(
  app.getPath("appData"),
  distributionChannel === "store" ? "Vitana Health Store Test" : "Vitana Health"
);
try {
  if (distributionChannel === "github") migrateUserDataDirectory(app.getPath("appData"));
} catch (error) {
  startupPathError = error;
}
app.setPath("userData", brandedUserDataPath);
const diagnostics = createStartupDiagnostics({ userDataPath: app.getPath("userData") });
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
  quitting = true;
  app.quit();
}

async function shutdownApiForUpdate() {
  if (updateInstallPending) return;
  updateInstallPending = true;
  quitting = true;
  backgroundService.destroyTray();
  if (!apiServer) return;
  try {
    await Promise.race([
      apiServer.shutdown(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Embedded API shutdown timed out.")), 10_000))
    ]);
    apiServer = undefined;
  } catch (error) {
    updateInstallPending = false;
    quitting = false;
    throw error;
  }
}

async function createOrFocusWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }
  if (!apiServer) return undefined;
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
  await mainWindow.loadURL(`https://127.0.0.1:${process.env.PORT}`);
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
process.on("uncaughtException", (error) => diagnostics.error("Uncaught exception", error));
process.on("unhandledRejection", (error) => diagnostics.error("Unhandled rejection", error));
app.on("child-process-gone", (_event, details) => {
  diagnostics.error(`Child process exited (${details.type}, reason ${details.reason}, exit code ${details.exitCode})`);
});
app.on("render-process-gone", (_event, _webContents, details) => {
  diagnostics.error(`Renderer process exited (reason ${details.reason}, exit code ${details.exitCode})`);
});

if (!app.requestSingleInstanceLock()) {
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
  const secureKey = configuredSecret
    ? undefined
    : loadOrCreateSecureStoreKey({
        safeStorage,
        userDataPath: app.getPath("userData"),
        legacyKeyPath: path.join(app.getPath("userData"), "local.key")
      });
  apiServer = await startServer({
    storeSecurity: configuredSecret
      ? { passphrase: configuredSecret, securityMode: "env-secret" }
      : { passphrase: secureKey.passphrase, securityMode: "os-secure-storage" },
    desktopRuntimeController: backgroundService,
    desktopUpdaterController: desktopUpdater
  });
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
  if (quitting) return;
  if (!backgroundService.handleLastWindowClosed()) requestQuit();
});

app.on("before-quit", (event) => {
  quitting = true;
  diagnostics.info("Application shutdown requested");
  if (updateInstallPending) return;
  if (shutdownStarted || !apiServer) return;
  event.preventDefault();
  shutdownStarted = true;
  void apiServer.shutdown()
    .then(() => app.quit())
    .catch((error) => {
      diagnostics.error("Embedded API shutdown failed", error);
      console.error(error);
      app.exit(1);
    });
});
