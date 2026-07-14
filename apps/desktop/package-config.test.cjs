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
