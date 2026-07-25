import { randomUUID } from "node:crypto";
import type duckdb from "duckdb";
import type {
  MobileMigrationBatch,
  MobileMigrationBatchAcknowledgement,
  MobileMigrationConflict,
  MobileMigrationDuplicate,
  MobileMigrationManifest,
  MobileMigrationReceipt,
  MobileMigrationStartResponse
} from "@vitana/shared";
import { convertMeasurementValue, findMeasurementType, normalizeMeasurementUnit } from "@vitana/shared";
import { nextOrdinal } from "./duckdbCommands.js";
import { allWithParams, insertObservationRows, json, optionalJsonValue, run } from "./duckdbRows.js";

interface MigrationContext {
  pairingId: string;
  destinationProfileId: string;
}

export async function startMobileMigration(
  connection: duckdb.Connection,
  context: MigrationContext,
  manifest: MobileMigrationManifest
): Promise<MobileMigrationStartResponse> {
  const existing = await allWithParams(
    connection,
    `SELECT session_id, status FROM companion_migration_sessions
     WHERE pairing_id = ? AND dataset_fingerprint = ? LIMIT 1;`,
    context.pairingId,
    manifest.datasetFingerprint
  );
  const sessionId = existing[0]?.session_id ? String(existing[0].session_id) : randomUUID();
  if (existing.length) {
    const stored = await allWithParams(
      connection,
      "SELECT manifest FROM companion_migration_sessions WHERE session_id = ? LIMIT 1;",
      sessionId
    );
    if (!sameManifest(parseJson(stored[0]?.manifest) as MobileMigrationManifest, manifest)) {
      throw requestError(409, "The migration manifest changed. Start again with the updated dataset.");
    }
  }
  if (!existing.length) {
    await run(
      connection,
      `INSERT INTO companion_migration_sessions
       (session_id, pairing_id, dataset_fingerprint, manifest, status, created_at)
       VALUES (?, ?, ?, ?, 'active', CURRENT_TIMESTAMP);`,
      sessionId,
      context.pairingId,
      manifest.datasetFingerprint,
      json(manifest)
    );
  }
  const batches = await allWithParams(
    connection,
    "SELECT batch_id FROM companion_migration_batches WHERE session_id = ? ORDER BY processed_at, batch_id;",
    sessionId
  );
  return {
    sessionId,
    destinationProfileId: context.destinationProfileId,
    processedBatchIds: batches.map((row) => String(row.batch_id)),
    completed: existing[0]?.status === "completed"
  };
}

