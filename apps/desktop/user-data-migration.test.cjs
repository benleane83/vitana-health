const assert = require("node:assert/strict");
const fs = require("node:fs");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = fs;
const { tmpdir } = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const { migrateUserDataDirectory } = require("./user-data-migration.cjs");

const roots = [];

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "vitana-user-data-"));
  roots.push(root);
  return {
    root,
    legacy: path.join(root, "Local Fitness Advisor"),
    destination: path.join(root, "Vitana Health")
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("uses the branded directory when no legacy data exists", () => {
  const value = fixture();
  assert.equal(migrateUserDataDirectory(value.root), value.destination);
});

test("moves legacy profile data and is idempotent", () => {
  const value = fixture();
  mkdirSync(value.legacy);
  writeFileSync(path.join(value.legacy, "profile.db"), "encrypted");

  assert.equal(migrateUserDataDirectory(value.root), value.destination);
  assert.equal(readFileSync(path.join(value.destination, "profile.db"), "utf8"), "encrypted");
  assert.equal(migrateUserDataDirectory(value.root), value.destination);
});

test("replaces an empty destination but never merges populated directories", () => {
  const value = fixture();
  mkdirSync(value.legacy);
  mkdirSync(value.destination);
  writeFileSync(path.join(value.legacy, "legacy.db"), "legacy");
  assert.equal(migrateUserDataDirectory(value.root), value.destination);
  assert.equal(readFileSync(path.join(value.destination, "legacy.db"), "utf8"), "legacy");

  mkdirSync(value.legacy);
  writeFileSync(path.join(value.legacy, "other.db"), "other");
  assert.throws(() => migrateUserDataDirectory(value.root), /Both .* contain data/);
});

test("leaves legacy data in place when migration cannot complete", () => {
  const value = fixture();
  mkdirSync(value.legacy);
  writeFileSync(path.join(value.legacy, "profile.db"), "encrypted");

  assert.throws(
    () => migrateUserDataDirectory(value.root, { ...fs, renameSync() { throw new Error("interrupted"); } }),
    /could not move the existing profile folder/
  );
  assert.equal(readFileSync(path.join(value.legacy, "profile.db"), "utf8"), "encrypted");
});
