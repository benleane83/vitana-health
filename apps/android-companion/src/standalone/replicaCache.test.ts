import { describe, expect, it, vi } from "vitest";

import { REPLICA_SCHEMA_VERSION } from "./localStore";
import { prepareReplicaCache, type ReplicaCacheDatabase } from "./replicaCache";

function fakeCache(userVersion: number) {
  const executed: string[] = [];
  const database: ReplicaCacheDatabase = {
    execAsync: vi.fn(async (sql: string) => {
      executed.push(sql);
    }),
    getFirstAsync: vi.fn(async () => ({ user_version: userVersion })) as ReplicaCacheDatabase["getFirstAsync"]
  };
  return { executed, database };
}

describe("replica cache", () => {
  it("creates the cache on a fresh install and stamps its version", async () => {
    const { database, executed } = fakeCache(0);
    const result = await prepareReplicaCache(database);
    expect(result.rebuilt).toBe(true);
    expect(executed.join("\n")).toContain("CREATE TABLE IF NOT EXISTS connected_replicas");
    expect(executed.join("\n")).toContain(`PRAGMA user_version = ${REPLICA_SCHEMA_VERSION}`);
  });

  it("leaves a cache at the current version alone", async () => {
    const { database, executed } = fakeCache(REPLICA_SCHEMA_VERSION);
    const result = await prepareReplicaCache(database);
    expect(result.rebuilt).toBe(false);
    expect(executed.join("\n")).not.toContain("DROP TABLE");
    expect(executed.join("\n")).not.toContain("PRAGMA user_version =");
  });

  it("throws a differently-shaped cache away instead of migrating it", async () => {
    // The point of the split: a cache-shaped change costs one re-sync, not a backed-up, row-count
    // asserted migration of the user's own records. A version written by a newer build is rebuilt
    // too - an old binary cannot read it, but it can always ask the PC for a fresh copy, so there
    // is no read-only state to fall into.
    const { database, executed } = fakeCache(REPLICA_SCHEMA_VERSION + 1);
    const result = await prepareReplicaCache(database);
    expect(result.rebuilt).toBe(true);
    const sql = executed.join("\n");
    expect(sql.indexOf("DROP TABLE IF EXISTS connected_replicas"))
      .toBeLessThan(sql.indexOf("CREATE TABLE IF NOT EXISTS connected_replicas"));
  });
});
