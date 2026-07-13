const { app } = require("electron");
const { mkdtempSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function run() {
  const apiEntryPath = require.resolve("@local-fitness-advisor/api");
  const pocModulePath = path.join(path.dirname(apiEntryPath), "poc", "duckdbPoc.js");
  const { initializePocRoot, proveNativeEncryption } = await import(pathToFileURL(pocModulePath).href);
  const root = initializePocRoot(mkdtempSync(path.join(tmpdir(), "lfa-electron-duckdb-poc-")));
  const httpfsExtensionPath = path.join(
    process.resourcesPath,
    "duckdb-extensions",
    "httpfs.duckdb_extension"
  );
  const result = await proveNativeEncryption(root, { httpfsExtensionPath });
  const output = {
    electronVersion: process.versions.electron,
    duckdbExtensionPath: httpfsExtensionPath,
    encrypted: result.encrypted,
    correctKeyRead: result.correctKeyRead,
    missingKeyRejected: result.missingKeyRejected,
    wrongKeyRejected: result.wrongKeyRejected,
    walCreated: result.walCreated,
    tempSpillCreated: result.tempSpillCreated,
    sensitiveValuesAbsent: result.sensitiveValuesAbsent,
    rejectedKeysPreservedDatabase: result.rejectedKeysPreservedDatabase
  };
  if (process.env.LFA_DUCKDB_POC_RESULT) {
    writeFileSync(process.env.LFA_DUCKDB_POC_RESULT, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(output));
  if (Object.entries(result).some(([name, gate]) => name !== "databasePath" && gate !== true)) {
    throw new Error("Packaged Electron DuckDB encryption gates failed.");
  }
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => {
  console.error(error);
  app.exit(1);
});