const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

function readPngDimensions(filePath) {
  const png = readFileSync(filePath);
  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

test("electron-builder excludes DuckDB development files but keeps runtime files", () => {
  const packageJson = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8"));
  const files = packageJson.build.files;

  assert.equal(packageJson.build.npmRebuild, false);
  assert.ok(files.includes("startup-diagnostics.cjs"));
  assert.ok(files.includes("desktop-updater.cjs"));
  assert.ok(files.includes("background-service.cjs"));
  assert.ok(files.includes("background-service-settings.cjs"));
  assert.ok(files.includes("certificate-pin.cjs"));
  assert.ok(files.includes("desktop-platform.cjs"));
  assert.ok(files.includes("xdg-autostart.cjs"));
  assert.ok(files.includes("user-data-migration.cjs"));
  assert.ok(files.includes("build/*.ico"));
  assert.ok(files.includes("build/*.png"));
  assert.equal(packageJson.build.win.icon, "build/icon.ico");
  assert.ok(packageJson.build.extraResources.some((resource) =>
    resource.from === "build/tray-icon.ico" && resource.to === "tray-icon.ico"
  ));
  assert.ok(packageJson.build.extraResources.some((resource) =>
    resource.from === "build/tray-icon.png" && resource.to === "tray-icon.png"
  ));
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

  assert.equal(packageJson.scripts.package, "npm run verify:native-abi && electron-builder --publish=never");
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
  assert.equal(packageJson.dependencies["electron-updater"], "6.8.9");
});

test("the preview installer is per-user and performs no elevated firewall setup", () => {
  const packageJson = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8"));

  assert.equal(packageJson.build.nsis.perMachine, false);
  assert.equal(Object.hasOwn(packageJson.build.nsis, "include"), false);
  assert.equal(existsSync(path.join(__dirname, "build", "installer.nsh")), false);
});

test("every packaging path runs the Electron ABI gate before electron-builder", () => {
  const packageJson = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8"));

  // npmRebuild is off, so the DuckDB prebuild is never recompiled for Electron. The gate is the
  // only thing that proves the shipped binary matches the shipped runtime's module ABI.
  assert.equal(packageJson.build.npmRebuild, false);
  assert.equal(packageJson.scripts["verify:native-abi"], "electron verify-native-abi.cjs");
  assert.equal(
    packageJson.scripts["verify:native-abi:linux"],
    "electron --headless --disable-gpu --no-sandbox verify-native-abi.cjs"
  );
  assert.match(
    packageJson.scripts["package:linux"],
    /npm run verify:native-abi:linux &&[^&]*electron-builder/,
    "package:linux must run the Linux ABI gate before electron-builder"
  );
  for (const script of ["package", "package:store"]) {
    assert.match(
      packageJson.scripts[script],
      /npm run verify:native-abi &&[^&]*electron-builder/,
      `${script} must run the ABI gate before electron-builder`
    );
  }
  // The gate is build tooling, not runtime code, so it must not reach the packaged app.
  assert.ok(!packageJson.build.files.includes("verify-native-abi.cjs"));
});

test("Linux packages are x64 AppImages with manual updates and PNG assets", () => {
  const packageJson = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8"));

  assert.match(packageJson.scripts["package:linux"], /--linux AppImage --x64/);
  assert.match(packageJson.scripts["package:linux"], /vitanaDistributionChannel=linux-appimage/);
  assert.match(packageJson.scripts["package:linux"], /vitanaUpdateChannel=manual/);
  assert.equal(packageJson.build.executableName, "vitana-health");
  assert.equal(packageJson.build.linux.target, "AppImage");
  assert.equal(packageJson.build.linux.artifactName, "Vitana-Health-${version}-linux-x86_64.${ext}");
  assert.equal(packageJson.build.linux.category, "Utility");
  assert.equal(packageJson.build.linux.icon, "build/icon.png");
  for (const asset of ["icon.png", "tray-icon.png"]) {
    const assetPath = path.join(__dirname, "build", asset);
    assert.ok(existsSync(assetPath), `${asset} must exist`);
    const dimensions = readPngDimensions(assetPath);
    assert.ok(dimensions.width >= 32 && dimensions.height >= 32);
  }
});

test("Store packages use an isolated AppX target and Partner Center identity", () => {
  const packageJson = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8"));

  assert.match(packageJson.scripts["package:store"], /--win appx --x64/);
  assert.match(packageJson.scripts["package:store"], /dist-store/);
  assert.match(packageJson.scripts["package:store"], /vitanaDistributionChannel=store/);
  assert.equal(packageJson.build.win.target, "nsis");
  assert.equal(packageJson.build.appx.artifactName, "Vitana-Health-${version}.${ext}");
  assert.equal(packageJson.build.appx.identityName, "AdaptivaAI.VitanaHealth");
  assert.equal(packageJson.build.appx.publisher, "CN=ED882BA6-5AB9-46D8-927C-C72EC1A38D56");
  assert.equal(packageJson.build.appx.publisherDisplayName, "Adaptiva AI");
  assert.equal(packageJson.build.appx.displayName, "Vitana Health");
  assert.deepEqual(packageJson.build.appx.capabilities, [
    "runFullTrust",
    "internetClientServer",
    "privateNetworkClientServer"
  ]);

  for (const [fileName, dimensions] of [
    ["Square44x44Logo.png", { width: 44, height: 44 }],
    ["StoreLogo.png", { width: 50, height: 50 }]
  ]) {
    const logoPath = path.join(__dirname, "build", "appx", fileName);
    assert.ok(existsSync(logoPath), `${fileName} must override electron-builder's default logo`);
    assert.deepEqual(readPngDimensions(logoPath), dimensions);
  }
});

test("desktop updater shutdown callback is available during main-process initialization", () => {
  const mainProcess = readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const shutdownCallback = mainProcess.indexOf("async function shutdownApiForUpdate(");
  const updaterController = mainProcess.indexOf("const desktopUpdater = createDesktopUpdaterController(");
  const beforeQuitHandler = mainProcess.indexOf("app.on(\"before-quit\"");

  assert.ok(shutdownCallback >= 0);
  assert.ok(updaterController >= 0);
  assert.ok(beforeQuitHandler >= 0);
  assert.ok(shutdownCallback < beforeQuitHandler);
  assert.match(mainProcess.slice(updaterController, beforeQuitHandler), /prepareToInstall: shutdownApiForUpdate/);
  assert.match(mainProcess, /distributionChannel === "store" \? "Vitana Health Store" : "Vitana Health"/);
});

test("every local module main.cjs requires is packaged", () => {
  // `files` replaces electron-builder's default `**/*`, so a new local module is silently left out
  // of the asar and only fails once someone installs the build. `pre-update-backup.cjs` was.
  const packageJson = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8"));
  const mainProcess = readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const required = [...mainProcess.matchAll(/require\("\.\/([^"]+\.cjs)"\)/g)].map((match) => match[1]);

  assert.ok(required.length > 0);
  for (const module of new Set(required)) {
    assert.ok(packageJson.build.files.includes(module), `${module} must be listed in build.files`);
  }
});

test("DuckDB is pinned to an exact version matching the shared httpfs digest", () => {
  const apiPackageJson = JSON.parse(
    readFileSync(path.join(__dirname, "..", "api", "package.json"), "utf8")
  );
  const pinSource = readFileSync(
    path.join(__dirname, "..", "..", "packages", "shared", "src", "duckdbPin.ts"),
    "utf8"
  );
  const pinnedVersion = /PINNED_DUCKDB_VERSION = "([^"]+)"/.exec(pinSource)?.[1];

  // A caret range would let npm resolve a DuckDB build whose core-signed httpfs extension no
  // longer matches the digest we verify at runtime, turning an upgrade into a startup failure.
  assert.ok(pinnedVersion, "shared duckdbPin.ts must declare PINNED_DUCKDB_VERSION");
  assert.equal(apiPackageJson.dependencies.duckdb, pinnedVersion);
});
