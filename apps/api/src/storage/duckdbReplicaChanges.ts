import type { Observation, ReplicaChange, ReplicaEntityType, SourceImport } from "@vitana/shared";

/**
 * A replica change before the store assigns it a revision and sequence number.
 *
 * Mutations declare the entities they touched rather than letting the store diff two whole-store
 * snapshots. Emitting a redundant upsert is harmless (the client applies it idempotently); missing
 * one is not, so err towards emitting.
 */
export type ReplicaChangeInput = Omit<ReplicaChange, "revision" | "sequence">;

export function replicaUpsert(
  entityType: ReplicaEntityType,
  entityId: string,
  payload: object
): ReplicaChangeInput {
  return {
    entityType,
    entityId,
    operation: "upsert",
    payload: payload as Record<string, unknown>
  };
}

export function replicaTombstone(entityType: ReplicaEntityType, entityId: string): ReplicaChangeInput {
  return { entityType, entityId, operation: "tombstone" };
}

/**
 * Heart-rate rows are deliberately excluded from the replica stream: they dominate the row count
 * and the companion app renders them from its own Health Connect copy. Keep this in step with
 * `includeInReplica` in duckdbReplicaSync.ts.
 */
export const replicaExcludedMeasurementCode = "heart_rate";

export function isReplicatedMeasurementCode(measurementCode: string | undefined): boolean {
  return measurementCode !== replicaExcludedMeasurementCode;
}

export function replicaObservationUpsert(observation: Observation): ReplicaChangeInput[] {
  return isReplicatedMeasurementCode(observation.measurementCode)
    ? [replicaUpsert("observation", observation.id, observation)]
    : [];
}

export function replicaObservationTombstones(
  measurementCode: string,
  ids: readonly string[]
): ReplicaChangeInput[] {
  return isReplicatedMeasurementCode(measurementCode)
    ? ids.map((id) => replicaTombstone("observation", id))
    : [];
}

/** Raw import payloads never leave the PC; the companion only needs the import metadata. */
export function replicaSourceImport(sourceImport: SourceImport): object {
  const { rawContent: _rawContent, ...replicaImport } = sourceImport;
  return replicaImport;
}
