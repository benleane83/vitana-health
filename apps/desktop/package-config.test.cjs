const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

test("electron-builder publisherName stays within the Windows config", () => {
  const packageJson = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8"));

  assert.equal(packageJson.build.npmRebuild, false);
  assert.equal(Object.hasOwn(packageJson.build, "publisherName"), false);
  assert.equal(Object.hasOwn(packageJson.build.win, "publisherName"), false);
  assert.equal(packageJson.build.win.signtoolOptions.publisherName, "Local Fitness Advisor");
});

test("electron-builder excludes DuckDB development files but keeps runtime files", () => {
  const packageJson = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8"));
  const files = packageJson.build.files;

  assert.ok(files.includes("startup-diagnostics.cjs"));
  assert.ok(files.includes("!**/node_modules/duckdb/src{,/**}"));
  assert.ok(files.includes("!**/node_modules/duckdb/test{,/**}"));
  assert.ok(files.includes("!**/node_modules/duckdb/examples{,/**}"));
  assert.ok(files.includes("!**/node_modules/duckdb/scripts{,/**}"));
  assert.ok(files.every((filter) => !filter.includes("node_modules/duckdb/lib")));
});
