import { randomUUID } from "node:crypto";
import type duckdb from "duckdb";
import type {
  HealthConnectSyncBatchAcknowledgement,
  HealthConnectSyncCounts,
  HealthConnectSyncSessionResponse
} from "@vitana/shared";
import { HEALTH_CONNECT_SYNC_PROTOCOL_VERSION } from "@vitana/shared";
import type { ImportOutcome } from "./profileRepository.js";
import type { HealthConnectSyncSessionStart } from "./types.js";
import { allWithParams, json, run } from "./duckdbRows.js";

/**
 * Session bookkeeping for the chunked Health Connect sync. It deliberately mirrors
 * `companion_migration_*`: a session identified by (pairing, key) plus a per-batch acknowledgement
 * record that turns a re-uploaded chunk into a replayed answer rather than a second import.
 */

export type { HealthConnectSyncSessionStart };

export async function startHealthConnectSyncSession(
  connection: duckdb.Connection,
  pairingId: string,
  request: HealthConnectSyncSessionStart
): Promise<HealthConnectSyncSessionResponse> {
  const existing = await allWithParams(
    connection,
    "SELECT session_id FROM health_connect_sync_sessions WHERE pairing_id = ? AND session_key = ? LIMIT 1;",
    pairingId,
    request.sessionKey
  );
  const sessionId = existing.length > 0 ? String(existing[0]!.session_id) : randomUUID();
  if (existing.length === 0) {
    await run(
      connection,
      `INSERT INTO health_connect_sync_sessions
        (session_id, pairing_id, session_key, device_label, range_start, range_end, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?);`,
      sessionId,
      pairingId,
      request.sessionKey,
      request.deviceLabel,
      request.rangeStart,
      request.rangeEnd,
      new Date().toISOString()
    );
  }
  return {
    protocolVersion: HEALTH_CONNECT_SYNC_PROTOCOL_VERSION,
    sessionId,
    processedBatchIds: await processedBatchIds(connection, sessionId)
  };
}

export async function findHealthConnectSyncSession(
  connection: duckdb.Connection,
  pairingId: string,
  sessionId: string
): Promise<{ sessionId: string } | undefined> {
  const rows = await allWithParams(
    connection,
    "SELECT session_id FROM health_connect_sync_sessions WHERE session_id = ? AND pairing_id = ? LIMIT 1;",
    sessionId,
    pairingId
  );
  return rows.length > 0 ? { sessionId: String(rows[0]!.session_id) } : undefined;
}

/**
 * Returns the stored acknowledgement when this batch has already been applied. The caller must not
 * import the payload again in that case - the answer is replayed verbatim so a phone retrying after
 * a lost response converges instead of double-counting.
 */
export async function findHealthConnectSyncAcknowledgement(
  connection: duckdb.Connection,
  sessionId: string,
  batchId: string
): Promise<HealthConnectSyncBatchAcknowledgement | undefined> {
  const rows = await allWithParams(
    connection,
    "SELECT acknowledgement FROM health_connect_sync_batches WHERE session_id = ? AND batch_id = ? LIMIT 1;",
    sessionId,
    batchId
  );
  if (rows.length === 0) return undefined;
  const stored = rows[0]!.acknowledgement;
  return JSON.parse(typeof stored === "string" ? stored : String(stored)) as HealthConnectSyncBatchAcknowledgement;
}

export async function recordHealthConnectSyncAcknowledgement(
  connection: duckdb.Connection,
  acknowledgement: HealthConnectSyncBatchAcknowledgement
): Promise<void> {
  await run(
    connection,
    `INSERT OR IGNORE INTO health_connect_sync_batches (session_id, batch_id, acknowledgement, processed_at)
      VALUES (?, ?, ?, ?);`,
    acknowledgement.sessionId,
    acknowledgement.batchId,
    json(acknowledgement),
    new Date().toISOString()
  );
}

/**
 * Collapses the per-category import outcome into the three numbers the phone needs to decide
 * whether a chunk landed. Only the data categories count - the import and source rows are
 * bookkeeping and would inflate `accepted` by two on every chunk.
 */
export function summarizeHealthConnectSyncCounts(outcome: ImportOutcome): HealthConnectSyncCounts {
  const categories = [outcome.observations, outcome.observationGroups, outcome.timeSeriesSamples, outcome.activitySessions];
  return {
    accepted: categories.reduce((total, category) => total + category.accepted, 0),
    duplicates: categories.reduce((total, category) => total + category.duplicates, 0),
    rejected: categories.reduce((total, category) => total + category.rejected, 0)
  };
}

async function processedBatchIds(connection: duckdb.Connection, sessionId: string): Promise<string[]> {
  const rows = await allWithParams(
    connection,
    "SELECT batch_id FROM health_connect_sync_batches WHERE session_id = ? ORDER BY processed_at, batch_id;",
    sessionId
  );
  return rows.map((row) => String(row.batch_id));
}
