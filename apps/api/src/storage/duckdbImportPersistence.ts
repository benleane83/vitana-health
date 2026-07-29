import type duckdb from "duckdb";
import type { DataSource, Observation, SourceImport } from "@vitana/shared";
import { insertAudit, nextOrdinal } from "./duckdbCommands.js";
import { storageCounts } from "./duckdbProjections.js";
import {
  isReplicatedMeasurementCode,
  replicaObservationUpsert,
  replicaSourceImport,
  replicaUpsert,
  type ReplicaChangeInput
} from "./duckdbReplicaChanges.js";
import type {
  ImportCategoryOutcome,
  ImportMutationResult,
  ImportOutcome,
  ProfileImport
} from "./profileRepository.js";
import {
  all,
  allWithParams,
  insertActivityRows,
  insertObservationRows,
  insertRows,
  insertTimeSeriesSampleRows,
  json,
  optionalJsonValue,
  run
} from "./duckdbRows.js";

/**
 * The persisted result carries the replica changes the merge produced. The repository strips them
 * before returning, but they must be derived here: only the insert statements know which rows were
 * new rather than duplicates.
 */
export interface ImportPersistenceResult extends ImportMutationResult {
  replicaChanges: ReplicaChangeInput[];
}

export async function mergeImport(
  connection: duckdb.Connection,
  parsed: ProfileImport
): Promise<ImportPersistenceResult> {
  const sourceImport = parsed.sourceImport;
  const rejections: string[] = [];
  const replicaChanges: ReplicaChangeInput[] = [];

  const sourceImportInserted = await insertImportIfNew(connection, sourceImport);
  if (sourceImportInserted) {
    replicaChanges.push(replicaUpsert("source-import", sourceImport.id, replicaSourceImport(sourceImport)));
  }

  const dataSourceIds = await insertRows(connection, "sources", [[
    await nextOrdinal(connection, "sources"),
    parsed.dataSource.id,
    parsed.dataSource.sourceKind,
    parsed.dataSource.label,
    parsed.dataSource.importId ?? null,
    parsed.dataSource.createdAt
  ]], { ignoreDuplicates: true, returningIds: true });
  if (dataSourceIds.length > 0) {
    replicaChanges.push(replicaUpsert("data-source", parsed.dataSource.id, parsed.dataSource));
  }

  const groupFirstOrdinal = await nextOrdinal(connection, "observation_groups", parsed.observationGroups.length);
  const insertedGroupIds = new Set(await insertRows(connection, "observation_groups",
    parsed.observationGroups.map((entry, index) => [
      groupFirstOrdinal + index,
      entry.id,
      entry.kind,
      entry.label,
      entry.sourceId ?? null,
      entry.importId ?? null,
      entry.startAt ?? null,
      entry.endAt ?? null,
      entry.collectedAt ?? null,
      optionalJsonValue(entry.metadata)
    ]), { ignoreDuplicates: true, returningIds: true }));
  for (const entry of parsed.observationGroups) {
    if (insertedGroupIds.has(entry.id)) {
      replicaChanges.push(replicaUpsert("observation-group", entry.id, entry));
    }
  }

  const observations = await insertObservationRows(
    connection, parsed.observations, await nextOrdinal(connection, "observations", parsed.observations.length));
  rejections.push(...observations.rejections);
  for (const entry of observations.inserted) {
    replicaChanges.push(...replicaObservationUpsert(entry));
  }

  const samples = await insertTimeSeriesSampleRows(
    connection,
    parsed.timeSeriesSamples,
    await nextOrdinal(connection, "time_series_samples", parsed.timeSeriesSamples.length),
    { ignoreDuplicates: true, returningIds: true }
  );
  rejections.push(...samples.rejections);
  for (const entry of samples.inserted) {
    if (isReplicatedMeasurementCode(entry.measurementCode)) {
      replicaChanges.push(replicaUpsert("time-series-sample", entry.id, entry));
    }
  }

  const activities = await insertActivityRows(
    connection,
    parsed.activitySessions,
    await nextOrdinal(connection, "activities", parsed.activitySessions.length),
    { ignoreDuplicates: true, returningIds: true }
  );
  for (const entry of activities) {
    replicaChanges.push(replicaUpsert("activity-session", entry.id, entry));
  }

  const outcome: ImportOutcome = {
    sourceImport: categoryOutcome(1, sourceImportInserted ? 1 : 0, 0),
    dataSource: categoryOutcome(1, dataSourceIds.length, 0),
    observations: categoryOutcome(
      parsed.observations.length, observations.inserted.length, observations.rejections.length),
    observationGroups: categoryOutcome(parsed.observationGroups.length, insertedGroupIds.size, 0),
    timeSeriesSamples: categoryOutcome(
      parsed.timeSeriesSamples.length, samples.inserted.length, samples.rejections.length),
    activitySessions: categoryOutcome(parsed.activitySessions.length, activities.length, 0)
  };
  if (rejections.length > 0) {
    await recordImportRejections(connection, sourceImport, rejections);
  }
  const auditEvent = await insertAudit(
    connection,
    "import-processed",
    importAuditDetail(sourceImport.sourceKind, outcome)
  );
  return { counts: await storageCounts(connection), outcome, auditEvent, replicaChanges };
}

