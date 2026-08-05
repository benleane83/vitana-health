import type duckdb from "duckdb";
import type { DataSource, Observation, SourceImport, TimeSeriesSample } from "@vitana/shared";
import { insertAudit, nextOrdinal, normalizeHealthConnectStepSamples } from "./duckdbCommands.js";
import { storageCounts } from "./duckdbProjections.js";
import {
  isReplicatedMeasurementCode,
  replicaObservationUpsert,
  replicaSourceImport,
  replicaTombstone,
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

  const healthConnectStepDeletes = parsed.sourceImport.sourceKind === "health-connect"
    ? await normalizeHealthConnectStepSamples(
      connection,
      parsed.dataSource.id,
      parsed.timeSeriesSamples
        .filter((entry) => entry.measurementCode === "steps")
        .map((entry) => entry.startAt)
    )
    : [];
  for (const id of healthConnectStepDeletes) {
    replicaChanges.push(replicaTombstone("time-series-sample", id));
  }

  const observations = await insertObservationRows(
    connection, parsed.observations, await nextOrdinal(connection, "observations", parsed.observations.length));
  rejections.push(...observations.rejections);
  for (const entry of observations.inserted) {
    replicaChanges.push(...replicaObservationUpsert(entry));
  }

  const stepSamples = parsed.timeSeriesSamples.filter((entry) => entry.measurementCode === "steps");
  const sleepSamples = parsed.timeSeriesSamples.filter((entry) => entry.measurementCode === "sleep_duration");
  const otherSamples = parsed.timeSeriesSamples.filter(
    (entry) => entry.measurementCode !== "steps" && entry.measurementCode !== "sleep_duration"
  );
  const stagedSleepSamples = sleepSamples.filter(hasSleepStages);
  const stageLessSleepSamples = sleepSamples.filter((entry) => !hasSleepStages(entry));
  const sampleFirstOrdinal = await nextOrdinal(connection, "time_series_samples", parsed.timeSeriesSamples.length);
  const steps = await insertTimeSeriesSampleRows(
    connection,
    stepSamples,
    sampleFirstOrdinal,
    { updateDuplicatesById: true, returningIds: true }
  );
  const samples = await insertTimeSeriesSampleRows(
    connection,
    otherSamples,
    sampleFirstOrdinal + stepSamples.length,
    { ignoreDuplicates: true, returningIds: true }
  );
  const stageLessSleep = await insertTimeSeriesSampleRows(
    connection,
    stageLessSleepSamples,
    sampleFirstOrdinal + stepSamples.length + otherSamples.length,
    { ignoreDuplicates: true, returningIds: true }
  );
  const stagedSleep = await insertTimeSeriesSampleRows(
    connection,
    stagedSleepSamples,
    sampleFirstOrdinal + stepSamples.length + otherSamples.length + stageLessSleepSamples.length,
    { updateDuplicatesById: true, returningIds: true }
  );
  rejections.push(...steps.rejections, ...samples.rejections, ...stageLessSleep.rejections, ...stagedSleep.rejections);
  for (const entry of [...steps.inserted, ...samples.inserted, ...stageLessSleep.inserted, ...stagedSleep.inserted]) {
    if (isReplicatedMeasurementCode(entry.measurementCode)) {
      replicaChanges.push(replicaUpsert("time-series-sample", entry.id, entry));
    }
  }

  const aggregateFirstOrdinal = await nextOrdinal(
    connection,
    "measurement_aggregates",
    parsed.measurementAggregates.length
  );
  const aggregateIds = await insertRows(
    connection,
    "measurement_aggregates",
    parsed.measurementAggregates.map((entry, index) => [
      aggregateFirstOrdinal + index,
      entry.id,
      entry.measurementCode,
      entry.granularity,
      entry.startAt,
      entry.endAt,
      entry.average,
      entry.minimum,
      entry.maximum,
      entry.count,
      entry.unit,
      entry.sourceId,
      entry.calendarDate ?? null,
      entry.sourceJson !== undefined,
      optionalJsonValue(entry.sourceJson)
    ]),
    { updateDuplicatesById: true, returningIds: true }
  );
  for (const entry of parsed.measurementAggregates) {
    if (aggregateIds.includes(entry.id)) {
      replicaChanges.push(replicaUpsert("measurement-aggregate", entry.id, entry));
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
      parsed.timeSeriesSamples.length,
      steps.inserted.length + samples.inserted.length + stageLessSleep.inserted.length + stagedSleep.inserted.length,
      steps.rejections.length + samples.rejections.length + stageLessSleep.rejections.length + stagedSleep.rejections.length),
    measurementAggregates: categoryOutcome(parsed.measurementAggregates.length, aggregateIds.length, 0),
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

function hasSleepStages(sample: TimeSeriesSample): boolean {
  const sourceJson = sample.sourceJson;
  return sample.measurementCode === "sleep_duration"
    && typeof sourceJson === "object"
    && sourceJson !== null
    && !Array.isArray(sourceJson)
    && Array.isArray((sourceJson as Record<string, unknown>).stages)
    && (sourceJson as { stages: unknown[] }).stages.length > 0;
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

/**
 * Returns true when this import row was actually written. `imports_identity_idx` makes the
 * (source_kind, checksum, file_name) identity a database constraint, so a single INSERT OR IGNORE
 * both deduplicates and reports the outcome - the previous SELECT-then-INSERT pair could let two
 * concurrent sync chunks each see "not present" and both insert.
 */
async function insertImportIfNew(connection: duckdb.Connection, sourceImport: SourceImport): Promise<boolean> {
  const inserted = await insertRows(connection, "imports", [[
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
  ]], { ignoreDuplicates: true, returningIds: true });
  return inserted.length > 0;
}

function importAuditDetail(sourceKind: string, outcome: ImportOutcome): string {
  const categories = Object.entries(outcome)
    .map(([category, result]) =>
      `${category}: ${result.accepted} accepted, ${result.duplicates} duplicate(s), ${result.rejected} rejected`)
    .join("; ");
  return `${sourceKind} import committed. ${categories}.`;
}