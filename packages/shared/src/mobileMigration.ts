import { z } from "zod";
export const MOBILE_MIGRATION_PROTOCOL_VERSION = 1 as const;

const sourceKindSchema = z.enum([
  "health-connect", "manual-entry", "blood-test-csv", "observation-csv", "structured-upload",
  "blood-test-report", "body-composition-report", "derived"
]);
const sourceImportSchema = z.object({
  id: z.string(), sourceKind: sourceKindSchema, fileName: z.string(), importedAt: z.string(),
  parserVersion: z.string(), checksum: z.string(), rowCount: z.number(),
  status: z.enum(["processed", "needs-review", "failed"]), diagnostics: z.array(z.string())
}).strict();
const dataSourceSchema = z.object({
  id: z.string(), sourceKind: sourceKindSchema, label: z.string(), importId: z.string().optional(), createdAt: z.string()
}).strict();
const observationGroupSchema = z.object({
  id: z.string(), kind: z.enum(["lab_panel", "body_composition_report", "activity_session", "sleep_session", "import_batch", "custom"]),
  label: z.string(), sourceId: z.string().optional(), importId: z.string().optional(), startAt: z.string().optional(),
  endAt: z.string().optional(), collectedAt: z.string().optional(), metadata: z.record(z.unknown()).optional()
}).strict();
const observationSchema = z.object({
  id: z.string(), measurementCode: z.string(), observedAt: z.string(), effectiveStart: z.string().optional(),
  effectiveEnd: z.string().optional(), value: z.number(), unit: z.string(), sourceId: z.string(),
  observationGroupId: z.string().optional(), deviceId: z.string().optional(), note: z.string().optional(),
  sourceJson: z.unknown().optional()
}).strict();

export const mobileMigrationCountsSchema = z.object({
  sourceImports: z.number().int().nonnegative(),
  dataSources: z.number().int().nonnegative(),
  observationGroups: z.number().int().nonnegative(),
  observations: z.number().int().nonnegative()
}).strict();

export const mobileMigrationManifestSchema = z.object({
  protocolVersion: z.literal(MOBILE_MIGRATION_PROTOCOL_VERSION),
  datasetId: z.string().min(1),
  datasetFingerprint: z.string().min(1),
  sourceProfileId: z.string().min(1),
  counts: mobileMigrationCountsSchema
}).strict();

export const mobileMigrationStartRequestSchema = z.object({
  manifest: mobileMigrationManifestSchema
}).strict();

export const mobileMigrationStartResponseSchema = z.object({
  sessionId: z.string().min(1),
  destinationProfileId: z.string().min(1),
  processedBatchIds: z.array(z.string()),
  completed: z.boolean()
}).strict();

export const mobileMigrationBatchSchema = z.object({
  protocolVersion: z.literal(MOBILE_MIGRATION_PROTOCOL_VERSION),
  sessionId: z.string().min(1),
  batchId: z.string().min(1),
  sourceImports: z.array(sourceImportSchema),
  dataSources: z.array(dataSourceSchema),
  observationGroups: z.array(observationGroupSchema),
  observations: z.array(observationSchema)
}).strict();

export const mobileMigrationEntityCountsSchema = z.object({
  accepted: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  conflicts: z.number().int().nonnegative()
}).strict();

export const mobileMigrationConflictSchema = z.object({
  entityType: z.enum(["sourceImport", "dataSource", "observationGroup", "observation"]),
  entityId: z.string(),
  reason: z.string()
}).strict();

export const mobileMigrationDuplicateSchema = z.object({
  entityType: z.enum(["sourceImport", "dataSource", "observationGroup", "observation"]),
  entityId: z.string(),
  classification: z.enum(["exact-id", "source-import-identity", "canonical-observation"])
}).strict();

export const mobileMigrationBatchAcknowledgementSchema = z.object({
  sessionId: z.string(),
  batchId: z.string(),
  counts: mobileMigrationEntityCountsSchema,
  duplicates: z.array(mobileMigrationDuplicateSchema),
  conflicts: z.array(mobileMigrationConflictSchema)
}).strict().superRefine((value, context) => {
  if (value.duplicates.length !== value.counts.duplicates) {
    context.addIssue({ code: "custom", path: ["duplicates"], message: "Duplicate details must match the duplicate count." });
  }
  if (value.conflicts.length !== value.counts.conflicts) {
    context.addIssue({ code: "custom", path: ["conflicts"], message: "Conflict details must match the conflict count." });
  }
});

export const mobileMigrationCompletionRequestSchema = z.object({
  protocolVersion: z.literal(MOBILE_MIGRATION_PROTOCOL_VERSION),
  sessionId: z.string().min(1)
}).strict();

export const mobileMigrationReceiptSchema = z.object({
  receiptId: z.string().min(1),
  sessionId: z.string().min(1),
  pairingId: z.string().min(1),
  destinationProfileId: z.string().min(1),
  datasetFingerprint: z.string().min(1),
  completedAt: z.string(),
  counts: mobileMigrationEntityCountsSchema
}).strict();

export type MobileMigrationCounts = z.infer<typeof mobileMigrationCountsSchema>;
export type MobileMigrationManifest = z.infer<typeof mobileMigrationManifestSchema>;
export type MobileMigrationStartRequest = z.infer<typeof mobileMigrationStartRequestSchema>;
export type MobileMigrationStartResponse = z.infer<typeof mobileMigrationStartResponseSchema>;
export type MobileMigrationBatch = z.infer<typeof mobileMigrationBatchSchema>;
export type MobileMigrationConflict = z.infer<typeof mobileMigrationConflictSchema>;
export type MobileMigrationDuplicate = z.infer<typeof mobileMigrationDuplicateSchema>;
export type MobileMigrationBatchAcknowledgement = z.infer<typeof mobileMigrationBatchAcknowledgementSchema>;
export type MobileMigrationCompletionRequest = z.infer<typeof mobileMigrationCompletionRequestSchema>;
export type MobileMigrationReceipt = z.infer<typeof mobileMigrationReceiptSchema>;
