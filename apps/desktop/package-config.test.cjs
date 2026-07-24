const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

test("electron-builder excludes DuckDB development files but keeps runtime files", () => {
  const packageJson = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8"));
  const files = packageJson.build.files;

  assert.equal(packageJson.build.npmRebuild, false);
  assert.ok(files.includes("startup-diagnostics.cjs"));
  assert.ok(files.includes("desktop-updater.cjs"));
  assert.ok(files.includes("background-service.cjs"));
  assert.ok(files.includes("background-service-settings.cjs"));
  assert.ok(files.includes("user-data-migration.cjs"));
  assert.ok(files.includes("build/*.ico"));
  assert.equal(packageJson.build.win.icon, "build/icon.ico");
  assert.ok(files.includes("!**/node_modules/@vitana/api/data{,/**}"));
  assert.ok(files.includes("!**/node_modules/@vitana/api/src{,/**}"));
  assert.ok(files.includes("!**/node_modules/@vitana/api/{tsconfig.json,vitest.config.ts,vitest.durability.config.ts,vitest.integration.config.ts}"));
  assert.ok(files.includes("!**/node_modules/duckdb/src{,/**}"));
  assert.ok(files.includes("!**/node_modules/duckdb/test{,/**}"));
  assert.ok(files.includes("!**/node_modules/duckdb/examples{,/**}"));
  assert.ok(files.includes("!**/node_modules/duckdb/scripts{,/**}"));
  assert.ok(files.every((filter) => !filter.includes("node_modules/duckdb/lib")));
});

test("Windows preview packages use checksummed GitHub updates without Authenticode", () => {
  const packageJson = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8"));

  assert.equal(packageJson.scripts.package, "electron-builder --publish=never");
  assert.equal(packageJson.vitanaDistributionChannel, "github");
  assert.equal(packageJson.vitanaUpdateChannel, "production");
  assert.equal(packageJson.build.win.target, "nsis");
  assert.equal(packageJson.build.win.signExecutable, false);
  assert.equal(packageJson.build.win.verifyUpdateCodeSignature, false);
  assert.equal(Object.hasOwn(packageJson.build.win, "signtoolOptions"), false);
  assert.equal(packageJson.build.nsis.artifactName, "Vitana-Health-Setup-${version}.${ext}");
  assert.deepEqual(packageJson.build.publish, [{
    provider: "github",
    owner: "benleane83",
    repo: "vitana-health",
    channel: "latest",
    releaseType: "release"
  }]);
  assert.equal(packageJson.dependencies["electron-updater"], "6.6.2");
});

test("Store packages use an isolated AppX target and placeholder identity", () => {
  const packageJson = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8"));

  assert.match(packageJson.scripts["package:store"], /--win appx --x64/);
  assert.match(packageJson.scripts["package:store"], /dist-store/);
  assert.match(packageJson.scripts["package:store"], /vitanaDistributionChannel=store/);
  assert.equal(packageJson.build.win.target, "nsis");
  assert.equal(packageJson.build.appx.identityName, "VitanaHealth.StoreTest");
  assert.equal(packageJson.build.appx.publisher, "CN=Vitana Health Store Test");
  assert.deepEqual(packageJson.build.appx.capabilities, [
    "runFullTrust",
    "internetClientServer",
    "privateNetworkClientServer"
  ]);
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
  assert.match(mainProcess, /distributionChannel === "store" \? "Vitana Health Store Test" : "Vitana Health"/);
});
