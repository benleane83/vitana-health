import { z } from "zod";

export const COMPANION_REPLICA_PROTOCOL_VERSION = 1 as const;
export const replicaEntityTypes = [
  "profile",
  "measurement-type",
  "personal-reference-range",
  "source-import",
  "data-source",
  "device",
  "observation-group",
  "observation",
  "time-series-sample",
  "activity-session"
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

export interface ReplicaHandshake extends ReplicaIdentity {
  protocolVersion: typeof COMPANION_REPLICA_PROTOCOL_VERSION;
  highWaterMark: ReplicaHighWaterMark;
}

export interface ReplicaPage extends ReplicaIdentity {
  protocolVersion: typeof COMPANION_REPLICA_PROTOCOL_VERSION;
  kind: "snapshot" | "delta";
  changes: ReplicaChange[];
  highWaterMark: ReplicaHighWaterMark;
  nextCursor?: string;
  complete: boolean;
  cachedAt: string;
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

export const replicaChangeSchema: z.ZodType<ReplicaChange> = z.object({
  revision: z.number().int().nonnegative(),
  sequence: z.number().int().nonnegative(),
  entityType: z.enum(replicaEntityTypes),
  entityId: z.string().min(1).max(240),
  operation: z.enum(["upsert", "tombstone"]),
  payload: z.record(z.unknown()).optional()
}).strict().superRefine((change, context) => {
  if (change.operation === "upsert" && change.payload === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["payload"], message: "Upserts require a payload." });
  }
  if (change.operation === "tombstone" && change.payload !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["payload"], message: "Tombstones cannot include a payload." });
  }
});

export const replicaHandshakeSchema: z.ZodType<ReplicaHandshake> = z.object({
  protocolVersion: z.literal(COMPANION_REPLICA_PROTOCOL_VERSION),
  ...identityShape,
  highWaterMark: replicaHighWaterMarkSchema
}).strict();

export const replicaPageSchema: z.ZodType<ReplicaPage> = z.object({
  protocolVersion: z.literal(COMPANION_REPLICA_PROTOCOL_VERSION),
  ...identityShape,
  kind: z.enum(["snapshot", "delta"]),
  changes: z.array(replicaChangeSchema).max(500),
  highWaterMark: replicaHighWaterMarkSchema,
  nextCursor: z.string().min(1).max(500).optional(),
  complete: z.boolean(),
  cachedAt: z.string().datetime({ offset: true })
}).strict();

