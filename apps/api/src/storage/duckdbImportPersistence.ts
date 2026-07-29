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
  insertActivityRows,
  insertObservationRows,
  insertRows,
  insertTimeSeriesSampleRows,
  json,
  optionalJsonValue,
  run
} from "./duckdbRows.js";

export async function mergeImport(
  connection: duckdb.Connection,
  parsed: ProfileImport
): Promise<ImportMutationResult> {
  const sourceImport = parsed.sourceImport;
  const rejections: string[] = [];
  const sourceImportOutcome = await measureInsert(connection, "imports", 1, () =>
    insertImportIfNew(connection, sourceImport).then(() => undefined));

  const dataSourceOutcome = await measureInsert(connection, "sources", 1, async () =>
    insertRows(connection, "sources", [[
      await nextOrdinal(connection, "sources"),
      parsed.dataSource.id,
      parsed.dataSource.sourceKind,
      parsed.dataSource.label,
      parsed.dataSource.importId ?? null,
      parsed.dataSource.createdAt
    ]], { ignoreDuplicates: true }));
  const groupFirstOrdinal = await nextOrdinal(connection, "observation_groups");
  const observationGroupsOutcome = await measureInsert(
    connection,
    "observation_groups",
    parsed.observationGroups.length,
    () => insertRows(connection, "observation_groups",
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
      ]), { ignoreDuplicates: true })
  );

  const observationsOutcome = await measureInsert(
    connection,
    "observations",
    parsed.observations.length,
    async () => {
      const result = await insertObservationRows(
        connection, parsed.observations, await nextOrdinal(connection, "observations"));
      rejections.push(...result.rejections);
      return result.rejections.length;
    }
  );

  const sampleFirstOrdinal = await nextOrdinal(connection, "time_series_samples");
  const timeSeriesSamplesOutcome = await measureInsert(
    connection,
    "time_series_samples",
    parsed.timeSeriesSamples.length,
    async () => {
      const result = await insertTimeSeriesSampleRows(
        connection, parsed.timeSeriesSamples, sampleFirstOrdinal, { ignoreDuplicates: true });
      rejections.push(...result.rejections);
      return result.rejections.length;
    }
  );

  const activityFirstOrdinal = await nextOrdinal(connection, "activities");
  const activitySessionsOutcome = await measureInsert(
    connection,
    "activities",
    parsed.activitySessions.length,
    () => insertActivityRows(connection, parsed.activitySessions, activityFirstOrdinal, { ignoreDuplicates: true })
  );

  const outcome: ImportOutcome = {
    sourceImport: sourceImportOutcome,
    dataSource: dataSourceOutcome,
    observations: observationsOutcome,
    observationGroups: observationGroupsOutcome,
    timeSeriesSamples: timeSeriesSamplesOutcome,
    activitySessions: activitySessionsOutcome
  };
  if (rejections.length > 0) {
    await recordImportRejections(connection, sourceImport, rejections);
  }
  const auditEvent = await insertAudit(
    connection,
    "import-processed",
    importAuditDetail(sourceImport.sourceKind, outcome)
  );
  return { counts: await storageCounts(connection), outcome, auditEvent };
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

  const existingSources = await allWithParams(connection, "SELECT 1 AS found FROM sources WHERE id = ? LIMIT 1;", parsed.dataSource.id);
  const dataSourceInserted = existingSources.length === 0;
  if (dataSourceInserted) {
    await insertRows(connection, "sources", [[
      await nextOrdinal(connection, "sources"),
      parsed.dataSource.id,
      parsed.dataSource.sourceKind,
      parsed.dataSource.label,
      parsed.dataSource.importId ?? null,
      parsed.dataSource.createdAt
    ]]);
  }

  const currentRows = await all(connection, "SELECT id FROM observations;");
  const currentIds = new Set(currentRows.map((row) => String(row.id)));
  const incomingById = new Map(parsed.observations.map((entry) => [entry.id, entry]));
  const additions = [...incomingById.values()].filter((entry) => !currentIds.has(entry.id));
  const { accepted, rejections } = await insertObservationRows(
    connection, additions, await nextOrdinal(connection, "observations"));
  if (rejections.length > 0) {
    await recordImportRejections(connection, sourceImport, rejections);
  }
  return {
    count: accepted.length,
    observations: accepted,
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

async function measureInsert(
  connection: duckdb.Connection,
  table: "imports" | "sources" | "observations" | "observation_groups" | "time_series_samples" | "activities",
  attempted: number,
  insert: () => Promise<number | void>
): Promise<ImportCategoryOutcome> {
  const before = await tableCount(connection, table);
  const rejected = (await insert()) ?? 0;
  const accepted = (await tableCount(connection, table)) - before;
  return { attempted, accepted, rejected, duplicates: attempted - accepted - rejected };
}

async function tableCount(connection: duckdb.Connection, table: string): Promise<number> {
  const rows = await all(connection, `SELECT COUNT(*) AS count FROM ${table};`);
  return Number(rows[0]?.count ?? 0);
}

function importAuditDetail(sourceKind: string, outcome: ImportOutcome): string {
  const categories = Object.entries(outcome)
    .map(([category, result]) =>
      `${category}: ${result.accepted} accepted, ${result.duplicates} duplicate(s), ${result.rejected} rejected`)
    .join("; ");
  return `${sourceKind} import committed. ${categories}.`;
}