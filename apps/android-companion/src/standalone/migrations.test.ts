import { describe, expect, it, vi } from "vitest";
import { LOCAL_SCHEMA_VERSION } from "./localStore";
import { migrate, migrationSql, validateSchemaVersion, type MigrationDatabase } from "./migrations";

describe("standalone schema migrations", () => {
  it("creates profile-isolated storage then adds explicit dataset metadata incrementally", () => {
    const initialSql = migrationSql(0);
    expect(initialSql).toContain("CREATE TABLE profiles");
    expect(initialSql).toContain("PRIMARY KEY (profile_id, id)");
    expect(initialSql).toContain("observations_measurement_time_idx");
    expect(initialSql).toContain("PRAGMA user_version = 1");
    const incrementalSql = migrationSql(1);
    expect(incrementalSql).toContain("CREATE TABLE datasets");
    expect(incrementalSql).toContain("migration_receipt_json");
    expect(incrementalSql).toContain("COUNT(*) FROM observations");
    expect(incrementalSql).toContain(`PRAGMA user_version = ${LOCAL_SCHEMA_VERSION}`);
  });

  it("rejects future, negative, and unsupported schema versions", () => {
    expect(() => validateSchemaVersion(LOCAL_SCHEMA_VERSION + 1)).toThrow("newer than supported");
    expect(() => validateSchemaVersion(-1)).toThrow("Invalid database schema");
    expect(() => migrationSql(LOCAL_SCHEMA_VERSION)).toThrow("No migration path");
  });

  it("migrates on the existing keyed database connection", async () => {
    const execAsync = vi.fn().mockResolvedValue(undefined);
    const withTransactionAsync = vi.fn(async (task: () => Promise<void>) => task());
    const withExclusiveTransactionAsync = vi.fn(() => {
      throw new Error("must not open a second SQLCipher connection");
    });
    const database = {
      getFirstAsync: vi.fn().mockResolvedValue({ user_version: 0 }),
      execAsync,
      withTransactionAsync,
      withExclusiveTransactionAsync
    } as unknown as MigrationDatabase;

    await migrate(database);

    expect(withTransactionAsync).toHaveBeenCalledTimes(2);
    expect(withExclusiveTransactionAsync).not.toHaveBeenCalled();
    expect(execAsync).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE profiles"));
    expect(execAsync).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE datasets"));
  });
});
