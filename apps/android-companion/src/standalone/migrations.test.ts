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
    expect(incrementalSql).toContain("SELECT COUNT(*) FROM profiles");
    expect(incrementalSql).not.toContain("COUNT(*) FROM observations");
    expect(incrementalSql).toContain("PRAGMA user_version = 2");
    const replicaSql = migrationSql(2);
    expect(replicaSql).toContain("CREATE TABLE connected_replicas");
    expect(replicaSql).toContain("connected_replica_entities");
    expect(replicaSql).toContain("PRAGMA user_version = 3");
    const resumableSql = migrationSql(3);
    expect(resumableSql).toContain("ADD COLUMN snapshot_cursor");
    expect(resumableSql).toContain("ADD COLUMN applied_at");
    expect(resumableSql).toContain("DROP INDEX IF EXISTS connected_replica_entities_type_idx");
    expect(resumableSql).toContain(`PRAGMA user_version = ${LOCAL_SCHEMA_VERSION}`);
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

    expect(withTransactionAsync).toHaveBeenCalledTimes(LOCAL_SCHEMA_VERSION);
    expect(withExclusiveTransactionAsync).not.toHaveBeenCalled();
    expect(execAsync).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE profiles"));
    expect(execAsync).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE datasets"));
    expect(execAsync).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE connected_replicas"));
    expect(execAsync).toHaveBeenCalledWith(expect.stringContaining("ADD COLUMN snapshot_cursor"));
  });
});
