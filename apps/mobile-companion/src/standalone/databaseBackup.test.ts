import { describe, expect, it, vi } from "vitest";

// The on-device store is a thin wrapper over the native module; only the decision logic below is
// under test, so the native surface is stubbed out to keep this a plain node test.
vi.mock("expo-file-system", () => ({
  Directory: class {},
  File: class {},
  Paths: { document: "document" }
}));

import {
  assertDatabaseIntegrity,
  assertRowCountsPreserved,
  captureMigrationBackup,
  countTrackedRows,
  discardMigrationBackup,
  migrationBackupName,
  restoreMigrationBackup,
  type DatabaseFileStore
} from "./databaseBackup";

function fakeFiles(initial: Record<string, string>): DatabaseFileStore & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial));
  return {
    files,
    exists: async (name) => files.has(name),
    copy: async (from, to) => {
      const content = files.get(from);
      if (content === undefined) throw new Error(`missing ${from}`);
      files.set(to, content);
    },
    remove: async (name) => {
      if (!files.delete(name)) throw new Error(`missing ${name}`);
    }
  };
}

const name = "standalone-health.db";

describe("migration backup", () => {
  it("copies only the database files that exist", async () => {
    const store = fakeFiles({ [name]: "main", [`${name}-wal`]: "wal" });

    const captured = await captureMigrationBackup(store, name, 2);

    expect(captured).toEqual(["", "-wal"]);
    expect(store.files.get(migrationBackupName(name, 2, ""))).toBe("main");
    expect(store.files.get(migrationBackupName(name, 2, "-wal"))).toBe("wal");
    expect(store.files.has(migrationBackupName(name, 2, "-shm"))).toBe(false);
  });

  it("restores the captured files and removes ones the failed migration created", async () => {
    const store = fakeFiles({ [name]: "before" });
    const captured = await captureMigrationBackup(store, name, 2);

    store.files.set(name, "half-migrated");
    store.files.set(`${name}-wal`, "frames from the failed migration");
    await restoreMigrationBackup(store, name, 2, captured);

    expect(store.files.get(name)).toBe("before");
    expect(store.files.has(`${name}-wal`)).toBe(false);
  });

  it("discards the backup once the migration is committed", async () => {
    const store = fakeFiles({ [name]: "main", [`${name}-shm`]: "shm" });
    const captured = await captureMigrationBackup(store, name, 3);

    await discardMigrationBackup(store, name, 3, captured);

    expect([...store.files.keys()]).toEqual([name, `${name}-shm`]);
  });
});

describe("migration verification", () => {
  it("counts only the tracked tables that already exist", async () => {
    const counts = await countTrackedRows({
      getAllAsync: async () => [{ name: "profiles" }, { name: "sqlite_sequence" }],
      getFirstAsync: async () => ({ total: 4 })
    } as never);

    expect(counts).toEqual({ profiles: 4 });
  });

  it("rejects a migration that loses rows or drops a table", () => {
    expect(() => assertRowCountsPreserved({ observations: 10 }, { observations: 10 })).not.toThrow();
    expect(() => assertRowCountsPreserved({ observations: 10 }, { observations: 11 })).not.toThrow();
    expect(() => assertRowCountsPreserved({ observations: 10 }, { observations: 9 })).toThrow("lost rows");
    expect(() => assertRowCountsPreserved({ observations: 10 }, {})).toThrow("dropped the observations table");
  });

  it("rejects anything other than a clean integrity check", async () => {
    await expect(
      assertDatabaseIntegrity({
        getAllAsync: async () => [],
        getFirstAsync: async () => ({ integrity_check: "ok" })
      } as never)
    ).resolves.toBeUndefined();

    await expect(
      assertDatabaseIntegrity({
        getAllAsync: async () => [],
        getFirstAsync: async () => ({ integrity_check: "row 3 missing from index" })
      } as never)
    ).rejects.toThrow("Integrity check failed");
  });
});