export async function applyMobileMigrationBatch(
  connection: duckdb.Connection,
  context: MigrationContext,
  batch: MobileMigrationBatch
): Promise<MobileMigrationBatchAcknowledgement> {
  const session = await requireSession(connection, context.pairingId, batch.sessionId);
  if (session.status === "completed") throw requestError(409, "This migration is already complete.");
  const prior = await allWithParams(
    connection,
    "SELECT acknowledgement FROM companion_migration_batches WHERE session_id = ? AND batch_id = ? LIMIT 1;",
    batch.sessionId,
    batch.batchId
  );
  if (prior.length) return parseJson(prior[0]?.acknowledgement) as MobileMigrationBatchAcknowledgement;

  const acknowledgement: MobileMigrationBatchAcknowledgement = {
    sessionId: batch.sessionId,
    batchId: batch.batchId,
    counts: { accepted: 0, duplicates: 0, conflicts: 0 },
    duplicates: [],
    conflicts: []
  };

  for (const entry of batch.sourceImports) {
    const byId = await allWithParams(connection, "SELECT * FROM imports WHERE id = ? LIMIT 1;", entry.id);
    if (byId.length && !sameSourceImport(byId[0]!, entry)) {
      addConflict(acknowledgement, "sourceImport", entry.id, "An existing source import has the same ID but different content.");
      continue;
    }
    const byIdentity = byId.length ? byId : await allWithParams(
      connection,
      "SELECT id FROM imports WHERE source_kind = ? AND file_name = ? AND checksum = ? LIMIT 1;",
      entry.sourceKind,
      entry.fileName,
      entry.checksum
    );
    if (byIdentity.length) {
      addDuplicate(acknowledgement, "sourceImport", entry.id, byId.length ? "exact-id" : "source-import-identity");
      await saveAlias(connection, batch.sessionId, "sourceImport", entry.id, String(byIdentity[0]?.id));
      continue;
    }
    await run(
      connection,
      "INSERT INTO imports VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
      await nextOrdinal(connection, "imports"), entry.id, entry.sourceKind, entry.fileName, entry.importedAt,
      entry.parserVersion, entry.checksum, entry.rowCount, entry.status, json(entry.diagnostics), null
    );
    await saveAlias(connection, batch.sessionId, "sourceImport", entry.id, entry.id);
    acknowledgement.counts.accepted++;
  }

  for (const entry of batch.dataSources) {
    const importId = entry.importId
      ? await resolveAlias(connection, batch.sessionId, "sourceImport", entry.importId)
      : undefined;
    if (entry.importId && !importId) {
      addConflict(acknowledgement, "dataSource", entry.id, "Its source import has not been accepted.");
      continue;
    }
    const existing = await allWithParams(connection, "SELECT * FROM sources WHERE id = ? LIMIT 1;", entry.id);
    if (existing.length) {
      if (!sameDataSource(existing[0]!, entry, importId)) {
        addConflict(acknowledgement, "dataSource", entry.id, "An existing data source has the same ID but different content.");
        continue;
      }
      addDuplicate(acknowledgement, "dataSource", entry.id, "exact-id");
      await saveAlias(connection, batch.sessionId, "dataSource", entry.id, entry.id);
      continue;
    }
    await run(
      connection,
      "INSERT INTO sources VALUES (?, ?, ?, ?, ?, ?);",
      await nextOrdinal(connection, "sources"), entry.id, entry.sourceKind, entry.label, importId ?? null, entry.createdAt
    );
    await saveAlias(connection, batch.sessionId, "dataSource", entry.id, entry.id);
    acknowledgement.counts.accepted++;
  }

  for (const entry of batch.observationGroups) {
    const sourceId = entry.sourceId
      ? await resolveAlias(connection, batch.sessionId, "dataSource", entry.sourceId)
      : undefined;
    const importId = entry.importId
      ? await resolveAlias(connection, batch.sessionId, "sourceImport", entry.importId)
      : undefined;
    if ((entry.sourceId && !sourceId) || (entry.importId && !importId)) {
      addConflict(acknowledgement, "observationGroup", entry.id, "A source dependency has not been accepted.");
      continue;
    }
    const existing = await allWithParams(connection, "SELECT * FROM observation_groups WHERE id = ? LIMIT 1;", entry.id);
    if (existing.length) {
      if (!sameObservationGroup(existing[0]!, entry, sourceId, importId)) {
        addConflict(acknowledgement, "observationGroup", entry.id, "An existing observation group has the same ID but different content.");
        continue;
      }
      addDuplicate(acknowledgement, "observationGroup", entry.id, "exact-id");
      await saveAlias(connection, batch.sessionId, "observationGroup", entry.id, entry.id);
      continue;
    }
    await run(
      connection,
      "INSERT INTO observation_groups VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
      await nextOrdinal(connection, "observation_groups"), entry.id, entry.kind, entry.label, sourceId ?? null,
      importId ?? null, entry.startAt ?? null, entry.endAt ?? null, entry.collectedAt ?? null,
      optionalJsonValue(entry.metadata)
    );
    await saveAlias(connection, batch.sessionId, "observationGroup", entry.id, entry.id);
    acknowledgement.counts.accepted++;
  }

  for (const entry of batch.observations) {
    const sourceId = await resolveAlias(connection, batch.sessionId, "dataSource", entry.sourceId);
    const groupId = entry.observationGroupId
      ? await resolveAlias(connection, batch.sessionId, "observationGroup", entry.observationGroupId)
      : undefined;
    if (!sourceId || (entry.observationGroupId && !groupId)) {
      addConflict(acknowledgement, "observation", entry.id, "A source dependency has not been accepted.");
      continue;
    }
    const existing = await allWithParams(connection, "SELECT * FROM observations WHERE id = ? LIMIT 1;", entry.id);
    if (existing.length) {
      if (!sameObservation(existing[0]!, entry, sourceId, groupId)) {
        addConflict(acknowledgement, "observation", entry.id, "An existing observation has the same ID but different content.");
        continue;
      }
      addDuplicate(acknowledgement, "observation", entry.id, "exact-id");
      continue;
    }
    const duplicateCandidates = await allWithParams(
      connection,
      `SELECT o.id, o.value, o.unit
       FROM observations o
       JOIN sources s ON s.id = o.source_id
       LEFT JOIN imports i ON i.id = s.import_id
       JOIN sources incoming_s ON incoming_s.id = ?
       LEFT JOIN imports incoming_i ON incoming_i.id = incoming_s.import_id
       WHERE o.measurement_code = ? AND o.observed_at = ? AND
         COALESCE(o.effective_start, TIMESTAMP '1970-01-01') = COALESCE(?, TIMESTAMP '1970-01-01') AND
         COALESCE(o.effective_end, TIMESTAMP '1970-01-01') = COALESCE(?, TIMESTAMP '1970-01-01') AND
         (
           s.id = incoming_s.id OR (
             i.id IS NOT NULL AND incoming_i.id IS NOT NULL AND
             s.source_kind = incoming_s.source_kind AND
             i.file_name = incoming_i.file_name AND i.checksum = incoming_i.checksum
           )
         )
       ;`,
      sourceId, entry.measurementCode, entry.observedAt, entry.effectiveStart ?? null,
      entry.effectiveEnd ?? null
    );
    if (duplicateCandidates.some((candidate) => sameCanonicalMeasurement(
      entry.measurementCode,
      Number(candidate.value),
      String(candidate.unit),
      entry.value,
      entry.unit
    ))) {
      addDuplicate(acknowledgement, "observation", entry.id, "canonical-observation");
      continue;
    }
    await insertObservationRows(connection, [{ ...entry, sourceId, observationGroupId: groupId }], await nextOrdinal(connection, "observations"));
    acknowledgement.counts.accepted++;
  }

  await run(
    connection,
    `INSERT INTO companion_migration_batches
     (session_id, batch_id, acknowledgement, submitted_counts, processed_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP);`,
    batch.sessionId,
    batch.batchId,
    json(acknowledgement),
    json({
      sourceImports: batch.sourceImports.length,
      dataSources: batch.dataSources.length,
      observationGroups: batch.observationGroups.length,
      observations: batch.observations.length
    })
  );
  return acknowledgement;
}

