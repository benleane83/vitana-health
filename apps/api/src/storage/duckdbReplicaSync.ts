import { randomUUID } from "node:crypto";
import type duckdb from "duckdb";
import {
  COMPANION_REPLICA_PROTOCOL_VERSION,
  type HealthStoreData,
  type ReplicaChange,
  type ReplicaEntityType,
  type ReplicaHighWaterMark
} from "@vitana/shared";
import { all, allWithParams, json, run } from "./duckdbRows.js";

export interface ReplicaEntity {
  entityType: ReplicaEntityType;
  entityId: string;
  payload: Record<string, unknown>;
}

export interface StoredReplicaPage {
  changes: ReplicaChange[];
  highWaterMark: ReplicaHighWaterMark;
  nextOffset?: number;
}

const collections: Array<{
  entityType: ReplicaEntityType;
  key: keyof HealthStoreData;
  id: (value: any) => string;
}> = [
  { entityType: "measurement-type", key: "measurementTypes", id: (value) => value.code },
  { entityType: "personal-reference-range", key: "personalReferenceRanges", id: (value) => value.measurementCode },
  { entityType: "source-import", key: "sourceImports", id: (value) => value.id },
  { entityType: "data-source", key: "dataSources", id: (value) => value.id },
  { entityType: "device", key: "devices", id: (value) => value.id },
  { entityType: "observation-group", key: "observationGroups", id: (value) => value.id },
  { entityType: "observation", key: "observations", id: (value) => value.id },
  { entityType: "time-series-sample", key: "timeSeriesSamples", id: (value) => value.id },
  { entityType: "activity-session", key: "activitySessions", id: (value) => value.id }
];

export function replicaEntities(data: HealthStoreData): ReplicaEntity[] {
  const entities: ReplicaEntity[] = [{
    entityType: "profile",
    entityId: data.profile.id,
    payload: data.profile as unknown as Record<string, unknown>
  }];
  for (const collection of collections) {
    const values = data[collection.key] as unknown[];
    for (const value of values) {
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

export async function recordReplicaChanges(
  connection: duckdb.Connection,
  before: HealthStoreData,
  after: HealthStoreData
): Promise<void> {
  const beforeByKey = new Map(replicaEntities(before).map((entity) => [entityKey(entity), entity]));
  const afterByKey = new Map(replicaEntities(after).map((entity) => [entityKey(entity), entity]));
  const changes: Array<Omit<ReplicaChange, "revision" | "sequence">> = [];
  for (const [key, entity] of afterByKey) {
    const previous = beforeByKey.get(key);
    if (!previous || JSON.stringify(previous.payload) !== JSON.stringify(entity.payload)) {
      changes.push({ ...entity, operation: "upsert" });
    }
  }
  for (const [key, entity] of beforeByKey) {
    if (!afterByKey.has(key)) {
      changes.push({
        entityType: entity.entityType,
        entityId: entity.entityId,
        operation: "tombstone"
      });
    }
  }
  if (changes.length === 0) return;

  const state = await readState(connection);
  const revision = state.revision + 1;
  let sequence = state.nextSequence;
  const changedAt = new Date().toISOString();
  for (const change of changes.sort((left, right) =>
    left.entityType.localeCompare(right.entityType) || left.entityId.localeCompare(right.entityId))) {
    await run(
      connection,
      `INSERT INTO companion_sync_changes
       (sequence, revision, entity_type, entity_id, operation, payload, changed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      sequence,
      revision,
      change.entityType,
      change.entityId,
      change.operation,
      change.payload ? json(change.payload) : null,
      changedAt
    );
    sequence += 1;
  }
  await run(
    connection,
    "UPDATE companion_sync_state SET revision = ?, next_sequence = ? WHERE singleton = TRUE",
    revision,
    sequence
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
  let entryIndex = 0;
  for (const entity of replicaEntities(data)) {
    await run(
      connection,
      `INSERT INTO companion_sync_snapshot_entries
       (snapshot_id, entry_index, entity_type, entity_id, payload) VALUES (?, ?, ?, ?, ?)`,
      snapshotId,
      entryIndex,
      entity.entityType,
      entity.entityId,
      json(entity.payload)
    );
    entryIndex += 1;
  }
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
