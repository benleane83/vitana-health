const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { createBackgroundServiceSettingsStore } = require("./background-service-settings.cjs");

test("desktop settings default and malformed or unknown versions fail closed", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "lfa-background-settings-"));
  const store = createBackgroundServiceSettingsStore({ userDataPath: directory });
  assert.deepEqual(store.read(), { version: 1, backgroundServiceEnabled: false, closeNotificationShown: false });
  writeFileSync(store.filePath, '{"version":2,"backgroundServiceEnabled":true,"closeNotificationShown":true}');
  assert.equal(store.read().backgroundServiceEnabled, false);
  writeFileSync(store.filePath, "{malformed");
  assert.equal(store.read().backgroundServiceEnabled, false);
  rmSync(directory, { recursive: true, force: true });
});

test("desktop settings are persisted through an atomic rename", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "lfa-background-settings-"));
  const operations = [];
  const realFs = require("node:fs");
  const store = createBackgroundServiceSettingsStore({
    userDataPath: directory,
    fileSystem: {
      ...realFs,
      writeFileSync: (...args) => { operations.push(["write", args[0]]); return realFs.writeFileSync(...args); },
      renameSync: (...args) => { operations.push(["rename", ...args]); return realFs.renameSync(...args); }
    }
  });
  store.write({ backgroundServiceEnabled: true, closeNotificationShown: false });
  assert.equal(JSON.parse(readFileSync(store.filePath, "utf8")).backgroundServiceEnabled, true);
  assert.match(operations[0][1], /\.tmp$/);
  assert.deepEqual(operations[1], ["rename", operations[0][1], store.filePath]);
  rmSync(directory, { recursive: true, force: true });
});
