const { app, BrowserWindow, session } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let apiServer;

async function launch() {
  const packaged = app.isPackaged;
  process.env.NODE_ENV = "production";
  process.env.HOST = "0.0.0.0";
  process.env.PORT = process.env.PORT || "4317";
  process.env.LFA_DATA_DIR = app.getPath("userData");
  process.env.LFA_WEB_ROOT = packaged
    ? path.join(process.resourcesPath, "web")
    : path.resolve(__dirname, "../web/dist");

  const serverPath = require.resolve("@local-fitness-advisor/api");
  const { startServer } = await import(pathToFileURL(serverPath).href);
  apiServer = await startServer();

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
app.on("before-quit", () => apiServer?.close());
