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
import {
  replicaObservationUpsert,
  replicaUpsert,
  type ReplicaChangeInput
} from "./duckdbReplicaChanges.js";
import {
  allWithParams,
  insertObservationRows,
  insertRows,
  json,
  optionalJsonValue,
  run
} from "./duckdbRows.js";

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

export interface MobileMigrationBatchResult extends MobileMigrationBatchAcknowledgement {
  replicaChanges: ReplicaChangeInput[];
}

/**
 * Applies one migration batch.
 *
 * Every lookup is batched: existing rows are probed once per entity type, the session's alias table
 * is loaded once into memory, ordinals are allocated in JS from a single starting value, and the
 * canonical-duplicate check runs as one query over the whole batch. The earlier per-row version
 * issued roughly six queries per observation, which dominated the first thing a tester does.
 */
export async function applyMobileMigrationBatch(
  connection: duckdb.Connection,
  context: MigrationContext,
  batch: MobileMigrationBatch
): Promise<MobileMigrationBatchResult> {
  const session = await requireSession(connection, context.pairingId, batch.sessionId);
  if (session.status === "completed") throw requestError(409, "This migration is already complete.");
  const prior = await allWithParams(
    connection,
    "SELECT acknowledgement FROM companion_migration_batches WHERE session_id = ? AND batch_id = ? LIMIT 1;",
    batch.sessionId,
    batch.batchId
  );
  if (prior.length) {
    return {
      ...(parseJson(prior[0]?.acknowledgement) as MobileMigrationBatchAcknowledgement),
      replicaChanges: []
    };
  }

  const acknowledgement: MobileMigrationBatchAcknowledgement = {
    sessionId: batch.sessionId,
    batchId: batch.batchId,
    counts: { accepted: 0, duplicates: 0, conflicts: 0 },
    duplicates: [],
    conflicts: []
  };
  const replicaChanges: ReplicaChangeInput[] = [];
  const aliases = await loadAliases(connection, batch.sessionId);
  const newAliases: unknown[][] = [];
  const rememberAlias = (entityType: string, sourceId: string, destinationId: string): void => {
    aliases.set(aliasKey(entityType, sourceId), destinationId);
    newAliases.push([batch.sessionId, entityType, sourceId, destinationId]);
  };
  const resolveAlias = (entityType: string, sourceId: string): string | undefined =>
    aliases.get(aliasKey(entityType, sourceId));

  // Naming columns keeps the raw import payload - potentially megabytes - off the dedupe probe.
  const existingImports = await rowsById(
    connection,
    `SELECT id, source_kind, file_name, imported_at, parser_version, checksum, row_count, status, diagnostics
     FROM imports`,
    batch.sourceImports.map((entry) => entry.id)
  );
  const importsByIdentity = await rowsByKey(
    connection,
    "SELECT id, source_kind, file_name, checksum FROM imports",
    "checksum",
    batch.sourceImports.map((entry) => entry.checksum),
    (row) => importIdentityKey(String(row.source_kind), String(row.file_name), String(row.checksum))
  );
  let importOrdinal = await nextOrdinal(connection, "imports", batch.sourceImports.length);
  const importRows: unknown[][] = [];
  for (const entry of batch.sourceImports) {
    const byId = existingImports.get(entry.id);
    if (byId && !sameSourceImport(byId, entry)) {
      addConflict(acknowledgement, "sourceImport", entry.id, "An existing source import has the same ID but different content.");
      continue;
    }
    const identityMatch = byId
      ?? importsByIdentity.get(importIdentityKey(entry.sourceKind, entry.fileName, entry.checksum));
    if (identityMatch) {
      addDuplicate(acknowledgement, "sourceImport", entry.id, byId ? "exact-id" : "source-import-identity");
      rememberAlias("sourceImport", entry.id, String(identityMatch.id));
      continue;
    }
    importRows.push([
      importOrdinal++, entry.id, entry.sourceKind, entry.fileName, entry.importedAt,
      entry.parserVersion, entry.checksum, entry.rowCount, entry.status, json(entry.diagnostics), null
    ]);
    rememberAlias("sourceImport", entry.id, entry.id);
    replicaChanges.push(replicaUpsert("source-import", entry.id, entry));
    acknowledgement.counts.accepted++;
  }
  await insertRows(connection, "imports", importRows);

  const existingSources = await rowsById(
    connection, "SELECT * FROM sources", batch.dataSources.map((entry) => entry.id));
  let sourceOrdinal = await nextOrdinal(connection, "sources", batch.dataSources.length);
  const sourceRows: unknown[][] = [];
  for (const entry of batch.dataSources) {
    const importId = entry.importId ? resolveAlias("sourceImport", entry.importId) : undefined;
    if (entry.importId && !importId) {
      addConflict(acknowledgement, "dataSource", entry.id, "Its source import has not been accepted.");
      continue;
    }
    const existing = existingSources.get(entry.id);
    if (existing) {
      if (!sameDataSource(existing, entry, importId)) {
        addConflict(acknowledgement, "dataSource", entry.id, "An existing data source has the same ID but different content.");
        continue;
      }
      addDuplicate(acknowledgement, "dataSource", entry.id, "exact-id");
      rememberAlias("dataSource", entry.id, entry.id);
      continue;
    }
    sourceRows.push([
      sourceOrdinal++, entry.id, entry.sourceKind, entry.label, importId ?? null, entry.createdAt
    ]);
    rememberAlias("dataSource", entry.id, entry.id);
    replicaChanges.push(replicaUpsert("data-source", entry.id, entry));
    acknowledgement.counts.accepted++;
  }
  await insertRows(connection, "sources", sourceRows);

  const existingGroups = await rowsById(
    connection, "SELECT * FROM observation_groups", batch.observationGroups.map((entry) => entry.id));
  let groupOrdinal = await nextOrdinal(connection, "observation_groups", batch.observationGroups.length);
  const groupRows: unknown[][] = [];
  for (const entry of batch.observationGroups) {
    const sourceId = entry.sourceId ? resolveAlias("dataSource", entry.sourceId) : undefined;
    const importId = entry.importId ? resolveAlias("sourceImport", entry.importId) : undefined;
    if ((entry.sourceId && !sourceId) || (entry.importId && !importId)) {
      addConflict(acknowledgement, "observationGroup", entry.id, "A source dependency has not been accepted.");
      continue;
    }
    const existing = existingGroups.get(entry.id);
    if (existing) {
      if (!sameObservationGroup(existing, entry, sourceId, importId)) {
        addConflict(acknowledgement, "observationGroup", entry.id, "An existing observation group has the same ID but different content.");
        continue;
      }
      addDuplicate(acknowledgement, "observationGroup", entry.id, "exact-id");
      rememberAlias("observationGroup", entry.id, entry.id);
      continue;
    }
    groupRows.push([
      groupOrdinal++, entry.id, entry.kind, entry.label, sourceId ?? null,
      importId ?? null, entry.startAt ?? null, entry.endAt ?? null, entry.collectedAt ?? null,
      optionalJsonValue(entry.metadata)
    ]);
    rememberAlias("observationGroup", entry.id, entry.id);
    replicaChanges.push(replicaUpsert("observation-group", entry.id, entry));
    acknowledgement.counts.accepted++;
  }
  await insertRows(connection, "observation_groups", groupRows);

  const existingObservations = await rowsById(
    connection, "SELECT * FROM observations", batch.observations.map((entry) => entry.id));
  const duplicateCandidates = await loadDuplicateCandidates(connection, batch.observations);
  const sourceIdentities = await loadSourceIdentities(
    connection,
    batch.observations.map((entry) => resolveAlias("dataSource", entry.sourceId)).filter(isDefined)
  );
  const pendingObservations: Array<MobileMigrationBatch["observations"][number] & {
    sourceId: string;
    observationGroupId?: string;
  }> = [];
  for (const entry of batch.observations) {
    const sourceId = resolveAlias("dataSource", entry.sourceId);
    const groupId = entry.observationGroupId
      ? resolveAlias("observationGroup", entry.observationGroupId)
      : undefined;
    if (!sourceId || (entry.observationGroupId && !groupId)) {
      addConflict(acknowledgement, "observation", entry.id, "A source dependency has not been accepted.");
      continue;
    }
    const existing = existingObservations.get(entry.id);
    if (existing) {
      if (!sameObservation(existing, entry, sourceId, groupId)) {
        addConflict(acknowledgement, "observation", entry.id, "An existing observation has the same ID but different content.");
        continue;
      }
      addDuplicate(acknowledgement, "observation", entry.id, "exact-id");
      continue;
    }
    const incomingIdentity = sourceIdentities.get(sourceId);
    const isDuplicate = (duplicateCandidates.get(entry.measurementCode) ?? []).some((candidate) =>
      sameInstant(candidate.observed_at, entry.observedAt) &&
      sameOptionalInstant(candidate.effective_start, entry.effectiveStart) &&
      sameOptionalInstant(candidate.effective_end, entry.effectiveEnd) &&
      sameOriginatingSource(candidate, sourceId, incomingIdentity) &&
      sameCanonicalMeasurement(
        entry.measurementCode,
        Number(candidate.value),
        String(candidate.unit),
        entry.value,
        entry.unit
      ));
    if (isDuplicate) {
      addDuplicate(acknowledgement, "observation", entry.id, "canonical-observation");
      continue;
    }
    pendingObservations.push({ ...entry, sourceId, ...(groupId ? { observationGroupId: groupId } : {}) });
    acknowledgement.counts.accepted++;
  }
  const { inserted } = await insertObservationRows(
    connection, pendingObservations, await nextOrdinal(connection, "observations", pendingObservations.length));
  for (const observation of inserted) {
    replicaChanges.push(...replicaObservationUpsert(observation));
  }

  await saveAliases(connection, newAliases);
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
  return { ...acknowledgement, replicaChanges };
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

/** Writes the batch's newly minted aliases in one statement rather than one per accepted row. */
async function saveAliases(connection: duckdb.Connection, rows: readonly unknown[][]): Promise<void> {
  for (let index = 0; index < rows.length; index += maxInListSize) {
    const chunk = rows.slice(index, index + maxInListSize);
    await run(
      connection,
      `INSERT OR REPLACE INTO companion_migration_aliases VALUES ${
        chunk.map(() => "(?, ?, ?, ?)").join(", ")};`,
      ...chunk.flat()
    );
  }
}

function aliasKey(entityType: string, sourceId: string): string {
  return `${entityType}\u0000${sourceId}`;
}

async function loadAliases(
  connection: duckdb.Connection,
  sessionId: string
): Promise<Map<string, string>> {
  const rows = await allWithParams(
    connection,
    "SELECT entity_type, source_id, destination_id FROM companion_migration_aliases WHERE session_id = ?;",
    sessionId
  );
  return new Map(rows.map((row) =>
    [aliasKey(String(row.entity_type), String(row.source_id)), String(row.destination_id)]));
}

/** One `id IN (...)` probe per entity type instead of one `LIMIT 1` query per row. */
async function rowsById(
  connection: duckdb.Connection,
  selectClause: string,
  ids: readonly string[]
): Promise<Map<string, Record<string, unknown>>> {
  return rowsByKey(connection, selectClause, "id", ids, (row) => String(row.id));
}

async function rowsByKey(
  connection: duckdb.Connection,
  selectClause: string,
  column: string,
  values: readonly string[],
  key: (row: Record<string, unknown>) => string
): Promise<Map<string, Record<string, unknown>>> {
  const distinct = [...new Set(values)];
  const found = new Map<string, Record<string, unknown>>();
  for (let index = 0; index < distinct.length; index += maxInListSize) {
    const chunk = distinct.slice(index, index + maxInListSize);
    const rows = await allWithParams(
      connection,
      `${selectClause} WHERE ${column} IN (${chunk.map(() => "?").join(", ")});`,
      ...chunk
    );
    for (const row of rows) {
      found.set(key(row), row);
    }
  }
  return found;
}

const maxInListSize = 500;

function importIdentityKey(sourceKind: string, fileName: string, checksum: string): string {
  return `${sourceKind}\u0000${fileName}\u0000${checksum}`;
}

/**
 * Fetches every stored observation that could canonically duplicate something in this batch, keyed
 * by measurement code. Filtering on `measurement_code` alone lets the batch reuse the
 * `observations(measurement_code, observed_at)` index while keeping the query count at one.
 */
async function loadDuplicateCandidates(
  connection: duckdb.Connection,
  observations: MobileMigrationBatch["observations"]
): Promise<Map<string, Array<Record<string, unknown>>>> {
  const candidates = new Map<string, Array<Record<string, unknown>>>();
  const codes = [...new Set(observations.map((entry) => entry.measurementCode))];
  const observedAt = [...new Set(observations.map((entry) => entry.observedAt))];
  if (codes.length === 0) {
    return candidates;
  }
  for (let index = 0; index < observedAt.length; index += maxInListSize) {
    const instants = observedAt.slice(index, index + maxInListSize);
    const rows = await allWithParams(
      connection,
      `SELECT o.id, o.measurement_code, o.observed_at, o.effective_start, o.effective_end,
              o.value, o.unit, o.source_id, s.source_kind, i.file_name, i.checksum
       FROM observations o
       JOIN sources s ON s.id = o.source_id
       LEFT JOIN imports i ON i.id = s.import_id
       WHERE o.measurement_code IN (${codes.map(() => "?").join(", ")})
         AND o.observed_at IN (${instants.map(() => "?").join(", ")});`,
      ...codes,
      ...instants
    );
    for (const row of rows) {
      const code = String(row.measurement_code);
      const existing = candidates.get(code);
      if (existing) {
        existing.push(row);
      } else {
        candidates.set(code, [row]);
      }
    }
  }
  return candidates;
}

interface SourceIdentity {
  sourceKind: string;
  fileName?: string;
  checksum?: string;
}

async function loadSourceIdentities(
  connection: duckdb.Connection,
  sourceIds: readonly string[]
): Promise<Map<string, SourceIdentity>> {
  const rows = await rowsByKey(
    connection,
    "SELECT s.id, s.source_kind, i.file_name, i.checksum FROM sources s LEFT JOIN imports i ON i.id = s.import_id",
    "s.id",
    sourceIds,
    (row) => String(row.id)
  );
  return new Map([...rows].map(([id, row]) => [id, {
    sourceKind: String(row.source_kind),
    ...(row.file_name == null ? {} : { fileName: String(row.file_name) }),
    ...(row.checksum == null ? {} : { checksum: String(row.checksum) })
  }]));
}

/**
 * A stored observation counts as originating from the same place when it shares the incoming
 * source row outright, or when both sides came from the same import file of the same kind.
 */
function sameOriginatingSource(
  candidate: Record<string, unknown>,
  incomingSourceId: string,
  incoming: SourceIdentity | undefined
): boolean {
  if (String(candidate.source_id) === incomingSourceId) {
    return true;
  }
  if (!incoming?.fileName || !incoming.checksum) {
    return false;
  }
  return String(candidate.source_kind) === incoming.sourceKind &&
    candidate.file_name != null && String(candidate.file_name) === incoming.fileName &&
    candidate.checksum != null && String(candidate.checksum) === incoming.checksum;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
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
