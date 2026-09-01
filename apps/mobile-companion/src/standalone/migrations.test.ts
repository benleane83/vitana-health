import { describe, expect, it, vi } from "vitest";
import { LOCAL_SCHEMA_VERSION } from "./localStore";
import {
  migrate,
  migrationSql,
  migrations,
  validateSchemaVersion,
  type MigrationDatabase
} from "./migrations";

/**
 * A migration target that tracks `user_version` the way SQLite does, so the runner's
 * set-then-assert contract is exercised rather than mocked away.
 */
function fakeDatabase(startVersion: number, options: { failAt?: number } = {}) {
  let version = startVersion;
  const executed: string[] = [];
  const transactions: number[] = [];
  const database = {
    getFirstAsync: vi.fn(async (query: string) => {
      if (query === "PRAGMA user_version") return { user_version: version };
      return null;
    }),
    execAsync: vi.fn(async (query: string) => {
      const bump = /PRAGMA user_version = (\d+);/.exec(query);
      if (bump) {
        if (options.failAt === Number(bump[1])) throw new Error("simulated migration failure");
        version = Number(bump[1]);
        return;
      }
      executed.push(query);
    }),
    withTransactionAsync: vi.fn(async (task: () => Promise<void>) => {
      const snapshot = version;
      transactions.push(snapshot);
      try {
        await task();
      } catch (error) {
        version = snapshot;
        throw error;
      }
    })
  };
  return {
    database: database as unknown as MigrationDatabase,
    executed,
    transactions,
    currentVersion: () => version
  };
}

