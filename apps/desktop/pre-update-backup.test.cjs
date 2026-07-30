const assert = require("node:assert/strict");
const { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { createPreUpdateBackup } = require("./pre-update-backup.cjs");

function seedUserData() {
  const directory = mkdtempSync(path.join(tmpdir(), "vitana-pre-update-"));
  const databases = path.join(directory, "duckdb-storage", "databases");
  mkdirSync(databases, { recursive: true });
  writeFileSync(path.join(databases, "health-store-self.duckdb"), "self");
  writeFileSync(path.join(databases, "health-store-self.duckdb.wal"), "wal");
  writeFileSync(path.join(databases, "notes.txt"), "ignored");
  return directory;
}

test("pre-update backup copies database files and ignores everything else", () => {
  const directory = seedUserData();
  const destination = createPreUpdateBackup({
    userDataPath: directory,
    fromVersion: "1.2.3",
    toVersion: "1.3.0",
    now: new Date("2026-01-02T03:04:05.678Z")
  });
  assert.ok(destination);
  assert.equal(path.basename(destination), "1.2.3-to-1.3.0-2026-01-02T03-04-05-678Z");
  assert.deepEqual(readdirSync(destination).sort(), [
    "health-store-self.duckdb",
    "health-store-self.duckdb.wal"
  ]);
  rmSync(directory, { recursive: true, force: true });
});

test("pre-update backup is a no-op when there is no database directory", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "vitana-pre-update-"));
  assert.equal(createPreUpdateBackup({ userDataPath: directory, fromVersion: "1", toVersion: "2" }), undefined);
  assert.equal(existsSync(path.join(directory, "pre-update-backups")), false);
  rmSync(directory, { recursive: true, force: true });
});

test("pre-update backup keeps only the newest generations", () => {
  const directory = seedUserData();
  for (let index = 0; index < 5; index += 1) {
    createPreUpdateBackup({
      userDataPath: directory,
      fromVersion: "1.0.0",
      toVersion: `1.0.${index + 1}`,
      keep: 3,
      now: new Date(Date.UTC(2026, 0, index + 1))
    });
  }
  const kept = readdirSync(path.join(directory, "pre-update-backups")).sort();
  assert.equal(kept.length, 3);
  assert.ok(kept[2].startsWith("1.0.0-to-1.0.5-"));
  rmSync(directory, { recursive: true, force: true });
});
