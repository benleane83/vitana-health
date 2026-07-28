import type duckdb from "duckdb";
import type { DataSource, Observation, SourceImport } from "@vitana/shared";
import { insertAudit, nextOrdinal } from "./duckdbCommands.js";
import { storageCounts } from "./duckdbProjections.js";
import type {
  ImportCategoryOutcome,
  ImportMutationResult,
  ImportOutcome,
  ProfileImport
} from "./profileRepository.js";
import {
  all,
  allWithParams,
  insertObservationRows,
  insertRows,
  json,
  optionalJsonValue,
  run
} from "./duckdbRows.js";

export async function mergeImport(
  connection: duckdb.Connection,
  parsed: ProfileImport
): Promise<ImportMutationResult> {
  const sourceImport = parsed.sourceImport;
  const sourceImportOutcome = await measureInsert(connection, "imports", 1, () =>
    insertImportIfNew(connection, sourceImport).then(() => undefined));

  const dataSourceOutcome = await measureInsert(connection, "sources", 1, async () =>
    insertRows(connection, "INSERT OR IGNORE INTO sources VALUES (?, ?, ?, ?, ?, ?);", [[
      await nextOrdinal(connection, "sources"),
      parsed.dataSource.id,
      parsed.dataSource.sourceKind,
      parsed.dataSource.label,
      parsed.dataSource.importId ?? null,
      parsed.dataSource.createdAt
    ]]));
  const groupFirstOrdinal = await nextOrdinal(connection, "observation_groups");
  const observationGroupsOutcome = await measureInsert(
    connection,
    "observation_groups",
    parsed.observationGroups.length,
    () => insertRows(connection, "INSERT OR IGNORE INTO observation_groups VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
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
      ]))
  );

  const observationsOutcome = await measureInsert(
    connection,
    "observations",
    parsed.observations.length,
    async () => insertObservationRows(connection, parsed.observations, await nextOrdinal(connection, "observations"))
  );

  const sampleFirstOrdinal = await nextOrdinal(connection, "time_series_samples");
  const timeSeriesSamplesOutcome = await measureInsert(
    connection,
    "time_series_samples",
    parsed.timeSeriesSamples.length,
    () => insertRows(connection, "INSERT OR IGNORE INTO time_series_samples VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
      parsed.timeSeriesSamples.map((entry, index) => [
        sampleFirstOrdinal + index,
        entry.id,
        entry.measurementCode,
        entry.startAt,
        entry.endAt,
        entry.value,
        entry.unit,
        entry.sourceId,
        entry.deviceId ?? null,
        entry.sourceJson !== undefined,
        optionalJsonValue(entry.sourceJson)
      ]))
  );

  const activityFirstOrdinal = await nextOrdinal(connection, "activities");
  const activitySessionsOutcome = await measureInsert(
    connection,
    "activities",
    parsed.activitySessions.length,
    () => insertRows(connection, "INSERT OR IGNORE INTO activities VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
      parsed.activitySessions.map((entry, index) => [
        activityFirstOrdinal + index,
        entry.id,
        entry.activityType,
        entry.startAt,
        entry.endAt ?? null,
        entry.durationMinutes ?? null,
        entry.energyKcal ?? null,
        entry.distanceMeters ?? null,
        entry.sourceId,
        entry.sourceJson !== undefined,
        optionalJsonValue(entry.sourceJson)
      ]))
  );

  const outcome: ImportOutcome = {
    sourceImport: sourceImportOutcome,
    dataSource: dataSourceOutcome,
    observations: observationsOutcome,
    observationGroups: observationGroupsOutcome,
    timeSeriesSamples: timeSeriesSamplesOutcome,
    activitySessions: activitySessionsOutcome
  };
  const auditEvent = await insertAudit(
    connection,
    "import-processed",
    importAuditDetail(sourceImport.sourceKind, outcome)
  );
  return { counts: await storageCounts(connection), outcome, auditEvent };
}

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

  const existingSources = await allWithParams(connection, "SELECT 1 AS found FROM sources WHERE id = ? LIMIT 1;", parsed.dataSource.id);
  const dataSourceInserted = existingSources.length === 0;
  if (dataSourceInserted) {
    await run(
      connection,
      "INSERT INTO sources VALUES (?, ?, ?, ?, ?, ?);",
      await nextOrdinal(connection, "sources"), parsed.dataSource.id, parsed.dataSource.sourceKind, parsed.dataSource.label,
      parsed.dataSource.importId ?? null, parsed.dataSource.createdAt
    );
  }

  const currentRows = await all(connection, "SELECT id FROM observations;");
  const currentIds = new Set(currentRows.map((row) => String(row.id)));
  const incomingById = new Map(parsed.observations.map((entry) => [entry.id, entry]));
  const additions = [...incomingById.values()].filter((entry) => !currentIds.has(entry.id));
  await insertObservationRows(connection, additions, await nextOrdinal(connection, "observations"));
  return {
    count: additions.length,
    observations: additions,
    ...(sourceImportInserted ? { sourceImport } : {}),
    ...(dataSourceInserted ? { dataSource: parsed.dataSource } : {})
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
  await run(
    connection,
    "INSERT INTO imports VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
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
  );
  return true;
}

async function measureInsert(
  connection: duckdb.Connection,
  table: "imports" | "sources" | "observations" | "observation_groups" | "time_series_samples" | "activities",
  attempted: number,
  insert: () => Promise<void>
): Promise<ImportCategoryOutcome> {
  const before = await tableCount(connection, table);
  await insert();
  const accepted = (await tableCount(connection, table)) - before;
  return { attempted, accepted, duplicates: attempted - accepted, evicted: 0 };
}

async function tableCount(connection: duckdb.Connection, table: string): Promise<number> {
  const rows = await all(connection, `SELECT COUNT(*) AS count FROM ${table};`);
  return Number(rows[0]?.count ?? 0);
}

function importAuditDetail(sourceKind: string, outcome: ImportOutcome): string {
  const categories = Object.entries(outcome)
    .map(([category, result]) => `${category}: ${result.accepted} accepted, ${result.duplicates} duplicate(s), 0 evicted`)
    .join("; ");
  return `${sourceKind} import committed. ${categories}.`;
}