const { app, BrowserWindow, safeStorage, session } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { loadOrCreateSecureStoreKey } = require("./secure-store-key.cjs");

let apiServer;
let shutdownStarted = false;

async function launch() {
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
  const { startServer } = await import(pathToFileURL(serverPath).href);
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
}

app.whenReady().then(launch).catch((error) => {
  console.error(error);
  app.quit();
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (shutdownStarted || !apiServer) {
    return;
  }
  event.preventDefault();
  shutdownStarted = true;
  void apiServer.shutdown()
    .then(() => app.quit())
    .catch((error) => {
      console.error(error);
      app.exit(1);
    });
});