export async function completeMobileMigration(
  connection: duckdb.Connection,
  context: MigrationContext,
  sessionId: string
): Promise<MobileMigrationReceipt> {
  const session = await requireSession(connection, context.pairingId, sessionId);
  if (session.receipt) return parseJson(session.receipt) as MobileMigrationReceipt;
  const manifest = parseJson(session.manifest) as MobileMigrationManifest;
  const rows = await allWithParams(
    connection,
    "SELECT acknowledgement, submitted_counts FROM companion_migration_batches WHERE session_id = ?;",
    sessionId
  );
  const acknowledgements = rows.map((row) =>
    parseJson(row.acknowledgement) as MobileMigrationBatchAcknowledgement);
  const counts = acknowledgements.reduce(
    (total, value) => ({
      accepted: total.accepted + value.counts.accepted,
      duplicates: total.duplicates + value.counts.duplicates,
      conflicts: total.conflicts + value.counts.conflicts
    }),
    { accepted: 0, duplicates: 0, conflicts: 0 }
  );
  const submitted = rows.reduce<MobileMigrationManifest["counts"]>(
    (total, row) => {
      const counts = parseJson(row.submitted_counts) as MobileMigrationManifest["counts"];
      return {
        sourceImports: total.sourceImports + counts.sourceImports,
        dataSources: total.dataSources + counts.dataSources,
        observationGroups: total.observationGroups + counts.observationGroups,
        observations: total.observations + counts.observations
      };
    },
    { sourceImports: 0, dataSources: 0, observationGroups: 0, observations: 0 }
  );
  if (JSON.stringify(submitted) !== JSON.stringify(manifest.counts)) {
    throw requestError(409, "Migration batches do not match the manifest.");
  }
  const expected = Object.values(manifest.counts).reduce((sum, value) => sum + value, 0);
  if (counts.accepted + counts.duplicates + counts.conflicts !== expected) {
    throw requestError(409, "Migration batches are incomplete.");
  }
  const receipt: MobileMigrationReceipt = {
    receiptId: randomUUID(),
    sessionId,
    pairingId: context.pairingId,
    destinationProfileId: context.destinationProfileId,
    datasetFingerprint: manifest.datasetFingerprint,
    completedAt: new Date().toISOString(),
    counts
  };
  await run(
    connection,
    `UPDATE companion_migration_sessions
     SET status = 'completed', completed_at = ?, receipt = ? WHERE session_id = ?;`,
    receipt.completedAt,
    json(receipt),
    sessionId
  );
  return receipt;
}

