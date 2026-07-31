import { z } from "zod";
import {
  activitySessionSchema,
  dataSourceSchema,
  deviceSchema,
  healthEventObjectSchema,
  measurementAggregateSchema,
  measurementTypeSchema,
  observationGroupSchema,
  observationSchema,
  personalReferenceRangeSchema,
  persistedCareItemSchema,
  pinnedMeasurementSchema,
  profileObjectSchema,
  sourceImportSchema,
  timeSeriesSampleSchema
} from "./storeSchema.js";

/**
 * Oldest and newest wire formats this build can speak. The phone and the PC each advertise their own
 * range and settle on the highest version both support, so a phone that updates ahead of the desktop
 * (or vice versa) keeps syncing instead of hard-failing on a version literal.
 */
export const COMPANION_REPLICA_MIN_PROTOCOL_VERSION = 3;
export const COMPANION_REPLICA_MAX_PROTOCOL_VERSION = 3;
/** The version used when the peer advertises no range at all. */
export const COMPANION_REPLICA_PROTOCOL_VERSION = 3 as const;
export const COMPANION_REPLICA_PAGE_SIZE = 1_000;

export const replicaEntityTypes = [
  "profile",
  "measurement-type",
  "personal-reference-range",
  "pinned-measurement",
  "source-import",
  "data-source",
  "device",
  "observation-group",
  "observation",
  "time-series-sample",
  "measurement-aggregate",
  "activity-session",
  "health-event",
  "care-item"
] as const;

export type ReplicaEntityType = typeof replicaEntityTypes[number];

export interface ReplicaIdentity {
  serverInstanceId: string;
  profileId: string;
  pairingId: string;
}

export interface ReplicaHighWaterMark {
  revision: number;
  sequence: number;
}

export interface ReplicaChange {
  revision: number;
  sequence: number;
  entityType: ReplicaEntityType;
  entityId: string;
  operation: "upsert" | "tombstone";
  payload?: Record<string, unknown>;
}

export interface ReplicaProtocolRange {
  minProtocolVersion: number;
  maxProtocolVersion: number;
}

export interface ReplicaHandshake extends ReplicaIdentity, ReplicaProtocolRange {
  protocolVersion: number;
  highWaterMark: ReplicaHighWaterMark;
}

export interface ReplicaPage extends ReplicaIdentity {
  protocolVersion: number;
  kind: "snapshot" | "delta";
  changes: ReplicaChange[];
  highWaterMark: ReplicaHighWaterMark;
  nextCursor?: string;
  complete: boolean;
  cachedAt: string;
}

/**
 * Highest version both peers can speak, or `undefined` when the ranges do not overlap at all — the
 * caller turns that into a 409 rather than guessing.
 */
export function negotiateReplicaProtocolVersion(
  client: ReplicaProtocolRange,
  server: ReplicaProtocolRange = {
    minProtocolVersion: COMPANION_REPLICA_MIN_PROTOCOL_VERSION,
    maxProtocolVersion: COMPANION_REPLICA_MAX_PROTOCOL_VERSION
  }
): number | undefined {
  const version = Math.min(client.maxProtocolVersion, server.maxProtocolVersion);
  if (version < client.minProtocolVersion || version < server.minProtocolVersion) {
    return undefined;
  }
  return version;
}


const identityShape = {
  serverInstanceId: z.string().uuid(),
  profileId: z.string().min(1).max(160),
  pairingId: z.string().min(1).max(160)
};

export const replicaHighWaterMarkSchema = z.object({
  revision: z.number().int().nonnegative(),
  sequence: z.number().int().nonnegative()
}).strict();

/**
 * Per-entity payload shapes. Every schema is `.passthrough()` on purpose: a newer peer may add
 * fields we do not know about yet, and dropping the whole change would be worse than carrying the
 * extra keys through. What we do enforce is that the fields we *do* rely on are present and typed.
 */
const replicaPayloadSchemas: Record<ReplicaEntityType, z.ZodTypeAny> = {
  "profile": profileObjectSchema.passthrough(),
  "measurement-type": measurementTypeSchema.passthrough(),
  // Carries a cross-field refinement, so it cannot be relaxed to passthrough.
  "personal-reference-range": personalReferenceRangeSchema,
  "pinned-measurement": pinnedMeasurementSchema.passthrough(),
  "source-import": sourceImportSchema.passthrough(),
  "data-source": dataSourceSchema.passthrough(),
  "device": deviceSchema.passthrough(),
  "observation-group": observationGroupSchema.passthrough(),
  "observation": observationSchema.passthrough(),
  "time-series-sample": timeSeriesSampleSchema.passthrough(),
  "measurement-aggregate": measurementAggregateSchema.passthrough(),
  "activity-session": activitySessionSchema.passthrough(),
  "health-event": healthEventObjectSchema.passthrough(),
  "care-item": persistedCareItemSchema.passthrough()
};

export const replicaChangeSchema: z.ZodType<ReplicaChange> = z.object({
  revision: z.number().int().nonnegative(),
  sequence: z.number().int().nonnegative(),
  entityType: z.enum(replicaEntityTypes),
  entityId: z.string().min(1).max(240),
  operation: z.enum(["upsert", "tombstone"]),
  payload: z.record(z.unknown()).optional()
}).strict().superRefine((change, context) => {
  if (change.operation === "tombstone") {
    if (change.payload !== undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["payload"], message: "Tombstones cannot include a payload." });
    }
    return;
  }
  if (change.payload === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["payload"], message: "Upserts require a payload." });
    return;
  }
  const parsed = replicaPayloadSchemas[change.entityType].safeParse(change.payload);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload", ...issue.path],
        message: issue.message
      });
    }
  }
});

const protocolRangeShape = {
  minProtocolVersion: z.number().int().positive(),
  maxProtocolVersion: z.number().int().positive()
};

export const replicaProtocolRangeSchema = z.object(protocolRangeShape).strict().refine(
  (range) => range.minProtocolVersion <= range.maxProtocolVersion,
  { message: "minProtocolVersion cannot exceed maxProtocolVersion." }
);

const negotiatedVersion = z
  .number()
  .int()
  .min(COMPANION_REPLICA_MIN_PROTOCOL_VERSION)
  .max(COMPANION_REPLICA_MAX_PROTOCOL_VERSION);

export const replicaHandshakeSchema: z.ZodType<ReplicaHandshake> = z.object({
  protocolVersion: negotiatedVersion,
  ...protocolRangeShape,
  ...identityShape,
  highWaterMark: replicaHighWaterMarkSchema
}).strict();

export const replicaPageSchema: z.ZodType<ReplicaPage> = z.object({
  protocolVersion: negotiatedVersion,
  ...identityShape,
  kind: z.enum(["snapshot", "delta"]),
  changes: z.array(replicaChangeSchema).max(COMPANION_REPLICA_PAGE_SIZE),
  highWaterMark: replicaHighWaterMarkSchema,
  nextCursor: z.string().min(1).max(500).optional(),
  complete: z.boolean(),
  cachedAt: z.string().datetime({ offset: true })
}).strict();


