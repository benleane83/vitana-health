import { z } from "zod";
import { healthConnectImportRequestSchema } from "./healthConnectImport.js";

/**
 * Wire protocol for the phone -> PC Health Connect sync. Unlike the one-shot import endpoint it
 * replaces, this protocol is session-oriented: the phone declares a session, uploads chunks that
 * are individually acknowledged, and can resume by replaying only the batch ids the PC has not
 * already recorded.
 *
 * Version negotiation is in place from the first release so a newer phone talking to an older PC
 * (or the reverse) fails with a clear message instead of a schema error deep inside a parse.
 */
export const HEALTH_CONNECT_SYNC_PROTOCOL_VERSION = 1 as const;
export const MIN_HEALTH_CONNECT_SYNC_PROTOCOL_VERSION = 1;
export const MAX_HEALTH_CONNECT_SYNC_PROTOCOL_VERSION = 1;

export class HealthConnectSyncProtocolError extends Error {
  constructor(
    readonly requestedVersion: number,
    message: string
  ) {
    super(message);
    this.name = "HealthConnectSyncProtocolError";
  }
}

export function isSupportedHealthConnectSyncProtocolVersion(version: number): boolean {
  return (
    Number.isInteger(version) &&
    version >= MIN_HEALTH_CONNECT_SYNC_PROTOCOL_VERSION &&
    version <= MAX_HEALTH_CONNECT_SYNC_PROTOCOL_VERSION
  );
}

/**
 * Returns the version both sides should speak, or throws with a message that names which side is
 * behind so the phone can show something actionable rather than "sync failed".
 */
export function negotiateHealthConnectSyncProtocolVersion(requestedVersion: number): number {
  if (!isSupportedHealthConnectSyncProtocolVersion(requestedVersion)) {
    throw new HealthConnectSyncProtocolError(
      requestedVersion,
      requestedVersion > MAX_HEALTH_CONNECT_SYNC_PROTOCOL_VERSION
        ? "This phone uses a newer sync protocol than the paired PC. Update the PC app, then sync again."
        : "This phone uses a sync protocol the paired PC no longer supports. Update the phone app, then sync again."
    );
  }
  return requestedVersion;
}

const protocolVersionField = z.number().int().positive();

export const healthConnectSyncSessionRequestSchema = z.object({
  protocolVersion: protocolVersionField,
  /**
   * Stable identity for one logical sync attempt, minted by the phone from the device id and the
   * requested window. Restarting an interrupted sync reuses it and gets the same session back.
   */
  sessionKey: z.string().min(1).max(200),
  deviceLabel: z.string().min(1).max(120),
  rangeStart: z.string().datetime({ offset: true }),
  rangeEnd: z.string().datetime({ offset: true }),
  profileId: z.string().trim().toLowerCase().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]{0,63}$/).optional()
}).strict();

export const healthConnectSyncSessionResponseSchema = z.object({
  protocolVersion: z.literal(HEALTH_CONNECT_SYNC_PROTOCOL_VERSION),
  sessionId: z.string().min(1),
  /** Batch ids already durably applied. The phone skips these instead of re-uploading them. */
  processedBatchIds: z.array(z.string())
}).strict();

export const healthConnectSyncChunkRequestSchema = healthConnectImportRequestSchema.extend({
  protocolVersion: protocolVersionField,
  sessionId: z.string().min(1),
  batchId: z.string().min(1).max(160)
});

export const healthConnectSyncCountsSchema = z.object({
  accepted: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative()
}).strict();

export const healthConnectSyncBatchAcknowledgementSchema = z.object({
  protocolVersion: z.literal(HEALTH_CONNECT_SYNC_PROTOCOL_VERSION),
  sessionId: z.string().min(1),
  batchId: z.string().min(1),
  counts: healthConnectSyncCountsSchema
}).strict();

export type HealthConnectSyncSessionRequest = z.infer<typeof healthConnectSyncSessionRequestSchema>;
export type HealthConnectSyncSessionResponse = z.infer<typeof healthConnectSyncSessionResponseSchema>;
export type HealthConnectSyncChunkRequest = z.infer<typeof healthConnectSyncChunkRequestSchema>;
export type HealthConnectSyncCounts = z.infer<typeof healthConnectSyncCountsSchema>;
export type HealthConnectSyncBatchAcknowledgement = z.infer<typeof healthConnectSyncBatchAcknowledgementSchema>;
