import { afterEach, beforeEach, describe, expect, it } from "vitest";
import duckdb from "duckdb";
import { all, exec } from "../storage/duckdbRows.js";
import { oldestRetainedChangeSequence, pruneRetention, retentionPolicy } from "../storage/duckdbRetention.js";

/**
 * Retention only touches log-shaped tables, so an in-memory database with just those tables is
 * enough - there is no need to stand up the encrypted runtime for these assertions.
 */
let database: duckdb.Database;
let connection: duckdb.Connection;

beforeEach(async () => {
  database = new duckdb.Database(":memory:");
  connection = database.connect();
  await exec(
    connection,
    `CREATE TABLE companion_sync_changes (sequence BIGINT PRIMARY KEY, entity_id VARCHAR);
     CREATE TABLE audit_events (ordinal BIGINT PRIMARY KEY, created_at TIMESTAMPTZ, action VARCHAR);
     CREATE TABLE companion_sync_snapshots (snapshot_id VARCHAR PRIMARY KEY, created_at TIMESTAMPTZ);
     CREATE TABLE companion_sync_snapshot_entries (snapshot_id VARCHAR, entity_id VARCHAR);`
  );
});

afterEach(async () => {
  await new Promise<void>((resolve) => { database.close(() => resolve()); });
});

async function count(table: string): Promise<number> {
  const rows = await all(connection, `SELECT COUNT(*) AS count FROM ${table};`);
  return Number(rows[0]?.count ?? 0);
}

describe("duckdb retention", () => {
  it("keeps only the most recent window of replica changes", async () => {
    const total = retentionPolicy.replicaChanges + 25;
    await exec(
      connection,
      `INSERT INTO companion_sync_changes SELECT range AS sequence, 'entity' AS entity_id FROM range(1, ${total + 1});`
    );

    const summary = await pruneRetention(connection);

    expect(summary.replicaChanges).toBe(25);
    expect(await count("companion_sync_changes")).toBe(retentionPolicy.replicaChanges);
    expect(await oldestRetainedChangeSequence(connection)).toBe(26);
  });

  it("leaves a change log inside the window untouched", async () => {
    await exec(connection, "INSERT INTO companion_sync_changes VALUES (1, 'a'), (2, 'b'), (3, 'c');");

    const summary = await pruneRetention(connection);

    expect(summary.replicaChanges).toBe(0);
    expect(await oldestRetainedChangeSequence(connection)).toBe(1);
  });

  it("drops audit events past the age limit and past the count limit", async () => {
    // Audit ordinals are prepended, so the newest row carries the smallest ordinal.
    await exec(
      connection,
      `INSERT INTO audit_events VALUES (0, now() - INTERVAL ${retentionPolicy.auditEventDays + 1} DAY, 'ancient');`
    );
    const recent = retentionPolicy.auditEvents + 10;
    await exec(
      connection,
      `INSERT INTO audit_events SELECT -range AS ordinal, now() AS created_at, 'recent' AS action
       FROM range(1, ${recent + 1});`
    );

    const summary = await pruneRetention(connection);

    expect(summary.auditEvents).toBe(11);
    expect(await count("audit_events")).toBe(retentionPolicy.auditEvents);
    const remaining = await all(connection, "SELECT DISTINCT action FROM audit_events;");
    expect(remaining.map((row) => row.action)).toEqual(["recent"]);
  });

  it("leaves a short audit trail untouched", async () => {
    await exec(connection, "INSERT INTO audit_events VALUES (0, now(), 'newest'), (-1, now(), 'older');");

    const summary = await pruneRetention(connection);

    expect(summary.auditEvents).toBe(0);
    expect(await count("audit_events")).toBe(2);
  });

  it("removes abandoned snapshots together with their entries", async () => {
    await exec(
      connection,
      `INSERT INTO companion_sync_snapshots VALUES
         ('stale', now() - INTERVAL ${retentionPolicy.snapshotHours + 1} HOUR),
         ('fresh', now());
       INSERT INTO companion_sync_snapshot_entries VALUES ('stale', 'a'), ('stale', 'b'), ('fresh', 'c');`
    );

    const summary = await pruneRetention(connection);

    expect(summary.snapshots).toBe(1);
    expect(await count("companion_sync_snapshots")).toBe(1);
    const entries = await all(connection, "SELECT snapshot_id FROM companion_sync_snapshot_entries;");
    expect(entries.map((row) => row.snapshot_id)).toEqual(["fresh"]);
  });
});