async function requireSession(connection: duckdb.Connection, pairingId: string, sessionId: string) {
  const rows = await allWithParams(
    connection,
    `SELECT status, manifest, receipt FROM companion_migration_sessions
     WHERE session_id = ? AND pairing_id = ? LIMIT 1;`,
    sessionId,
    pairingId
  );
  if (!rows.length) throw requestError(404, "Migration session not found.");
  return rows[0]!;
}

async function saveAlias(
  connection: duckdb.Connection,
  sessionId: string,
  entityType: string,
  sourceId: string,
  destinationId: string
): Promise<void> {
  await run(
    connection,
    "INSERT OR REPLACE INTO companion_migration_aliases VALUES (?, ?, ?, ?);",
    sessionId,
    entityType,
    sourceId,
    destinationId
  );
}

async function resolveAlias(
  connection: duckdb.Connection,
  sessionId: string,
  entityType: string,
  sourceId: string
): Promise<string | undefined> {
  const rows = await allWithParams(
    connection,
    `SELECT destination_id FROM companion_migration_aliases
     WHERE session_id = ? AND entity_type = ? AND source_id = ? LIMIT 1;`,
    sessionId,
    entityType,
    sourceId
  );
  return rows[0]?.destination_id ? String(rows[0].destination_id) : undefined;
}

function addConflict(
  acknowledgement: MobileMigrationBatchAcknowledgement,
  entityType: MobileMigrationConflict["entityType"],
  entityId: string,
  reason: string
): void {
  acknowledgement.counts.conflicts++;
  acknowledgement.conflicts.push({ entityType, entityId, reason });
}

function addDuplicate(
  acknowledgement: MobileMigrationBatchAcknowledgement,
  entityType: MobileMigrationDuplicate["entityType"],
  entityId: string,
  classification: MobileMigrationDuplicate["classification"]
): void {
  acknowledgement.counts.duplicates++;
  acknowledgement.duplicates.push({ entityType, entityId, classification });
}

