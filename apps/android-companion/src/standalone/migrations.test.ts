import { describe, expect, it } from "vitest";
import { LOCAL_SCHEMA_VERSION } from "./localStore";
import { migrationSql, validateSchemaVersion } from "./migrations";

describe("standalone schema migrations", () => {
  it("creates profile-isolated indexed storage and advances the version in one migration batch", () => {
    const sql = migrationSql(0);
    expect(sql).toContain("CREATE TABLE profiles");
    expect(sql).toContain("PRIMARY KEY (profile_id, id)");
    expect(sql).toContain("observations_measurement_time_idx");
    expect(sql).toContain(`PRAGMA user_version = ${LOCAL_SCHEMA_VERSION}`);
  });

  it("rejects future, negative, and unsupported schema versions", () => {
    expect(() => validateSchemaVersion(LOCAL_SCHEMA_VERSION + 1)).toThrow("newer than supported");
    expect(() => validateSchemaVersion(-1)).toThrow("Invalid database schema");
    expect(() => migrationSql(LOCAL_SCHEMA_VERSION)).toThrow("No migration path");
  });
});
