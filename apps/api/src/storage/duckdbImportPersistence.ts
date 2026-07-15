import type duckdb from "duckdb";
import type { SourceImport } from "@local-fitness-advisor/shared";
import { insertAudit, nextOrdinal } from "./duckdbCommands.js";
import { storageCounts } from "./duckdbProjections.js";
import type { ImportMutationResult, ProfileImport } from "./profileRepository.js";
import {
  all,
  allWithParams,
  exec,
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
  const sourceImport = sanitizeSourceImport(parsed.sourceImport);
  await insertImportIfNew(connection, sourceImport);

  await insertRows(connection, "INSERT OR IGNORE INTO sources VALUES (?, ?, ?, ?, ?, ?);", [[
    await nextOrdinal(connection, "sources"),
    parsed.dataSource.id,
    parsed.dataSource.sourceKind,
    parsed.dataSource.label,
    parsed.dataSource.importId ?? null,
    parsed.dataSource.createdAt
  ]]);
  const groupFirstOrdinal = await nextOrdinal(connection, "observation_groups");
  await insertRows(connection, "INSERT OR IGNORE INTO observation_groups VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
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
    ]));

  await insertObservationRows(connection, parsed.observations, await nextOrdinal(connection, "observations"));

  const sampleFirstOrdinal = await nextOrdinal(connection, "time_series_samples");
  await insertRows(connection, "INSERT OR IGNORE INTO time_series_samples VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
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
    ]));

  const activityFirstOrdinal = await nextOrdinal(connection, "activities");
  await insertRows(connection, "INSERT OR IGNORE INTO activities VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
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
    ]));

  await pruneMeasurementRows(connection, "observations", "observed_at", maxObservations);
  await pruneMeasurementRows(connection, "time_series_samples", "end_at", maxTimeSeriesSamples);
  await pruneByNewest(connection, "observation_groups", "COALESCE(collected_at, end_at, start_at)", maxObservationGroups);
  await pruneByNewest(connection, "activities", "start_at", maxActivitySessions);
  const auditEvent = await insertAudit(
    connection,
    "import-processed",
    `${sourceImport.sourceKind} import processed with ${sourceImport.rowCount} source row(s).`
  );
  return { counts: await storageCounts(connection), auditEvent };
}

export async function importObservationRecords(
  connection: duckdb.Connection,
  parsed: Pick<ProfileImport, "sourceImport" | "dataSource" | "observations">
): Promise<number> {
  const sourceImport = sanitizeSourceImport(parsed.sourceImport);
  await insertImportIfNew(connection, sourceImport);

  const existingSources = await allWithParams(connection, "SELECT 1 AS found FROM sources WHERE id = ? LIMIT 1;", parsed.dataSource.id);
  if (existingSources.length === 0) {
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
  if (currentIds.size + additions.length > maxObservations) {
    throw new Error(`DuckDB observation import exceeds the ${maxObservations} row limit.`);
  }
  await insertObservationRows(connection, additions, await nextOrdinal(connection, "observations"));
  return additions.length;
}

async function insertImportIfNew(connection: duckdb.Connection, sourceImport: SourceImport): Promise<void> {
  const duplicateImports = await allWithParams(
    connection,
    "SELECT 1 AS found FROM imports WHERE source_kind = ? AND checksum = ? AND file_name = ? LIMIT 1;",
    sourceImport.sourceKind,
    sourceImport.checksum,
    sourceImport.fileName
  );
  if (duplicateImports.length > 0) {
    return;
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
}

async function pruneMeasurementRows(
  connection: duckdb.Connection,
  table: "observations" | "time_series_samples",
  timestampColumn: "observed_at" | "end_at",
  maxItems: number
): Promise<void> {
  const countRows = await all(connection, `SELECT COUNT(*) AS count FROM ${table};`);
  if (Number(countRows[0]?.count ?? 0) <= maxItems) return;

  const rankedSql = `
    SELECT id, measurement_code, ${timestampColumn},
      ROW_NUMBER() OVER (PARTITION BY measurement_code ORDER BY ${timestampColumn} DESC, id DESC) AS measurement_rank
    FROM ${table}`;
  const protectedRows = await all(connection, `
    WITH ranked AS (${rankedSql})
    SELECT COUNT(*) AS count FROM ranked WHERE measurement_rank <= ${minPerMeasurementCode};
  `);
  const protectedCount = Number(protectedRows[0]?.count ?? 0);
  const remainingLimit = Math.max(0, maxItems - protectedCount);
  const retainedSql = remainingLimit === 0
    ? `
      WITH ranked AS (${rankedSql})
      SELECT id FROM (
        SELECT id FROM ranked WHERE measurement_rank <= ${minPerMeasurementCode}
        ORDER BY ${timestampColumn} DESC, id DESC
        LIMIT ${maxItems}
      )`
    : `
      WITH ranked AS (${rankedSql}), retained AS (
        SELECT id FROM ranked WHERE measurement_rank <= ${minPerMeasurementCode}
        UNION ALL
        SELECT id FROM (
          SELECT id FROM ranked WHERE measurement_rank > ${minPerMeasurementCode}
          ORDER BY ${timestampColumn} DESC, id DESC
          LIMIT ${remainingLimit}
        )
      )
      SELECT id FROM retained`;
  await exec(connection, `DELETE FROM ${table} WHERE id NOT IN (${retainedSql});`);
}

async function pruneByNewest(
  connection: duckdb.Connection,
  table: "observation_groups" | "activities",
  timestampExpression: string,
  maxItems: number
): Promise<void> {
  const countRows = await all(connection, `SELECT COUNT(*) AS count FROM ${table};`);
  if (Number(countRows[0]?.count ?? 0) <= maxItems) return;
  await exec(connection, `
    DELETE FROM ${table}
    WHERE id NOT IN (
      SELECT id FROM ${table}
      ORDER BY ${timestampExpression} DESC NULLS LAST, id DESC
      LIMIT ${maxItems}
    );
  `);
}

function sanitizeSourceImport(sourceImport: SourceImport): SourceImport {
  if (!sourceImport.rawContent || sourceImport.rawContent.length <= maxRawImportChars) {
    return sourceImport;
  }
  return { ...sourceImport, rawContent: sourceImport.rawContent.slice(0, maxRawImportChars) };
}

export const maxRawImportChars = 1_000_000;
export const maxObservations = 250_000;
export const maxTimeSeriesSamples = 10_000;
export const minPerMeasurementCode = 500;
export const maxActivitySessions = 75_000;
export const maxObservationGroups = 20_000;