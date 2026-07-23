const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

test("electron-builder publisherName stays within the Windows config", () => {
  const packageJson = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8"));

  assert.equal(packageJson.build.npmRebuild, false);
  assert.equal(Object.hasOwn(packageJson.build, "publisherName"), false);
  assert.equal(Object.hasOwn(packageJson.build.win, "publisherName"), false);
  assert.equal(packageJson.build.win.signtoolOptions.publisherName, "Vitana Health");
});

test("electron-builder excludes DuckDB development files but keeps runtime files", () => {
  const packageJson = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8"));
  const files = packageJson.build.files;

  assert.ok(files.includes("startup-diagnostics.cjs"));
  assert.ok(files.includes("desktop-updater.cjs"));
  assert.ok(files.includes("background-service.cjs"));
  assert.ok(files.includes("background-service-settings.cjs"));
  assert.ok(files.includes("user-data-migration.cjs"));
  assert.ok(files.includes("build/*.ico"));
  assert.equal(packageJson.build.win.icon, "build/icon.ico");
  assert.ok(files.includes("!**/node_modules/duckdb/src{,/**}"));
  assert.ok(files.includes("!**/node_modules/duckdb/test{,/**}"));
  assert.ok(files.includes("!**/node_modules/duckdb/examples{,/**}"));
  assert.ok(files.includes("!**/node_modules/duckdb/scripts{,/**}"));
  assert.ok(files.every((filter) => !filter.includes("node_modules/duckdb/lib")));
});

test("Windows packages retain signed GitHub update metadata", () => {
  const packageJson = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8"));

  assert.equal(packageJson.vitanaUpdateChannel, "production");
  assert.equal(packageJson.build.win.target, "nsis");
  assert.equal(packageJson.build.win.verifyUpdateCodeSignature, true);
  assert.deepEqual(packageJson.build.publish, [{
    provider: "github",
    owner: "benleane83",
    repo: "vitana-health",
    channel: "latest",
    releaseType: "release"
  }]);
  assert.equal(packageJson.dependencies["electron-updater"], "6.6.2");
});

test("desktop updater shutdown callback is available during main-process initialization", () => {
  const mainProcess = readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const shutdownCallback = mainProcess.indexOf("async function shutdownApiForUpdate()");
  const updaterController = mainProcess.indexOf("const desktopUpdater = createDesktopUpdaterController(");
  const beforeQuitHandler = mainProcess.indexOf("app.on(\"before-quit\"");

  assert.ok(shutdownCallback >= 0);
  assert.ok(updaterController >= 0);
  assert.ok(beforeQuitHandler >= 0);
  assert.ok(shutdownCallback < beforeQuitHandler);
  assert.match(mainProcess.slice(updaterController, beforeQuitHandler), /prepareToInstall: shutdownApiForUpdate/);
});