describe("standalone schema migrations", () => {
  it("declares a contiguous chain that ends at the supported schema version", () => {
    expect(migrations.map((migration) => migration.version)).toEqual(
      Array.from({ length: LOCAL_SCHEMA_VERSION }, (_, index) => index + 1)
    );
    for (const migration of migrations) {
      expect(migration.sql).not.toContain("PRAGMA user_version");
    }
  });

  it("creates profile-isolated storage then adds explicit dataset metadata incrementally", () => {
    const initialSql = migrationSql(0);
    expect(initialSql).toContain("CREATE TABLE profiles");
    expect(initialSql).toContain("PRIMARY KEY (profile_id, id)");
    expect(initialSql).toContain("observations_measurement_time_idx");
    const incrementalSql = migrationSql(1);
    expect(incrementalSql).toContain("CREATE TABLE datasets");
    expect(incrementalSql).toContain("migration_receipt_json");
    expect(incrementalSql).toContain("SELECT COUNT(*) FROM profiles");
    expect(incrementalSql).not.toContain("COUNT(*) FROM observations");
    const replicaSql = migrationSql(2);
    expect(replicaSql).toContain("CREATE TABLE connected_replicas");
    expect(replicaSql).toContain("connected_replica_entities");
    const resumableSql = migrationSql(3);
    expect(resumableSql).toContain("ADD COLUMN snapshot_cursor");
    expect(resumableSql).toContain("ADD COLUMN applied_at");
    expect(resumableSql).toContain("DROP INDEX IF EXISTS connected_replica_entities_type_idx");
    const careSql = migrationSql(5);
    expect(careSql).toContain("CREATE TABLE health_events");
    expect(careSql).toContain("CREATE TABLE care_items");
    expect(careSql).toContain("care_items_filter_idx");
    const statusSql = migrationSql(6);
    expect(statusSql).toContain("SET status = 'cancelled'");
    expect(statusSql).toContain("json_set(payload_json, '$.status', 'cancelled')");
    const medicationSimplificationSql = migrationSql(8);
    expect(medicationSimplificationSql).toContain("CREATE TABLE medications_v9");
    expect(medicationSimplificationSql).toContain("'$.status'");
    expect(medicationSimplificationSql).not.toContain("status TEXT NOT NULL");
    const profileNormalizationSql = migrationSql(10);
    expect(profileNormalizationSql).toContain("ADD COLUMN subject_kind");
    expect(profileNormalizationSql).toContain("ADD COLUMN units");
    expect(profileNormalizationSql).toContain("json_extract(profile_json, '$.birthDate')");
  });

  it("evicts the replica cache from the durable database and never rebuilds it there", () => {
    // Versions 3 and 4 created and altered the cache in this file; version 5 is the eviction. The
    // history stays so databases already at 4 have a path forward, but nothing after it may put a
    // cache table back - that would undo the split.
    const evictionSql = migrationSql(4);
    expect(evictionSql).toContain("DROP TABLE IF EXISTS connected_replicas");
    expect(evictionSql).toContain("DROP TABLE IF EXISTS connected_replica_entities");
    const afterEviction = migrations.filter((migration) => migration.version > 5);
    for (const migration of afterEviction) {
      expect(migration.sql).not.toMatch(/CREATE TABLE\s+(IF NOT EXISTS\s+)?connected_replica/i);
    }
  });

  it("rejects impossible schema versions and unreachable migration paths", () => {
    expect(() => validateSchemaVersion(-1)).toThrow("Invalid database schema");
    expect(() => validateSchemaVersion(1.5)).toThrow("Invalid database schema");
    expect(() => migrationSql(LOCAL_SCHEMA_VERSION)).toThrow("No migration path");
  });

  it("migrates on the existing keyed database connection", async () => {
    const { database, executed, transactions } = fakeDatabase(0);
    const withExclusiveTransactionAsync = vi.fn(() => {
      throw new Error("must not open a second SQLCipher connection");
    });
    Object.assign(database, { withExclusiveTransactionAsync });

    const outcome = await migrate(database);

    expect(outcome).toEqual({
      schemaVersion: LOCAL_SCHEMA_VERSION,
      readOnly: false,
      appliedVersions: migrations.map((migration) => migration.version)
    });
    expect(transactions).toHaveLength(LOCAL_SCHEMA_VERSION);
    expect(withExclusiveTransactionAsync).not.toHaveBeenCalled();
    expect(executed).toEqual(migrations.map((migration) => migration.sql));
  });

  // Each migration must apply cleanly to a database sitting at the version immediately below it,
  // which is the only state a real upgrade ever encounters.
  for (const migration of migrations) {
    it(`applies migration ${migration.version} to a database at schema ${migration.version - 1}`, async () => {
      const { database, executed, currentVersion } = fakeDatabase(migration.version - 1);

      const outcome = await migrate(database);

      expect(executed[0]).toBe(migration.sql);
      expect(outcome.appliedVersions[0]).toBe(migration.version);
      expect(currentVersion()).toBe(LOCAL_SCHEMA_VERSION);
    });
  }

  it("bumps user_version inside the migration transaction so a failure rolls both back", async () => {
    const { database, currentVersion, transactions } = fakeDatabase(0, { failAt: 2 });

    await expect(migrate(database)).rejects.toThrow("simulated migration failure");

    expect(currentVersion()).toBe(1);
    expect(transactions).toEqual([0, 1]);
  });

  it("fails loudly when a version bump does not take effect", async () => {
    const database = {
      getFirstAsync: vi.fn(async () => ({ user_version: 0 })),
      execAsync: vi.fn(async () => undefined),
      withTransactionAsync: vi.fn(async (task: () => Promise<void>) => task())
    } as unknown as MigrationDatabase;

    await expect(migrate(database)).rejects.toThrow("did not take effect");
  });

  it("reports a read-only state instead of throwing when a newer build wrote the file", async () => {
    const { database, executed } = fakeDatabase(LOCAL_SCHEMA_VERSION + 3);

    const outcome = await migrate(database);

    expect(outcome).toEqual({
      schemaVersion: LOCAL_SCHEMA_VERSION + 3,
      readOnly: true,
      appliedVersions: []
    });
    expect(executed).toEqual([]);
  });

  it("is a no-op at the current schema version", async () => {
    const { database, executed } = fakeDatabase(LOCAL_SCHEMA_VERSION);

    const outcome = await migrate(database);

    expect(outcome.readOnly).toBe(false);
    expect(outcome.appliedVersions).toEqual([]);
    expect(executed).toEqual([]);
  });
});