function parseJson(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function sameManifest(left: MobileMigrationManifest, right: MobileMigrationManifest): boolean {
  return left.protocolVersion === right.protocolVersion &&
    left.datasetId === right.datasetId &&
    left.datasetFingerprint === right.datasetFingerprint &&
    left.sourceProfileId === right.sourceProfileId &&
    Object.keys(right.counts).every((key) =>
      left.counts[key as keyof MobileMigrationManifest["counts"]] ===
      right.counts[key as keyof MobileMigrationManifest["counts"]]);
}

function sameSourceImport(row: Record<string, unknown>, entry: MobileMigrationBatch["sourceImports"][number]): boolean {
  return String(row.source_kind) === entry.sourceKind &&
    String(row.file_name) === entry.fileName &&
    sameInstant(row.imported_at, entry.importedAt) &&
    String(row.parser_version) === entry.parserVersion &&
    String(row.checksum) === entry.checksum &&
    Number(row.row_count) === entry.rowCount &&
    String(row.status) === entry.status &&
    sameJson(row.diagnostics, entry.diagnostics);
}

function sameDataSource(
  row: Record<string, unknown>,
  entry: MobileMigrationBatch["dataSources"][number],
  importId: string | undefined
): boolean {
  return String(row.source_kind) === entry.sourceKind &&
    String(row.label) === entry.label &&
    optionalString(row.import_id) === importId &&
    sameInstant(row.created_at, entry.createdAt);
}

function sameObservationGroup(
  row: Record<string, unknown>,
  entry: MobileMigrationBatch["observationGroups"][number],
  sourceId: string | undefined,
  importId: string | undefined
): boolean {
  return String(row.kind) === entry.kind &&
    String(row.label) === entry.label &&
    optionalString(row.source_id) === sourceId &&
    optionalString(row.import_id) === importId &&
    sameOptionalInstant(row.start_at, entry.startAt) &&
    sameOptionalInstant(row.end_at, entry.endAt) &&
    sameOptionalInstant(row.collected_at, entry.collectedAt) &&
    sameJson(row.metadata, entry.metadata);
}

function sameObservation(
  row: Record<string, unknown>,
  entry: MobileMigrationBatch["observations"][number],
  sourceId: string,
  groupId: string | undefined
): boolean {
  return String(row.measurement_code) === entry.measurementCode &&
    sameInstant(row.observed_at, entry.observedAt) &&
    sameOptionalInstant(row.effective_start, entry.effectiveStart) &&
    sameOptionalInstant(row.effective_end, entry.effectiveEnd) &&
    Number(row.value) === entry.value &&
    String(row.unit).trim().toLowerCase() === entry.unit.trim().toLowerCase() &&
    String(row.source_id) === sourceId &&
    optionalString(row.observation_group_id) === groupId &&
    optionalString(row.device_id) === entry.deviceId &&
    optionalString(row.note) === entry.note &&
    sameJson(row.source_json, entry.sourceJson);
}

function sameInstant(left: unknown, right: string): boolean {
  return new Date(left as string | number | Date).toISOString() === new Date(right).toISOString();
}

function sameOptionalInstant(left: unknown, right: string | undefined): boolean {
  return left == null && right === undefined || left != null && right !== undefined && sameInstant(left, right);
}

function optionalString(value: unknown): string | undefined {
  return value == null ? undefined : String(value);
}

function sameJson(left: unknown, right: unknown): boolean {
  const parsed = typeof left === "string" ? JSON.parse(left) : left;
  return JSON.stringify(parsed ?? undefined) === JSON.stringify(right ?? undefined);
}

function sameCanonicalMeasurement(
  measurementCode: string,
  leftValue: number,
  leftUnit: string,
  rightValue: number,
  rightUnit: string
): boolean {
  const measurementType = findMeasurementType(measurementCode);
  if (!measurementType) {
    return leftUnit.trim().toLowerCase() === rightUnit.trim().toLowerCase() && leftValue === rightValue;
  }
  const canonicalUnit = measurementType.canonicalUnit;
  const normalizedLeftUnit = normalizeMeasurementUnit(measurementType, leftUnit);
  const normalizedRightUnit = normalizeMeasurementUnit(measurementType, rightUnit);
  const canonicalLeft = convertMeasurementValue(leftValue, measurementType, normalizedLeftUnit, canonicalUnit);
  const canonicalRight = convertMeasurementValue(rightValue, measurementType, normalizedRightUnit, canonicalUnit);
  if (canonicalLeft === undefined || canonicalRight === undefined) return false;
  const scale = Math.max(1, Math.abs(canonicalLeft), Math.abs(canonicalRight));
  return Math.abs(canonicalLeft - canonicalRight) <= scale * 1e-9;
}

function requestError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}
