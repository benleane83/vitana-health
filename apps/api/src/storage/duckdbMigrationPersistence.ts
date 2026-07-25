import { randomUUID } from "node:crypto";
import type duckdb from "duckdb";
import type {
  MobileMigrationBatch,
  MobileMigrationBatchAcknowledgement,
  MobileMigrationConflict,
  MobileMigrationManifest,
  MobileMigrationReceipt,
  MobileMigrationStartResponse
} from "@vitana/shared";
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
    conflicts: []
  };

  for (const entry of batch.sourceImports) {
    const byId = await allWithParams(connection, "SELECT id FROM imports WHERE id = ? LIMIT 1;", entry.id);
    const byIdentity = byId.length ? byId : await allWithParams(
      connection,
      "SELECT id FROM imports WHERE source_kind = ? AND file_name = ? AND checksum = ? LIMIT 1;",
      entry.sourceKind,
      entry.fileName,
      entry.checksum
    );
    if (byIdentity.length) {
      acknowledgement.counts.duplicates++;
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
    const existing = await allWithParams(connection, "SELECT id FROM sources WHERE id = ? LIMIT 1;", entry.id);
    if (existing.length) {
      acknowledgement.counts.duplicates++;
      await saveAlias(connection, batch.sessionId, "dataSource", entry.id, entry.id);
      continue;
    }
    const importId = entry.importId
      ? await resolveAlias(connection, batch.sessionId, "sourceImport", entry.importId)
      : undefined;
    if (entry.importId && !importId) {
      addConflict(acknowledgement, "dataSource", entry.id, "Its source import has not been accepted.");
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
    const existing = await allWithParams(connection, "SELECT id FROM observation_groups WHERE id = ? LIMIT 1;", entry.id);
    if (existing.length) {
      acknowledgement.counts.duplicates++;
      await saveAlias(connection, batch.sessionId, "observationGroup", entry.id, entry.id);
      continue;
    }
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
    const existing = await allWithParams(connection, "SELECT id FROM observations WHERE id = ? LIMIT 1;", entry.id);
    if (existing.length) {
      acknowledgement.counts.duplicates++;
      continue;
    }
    const sourceId = await resolveAlias(connection, batch.sessionId, "dataSource", entry.sourceId);
    const groupId = entry.observationGroupId
      ? await resolveAlias(connection, batch.sessionId, "observationGroup", entry.observationGroupId)
      : undefined;
    if (!sourceId || (entry.observationGroupId && !groupId)) {
      addConflict(acknowledgement, "observation", entry.id, "A source dependency has not been accepted.");
      continue;
    }
    const duplicate = await allWithParams(
      connection,
      `SELECT o.id
       FROM observations o
       JOIN sources s ON s.id = o.source_id
       LEFT JOIN imports i ON i.id = s.import_id
       JOIN sources incoming_s ON incoming_s.id = ?
       LEFT JOIN imports incoming_i ON incoming_i.id = incoming_s.import_id
       WHERE o.measurement_code = ? AND o.observed_at = ? AND
         COALESCE(o.effective_start, TIMESTAMP '1970-01-01') = COALESCE(?, TIMESTAMP '1970-01-01') AND
         COALESCE(o.effective_end, TIMESTAMP '1970-01-01') = COALESCE(?, TIMESTAMP '1970-01-01') AND
         o.value = ? AND lower(trim(o.unit)) = lower(trim(?)) AND
         s.source_kind = incoming_s.source_kind AND
         COALESCE(i.file_name, '') = COALESCE(incoming_i.file_name, '') AND
         COALESCE(i.checksum, '') = COALESCE(incoming_i.checksum, '')
       LIMIT 1;`,
      sourceId, entry.measurementCode, entry.observedAt, entry.effectiveStart ?? null,
      entry.effectiveEnd ?? null, entry.value, entry.unit
    );
    if (duplicate.length) {
      acknowledgement.counts.duplicates++;
      continue;
    }
    await insertObservationRows(connection, [{ ...entry, sourceId, observationGroupId: groupId }], await nextOrdinal(connection, "observations"));
    acknowledgement.counts.accepted++;
  }

  await run(
    connection,
    `INSERT INTO companion_migration_batches
     (session_id, batch_id, acknowledgement, processed_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP);`,
    batch.sessionId,
    batch.batchId,
    json(acknowledgement)
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
    "SELECT acknowledgement FROM companion_migration_batches WHERE session_id = ?;",
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

function parseJson(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function requestError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}
