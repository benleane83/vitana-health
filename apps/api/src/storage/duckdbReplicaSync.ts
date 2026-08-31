import { randomUUID } from "node:crypto";
import type duckdb from "duckdb";
import {
  COMPANION_REPLICA_PROTOCOL_VERSION,
  type HealthStoreData,
  type ReplicaChange,
  type ReplicaEntityType,
  type ReplicaHighWaterMark
} from "@vitana/shared";
import { all, allWithParams, insertRows, json, run } from "./duckdbRows.js";
import { oldestRetainedChangeSequence, ReplicaDeltaGapError } from "./duckdbRetention.js";
import { isReplicatedMeasurementCode, type ReplicaChangeInput } from "./duckdbReplicaChanges.js";
import type { StoredReplicaPage } from "./types.js";

export type { ReplicaChangeInput };
export type { StoredReplicaPage };

export interface ReplicaEntity {
  entityType: ReplicaEntityType;
  entityId: string;
  payload: Record<string, unknown>;
}

/** Every `HealthStoreData` field that holds a collection of replicable entities. */
type ReplicaCollectionKey = {
  [K in keyof HealthStoreData]-?: NonNullable<HealthStoreData[K]> extends readonly unknown[] ? K : never
}[keyof HealthStoreData];

type ReplicaCollectionItem<K extends ReplicaCollectionKey> = NonNullable<HealthStoreData[K]>[number];

interface ReplicaCollection {
  entityType: ReplicaEntityType;
  key: ReplicaCollectionKey;
  id: (value: unknown) => string;
}

/**
 * Binds an id accessor to the element type of the collection it reads, so `value.code` versus
 * `value.measurementCode` versus `value.id` is checked rather than assumed. The single cast is
 * the erasure back to the heterogeneous list below.
 */
function collection<K extends ReplicaCollectionKey>(
  entityType: ReplicaEntityType,
  key: K,
  id: (value: ReplicaCollectionItem<K>) => string
): ReplicaCollection {
  return { entityType, key, id: id as (value: unknown) => string };
}

const collections: readonly ReplicaCollection[] = [
  collection("measurement-type", "measurementTypes", (value) => value.code),
  collection("personal-reference-range", "personalReferenceRanges", (value) => value.measurementCode),
  collection("pinned-measurement", "pinnedMeasurements", (value) => value.measurementCode),
  collection("source-import", "sourceImports", (value) => value.id),
  collection("data-source", "dataSources", (value) => value.id),
  collection("device", "devices", (value) => value.id),
  collection("observation-group", "observationGroups", (value) => value.id),
  collection("observation", "observations", (value) => value.id),
  collection("time-series-sample", "timeSeriesSamples", (value) => value.id),
  collection("measurement-aggregate", "measurementAggregates", (value) => value.id),
  collection("activity-session", "activitySessions", (value) => value.id),
  collection("health-event", "healthEvents", (value) => value.id),
  collection("care-item", "careItems", (value) => value.id),
  collection("medication", "medications", (value) => value.id)
];

export function replicaEntities(data: HealthStoreData): ReplicaEntity[] {
  const entities: ReplicaEntity[] = [{
    entityType: "profile",
    entityId: data.profile.id,
    payload: data.profile as unknown as Record<string, unknown>
  }];
  for (const collection of collections) {
    const values = (data[collection.key] ?? []) as unknown[];
    for (const value of values) {
      if (!includeInReplica(collection.entityType, value)) continue;
      entities.push({
        entityType: collection.entityType,
        entityId: collection.id(value),
        payload: value as Record<string, unknown>
      });
    }
  }
  return entities.sort((left, right) =>
    left.entityType.localeCompare(right.entityType) || left.entityId.localeCompare(right.entityId));
}

function includeInReplica(entityType: ReplicaEntityType, value: unknown): boolean {
  if (entityType !== "observation" && entityType !== "time-series-sample") return true;
  return isReplicatedMeasurementCode((value as { measurementCode?: string }).measurementCode);
}

export async function recordReplicaEntityChanges(
  connection: duckdb.Connection,
  changes: ReplicaChangeInput[]
): Promise<void> {
  if (changes.length === 0) return;

  const state = await readState(connection);
  const revision = state.revision + 1;
  const changedAt = new Date().toISOString();
  const ordered = changes.sort((left, right) =>
    left.entityType.localeCompare(right.entityType) || left.entityId.localeCompare(right.entityId));
  await insertRows(
    connection,
    "companion_sync_changes",
    ordered.map((change, index) => [
      state.nextSequence + index,
      revision,
      change.entityType,
      change.entityId,
      change.operation,
      change.payload ? json(change.payload) : null,
      changedAt
    ])
  );
  await run(
    connection,
    "UPDATE companion_sync_state SET revision = ?, next_sequence = ? WHERE singleton = TRUE",
    revision,
    state.nextSequence + ordered.length
  );
}

export async function replicaHighWaterMark(connection: duckdb.Connection): Promise<ReplicaHighWaterMark> {
  const state = await readState(connection);
  return { revision: state.revision, sequence: state.nextSequence - 1 };
}

