import type duckdb from "duckdb";
import { all, allWithParams, exec, run } from "./duckdbRows.js";

/**
 * The companion protocol has no server-side acknowledgement cursor, so the change log cannot be
 * trimmed against what devices have actually consumed. Instead the server keeps a bounded window
 * and reports a gap when a device asks for something older; the device then restarts from a
 * snapshot, which the protocol already supports. Everything else here is plain age/volume capping
 * so a long-lived profile database cannot grow without limit.
 */
export const retentionPolicy = {
  /** Roughly a fortnight of heavy syncing, and far more than a phone that checks in daily needs. */
  replicaChanges: 50_000,
  auditEventDays: 365,
  auditEvents: 20_000,
  /** A first sync should finish in minutes; a day-old snapshot has been abandoned. */
  snapshotHours: 24
} as const;

export interface RetentionSummary {
  replicaChanges: number;
  auditEvents: number;
  snapshots: number;
}

export class ReplicaDeltaGapError extends Error {
  readonly oldestRetainedSequence: number;
  constructor(oldestRetainedSequence: number) {
    super("The requested change sequence is older than the retained change log.");
    this.name = "ReplicaDeltaGapError";
    this.oldestRetainedSequence = oldestRetainedSequence;
  }
}

export async function pruneRetention(connection: duckdb.Connection): Promise<RetentionSummary> {
  await exec(connection, "BEGIN TRANSACTION;");
  try {
    const summary = {
      replicaChanges: await pruneReplicaChanges(connection),
      auditEvents: await pruneAuditEvents(connection),
      snapshots: await pruneAbandonedSnapshots(connection)
    };
    await exec(connection, "COMMIT;");
    return summary;
  } catch (error) {
    await exec(connection, "ROLLBACK;").catch(() => undefined);
    throw error;
  }
}

export async function oldestRetainedChangeSequence(connection: duckdb.Connection): Promise<number> {
  const rows = await all(connection, "SELECT COALESCE(MIN(sequence), 0) AS sequence FROM companion_sync_changes;");
  return Number(rows[0]?.sequence ?? 0);
}

async function pruneReplicaChanges(connection: duckdb.Connection): Promise<number> {
  const rows = await all(connection, "SELECT COALESCE(MAX(sequence), 0) AS sequence FROM companion_sync_changes;");
  const cutoff = Number(rows[0]?.sequence ?? 0) - retentionPolicy.replicaChanges;
  if (cutoff <= 0) {
    return 0;
  }
  return deleteAndCount(
    connection,
    "SELECT COUNT(*) AS count FROM companion_sync_changes WHERE sequence <= ?;",
    "DELETE FROM companion_sync_changes WHERE sequence <= ?;",
    cutoff
  );
}

async function pruneAuditEvents(connection: duckdb.Connection): Promise<number> {
  const aged = await deleteAndCount(
    connection,
    `SELECT COUNT(*) AS count FROM audit_events WHERE created_at < now() - INTERVAL ${retentionPolicy.auditEventDays} DAY;`,
    `DELETE FROM audit_events WHERE created_at < now() - INTERVAL ${retentionPolicy.auditEventDays} DAY;`
  );
  const cutoff = await auditOrdinalCutoff(connection);
  if (cutoff === undefined) {
    return aged;
  }
  const surplus = await deleteAndCount(
    connection,
    "SELECT COUNT(*) AS count FROM audit_events WHERE ordinal >= ?;",
    "DELETE FROM audit_events WHERE ordinal >= ?;",
    cutoff
  );
  return aged + surplus;
}

/**
 * Audit ordinals are prepended, so they descend as events are added and the newest row carries the
 * smallest ordinal. The cutoff is therefore the first ordinal past the retained window in ascending
 * order, and it plus everything above it is older than the window.
 */
async function auditOrdinalCutoff(connection: duckdb.Connection): Promise<number | undefined> {
  const rows = await allWithParams(
    connection,
    "SELECT ordinal FROM audit_events ORDER BY ordinal ASC LIMIT 1 OFFSET ?;",
    retentionPolicy.auditEvents
  );
  return rows[0] === undefined ? undefined : Number(rows[0].ordinal);
}

async function pruneAbandonedSnapshots(connection: duckdb.Connection): Promise<number> {
  const stale = `created_at < now() - INTERVAL ${retentionPolicy.snapshotHours} HOUR`;
  await run(
    connection,
    `DELETE FROM companion_sync_snapshot_entries WHERE snapshot_id IN
     (SELECT snapshot_id FROM companion_sync_snapshots WHERE ${stale});`
  );
  return deleteAndCount(
    connection,
    `SELECT COUNT(*) AS count FROM companion_sync_snapshots WHERE ${stale};`,
    `DELETE FROM companion_sync_snapshots WHERE ${stale};`
  );
}

async function deleteAndCount(
  connection: duckdb.Connection,
  countSql: string,
  deleteSql: string,
  ...parameters: unknown[]
): Promise<number> {
  const rows = parameters.length > 0
    ? await allWithParams(connection, countSql, ...parameters)
    : await all(connection, countSql);
  const count = Number(rows[0]?.count ?? 0);
  if (count > 0) {
    await run(connection, deleteSql, ...parameters);
  }
  return count;
}
