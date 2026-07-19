const { app, BrowserWindow, dialog, safeStorage, session } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { loadOrCreateSecureStoreKey } = require("./secure-store-key.cjs");
const { createStartupDiagnostics } = require("./startup-diagnostics.cjs");

let apiServer;
let shutdownStarted = false;
const diagnostics = createStartupDiagnostics({ userDataPath: app.getPath("userData") });

diagnostics.info(`Process started (Electron ${process.versions.electron}, Node ${process.versions.node})`);
process.on("uncaughtException", (error) => {
  diagnostics.error("Uncaught exception", error);
});
process.on("unhandledRejection", (error) => {
  diagnostics.error("Unhandled rejection", error);
});
app.on("child-process-gone", (_event, details) => {
  diagnostics.error(`Child process exited (${details.type}, reason ${details.reason}, exit code ${details.exitCode})`);
});
app.on("render-process-gone", (_event, _webContents, details) => {
  diagnostics.error(`Renderer process exited (reason ${details.reason}, exit code ${details.exitCode})`);
});

async function launch() {
  diagnostics.info("Electron ready; starting embedded API");
  const packaged = app.isPackaged;
  process.env.NODE_ENV = "production";
  process.env.HOST = "0.0.0.0";
  process.env.PORT = process.env.PORT || "4317";
  process.env.LFA_DATA_DIR = app.getPath("userData");
  process.env.LFA_STORAGE_BACKEND = process.env.LFA_STORAGE_BACKEND ||
    (process.env.LFA_DUCKDB_ROLLBACK ? "json" : "duckdb");
  process.env.LFA_WEB_ROOT = packaged
    ? path.join(process.resourcesPath, "web")
    : path.resolve(__dirname, "../web/dist");
  process.env.LFA_DUCKDB_HTTPFS_EXTENSION = packaged
    ? path.join(process.resourcesPath, "duckdb-extensions", "httpfs.duckdb_extension")
    : path.resolve(__dirname, "build", "duckdb-extensions", "httpfs.duckdb_extension");

  const serverPath = require.resolve("@local-fitness-advisor/api");
  const { configureAiCredentialProtector, startServer } = await import(pathToFileURL(serverPath).href);
  diagnostics.info("Embedded API module loaded");
  configureAiCredentialProtector({
    encryptString: (value) => safeStorage.encryptString(value),
    decryptString: (value) => safeStorage.decryptString(value)
  });
  const configuredSecret = process.env.LFA_SECRET;
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
      : { passphrase: secureKey.passphrase, securityMode: "os-secure-storage" }
  });
  secureKey?.finalize();
  diagnostics.info(`Embedded API listening on port ${process.env.PORT}`);

  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    callback(request.hostname === "127.0.0.1" || request.hostname === "localhost" ? 0 : -3);
  });

  const window = new BrowserWindow({
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
  await window.loadURL(`https://127.0.0.1:${process.env.PORT}`);
  diagnostics.info("Main window loaded");
}

app.whenReady().then(launch).catch((error) => {
  diagnostics.error("Startup failed", error);
  console.error(error);
  dialog.showErrorBox(
    "Local Fitness Advisor could not start",
    error instanceof Error ? error.message : String(error)
  );
  app.quit();
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  diagnostics.info("Application shutdown requested");
  if (shutdownStarted || !apiServer) {
    return;
  }
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