function categoryOutcome(attempted: number, accepted: number, rejected: number): ImportCategoryOutcome {
  return { attempted, accepted, rejected, duplicates: attempted - accepted - rejected };
}

/**
 * Rejections are only known after the measurement rows have been pushed through canonicalization,
 * so they are folded into the already-written import row rather than held back.
 */
async function recordImportRejections(
  connection: duckdb.Connection,
  sourceImport: SourceImport,
  rejections: string[]
): Promise<void> {
  const summarized = rejections.length > maxStoredRejections
    ? [...rejections.slice(0, maxStoredRejections), `... and ${rejections.length - maxStoredRejections} more`]
    : rejections;
  await run(
    connection,
    "UPDATE imports SET diagnostics = ? WHERE id = ?;",
    json([...sourceImport.diagnostics, ...summarized.map((entry) => `rejected ${entry}`)]),
    sourceImport.id
  );
}

const maxStoredRejections = 50;

export interface ObservationImportPersistenceResult {
  count: number;
  observations: Observation[];
  sourceImport?: SourceImport;
  dataSource?: DataSource;
}

export async function importObservationRecords(
  connection: duckdb.Connection,
  parsed: Pick<ProfileImport, "sourceImport" | "dataSource" | "observations">
): Promise<ObservationImportPersistenceResult> {
  const sourceImport = parsed.sourceImport;
  const sourceImportInserted = await insertImportIfNew(connection, sourceImport);

  const dataSourceInserted = await insertRows(connection, "sources", [[
    await nextOrdinal(connection, "sources"),
    parsed.dataSource.id,
    parsed.dataSource.sourceKind,
    parsed.dataSource.label,
    parsed.dataSource.importId ?? null,
    parsed.dataSource.createdAt
  ]], { ignoreDuplicates: true, returningIds: true });

  // `INSERT OR IGNORE ... RETURNING id` reports the new rows directly, so there is no need to
  // materialize every existing observation id first.
  const { inserted, rejections } = await insertObservationRows(
    connection, parsed.observations, await nextOrdinal(connection, "observations", parsed.observations.length));
  if (rejections.length > 0) {
    await recordImportRejections(connection, sourceImport, rejections);
  }
  return {
    count: inserted.length,
    observations: inserted,
    ...(sourceImportInserted ? { sourceImport } : {}),
    ...(dataSourceInserted.length > 0 ? { dataSource: parsed.dataSource } : {})
  };
}

async function insertImportIfNew(connection: duckdb.Connection, sourceImport: SourceImport): Promise<boolean> {
  const duplicateImports = await allWithParams(
    connection,
    "SELECT 1 AS found FROM imports WHERE source_kind = ? AND checksum = ? AND file_name = ? LIMIT 1;",
    sourceImport.sourceKind,
    sourceImport.checksum,
    sourceImport.fileName
  );
  if (duplicateImports.length > 0) {
    return false;
  }
  await insertRows(connection, "imports", [[
    await nextOrdinal(connection, "imports"),
    sourceImport.id,
    sourceImport.sourceKind,
    sourceImport.fileName,
    sourceImport.importedAt,
    sourceImport.parserVersion,
    sourceImport.checksum,
    sourceImport.rowCount,
    sourceImport.status,
    json(sourceImport.diagnostics),
    sourceImport.rawContent ?? null
  ]]);
  return true;
}

function importAuditDetail(sourceKind: string, outcome: ImportOutcome): string {
  const categories = Object.entries(outcome)
    .map(([category, result]) =>
      `${category}: ${result.accepted} accepted, ${result.duplicates} duplicate(s), ${result.rejected} rejected`)
    .join("; ");
  return `${sourceKind} import committed. ${categories}.`;
}