export async function createReplicaSnapshot(
  connection: duckdb.Connection,
  pairingId: string,
  data: HealthStoreData
): Promise<string> {
  const snapshotId = randomUUID();
  const highWater = await replicaHighWaterMark(connection);
  // Each snapshot is a full copy of the store and one is minted whenever a device restarts its first
  // sync from scratch. Superseded snapshots for this pairing are dropped so an interrupted first
  // sync cannot leave permanent copies of the health data behind in the encrypted database.
  await run(
    connection,
    `DELETE FROM companion_sync_snapshot_entries WHERE snapshot_id IN
     (SELECT snapshot_id FROM companion_sync_snapshots WHERE pairing_id = ?)`,
    pairingId
  );
  await run(connection, "DELETE FROM companion_sync_snapshots WHERE pairing_id = ?", pairingId);
  await run(
    connection,
    `INSERT INTO companion_sync_snapshots
     (snapshot_id, pairing_id, revision, high_water_sequence, created_at) VALUES (?, ?, ?, ?, ?)`,
    snapshotId,
    pairingId,
    highWater.revision,
    highWater.sequence,
    new Date().toISOString()
  );
  await insertRows(
    connection,
    "companion_sync_snapshot_entries",
    replicaEntities(data).map((entity, entryIndex) => [
      snapshotId,
      entryIndex,
      entity.entityType,
      entity.entityId,
      json(entity.payload)
    ])
  );
  return snapshotId;
}

export async function readReplicaSnapshotPage(
  connection: duckdb.Connection,
  pairingId: string,
  snapshotId: string,
  offset: number,
  limit: number
): Promise<StoredReplicaPage | undefined> {
  const snapshots = await allWithParams(
    connection,
    `SELECT revision, high_water_sequence FROM companion_sync_snapshots
     WHERE snapshot_id = ? AND pairing_id = ?`,
    snapshotId,
    pairingId
  );
  const snapshot = snapshots[0];
  if (!snapshot) return undefined;
  const rows = await allWithParams(
    connection,
    `SELECT entry_index, entity_type, entity_id, payload
     FROM companion_sync_snapshot_entries
     WHERE snapshot_id = ? AND entry_index >= ?
     ORDER BY entry_index LIMIT ?`,
    snapshotId,
    offset,
    limit + 1
  );
  const pageRows = rows.slice(0, limit);
  return {
    changes: pageRows.map((row) => ({
      revision: Number(snapshot.revision),
      sequence: Number(row.entry_index),
      entityType: String(row.entity_type) as ReplicaEntityType,
      entityId: String(row.entity_id),
      operation: "upsert",
      payload: parseJsonObject(row.payload)
    })),
    highWaterMark: {
      revision: Number(snapshot.revision),
      sequence: Number(snapshot.high_water_sequence)
    },
    nextOffset: rows.length > limit ? offset + limit : undefined
  };
}

export async function readReplicaDeltaPage(
  connection: duckdb.Connection,
  afterSequence: number,
  highWaterSequence: number | undefined,
  limit: number
): Promise<StoredReplicaPage> {
  const current = await replicaHighWaterMark(connection);
  // Retention trims the tail of the change log, so a device that has been offline for a long time
  // can ask for a sequence that no longer exists. Failing loudly sends it back to a snapshot
  // instead of handing it a page that silently skips the pruned changes.
  const oldestRetained = await oldestRetainedChangeSequence(connection);
  if (afterSequence > 0 && oldestRetained > afterSequence + 1) {
    throw new ReplicaDeltaGapError(oldestRetained);
  }
  const highWaterMark = highWaterSequence === undefined
    ? current
    : {
        revision: Number((await allWithParams(
          connection,
          "SELECT COALESCE(MAX(revision), 0) AS revision FROM companion_sync_changes WHERE sequence <= ?",
          highWaterSequence
        ))[0]?.revision ?? 0),
        sequence: highWaterSequence
      };
  const rows = await allWithParams(
    connection,
    `SELECT sequence, revision, entity_type, entity_id, operation, payload
     FROM companion_sync_changes
     WHERE sequence > ? AND sequence <= ?
     ORDER BY sequence LIMIT ?`,
    afterSequence,
    highWaterMark.sequence,
    limit + 1
  );
  const pageRows = rows.slice(0, limit);
  return {
    changes: pageRows.map((row) => ({
      revision: Number(row.revision),
      sequence: Number(row.sequence),
      entityType: String(row.entity_type) as ReplicaEntityType,
      entityId: String(row.entity_id),
      operation: String(row.operation) as ReplicaChange["operation"],
      ...(row.payload == null ? {} : { payload: parseJsonObject(row.payload) })
    })),
    highWaterMark,
    nextOffset: rows.length > limit ? Number(pageRows.at(-1)?.sequence ?? afterSequence) : undefined
  };
}

export { COMPANION_REPLICA_PROTOCOL_VERSION };

async function readState(connection: duckdb.Connection): Promise<{ revision: number; nextSequence: number }> {
  const rows = await all(
    connection,
    "SELECT revision, next_sequence FROM companion_sync_state WHERE singleton = TRUE"
  );
  return {
    revision: Number(rows[0]?.revision ?? 0),
    nextSequence: Number(rows[0]?.next_sequence ?? 1)
  };
}

function entityKey(entity: Pick<ReplicaEntity, "entityType" | "entityId">): string {
  return `${entity.entityType}\u0000${entity.entityId}`;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Stored companion replica payload is malformed.");
  }
  return parsed as Record<string, unknown>;
}
