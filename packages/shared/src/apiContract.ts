import { z } from "zod";
import type {
  AnalyticsSummary,
  AppBootstrap,
  BiologicalAgeReport,
  CareItem,
  CareItemMutationResponse,
  CloudAiConsent,
  DeleteCareItemResponse,
  DeleteHealthEventResponse,
  DeleteObservationResponse,
  DeleteObservationsByTypeResponse,
  HealthDataChartSeries,
  HealthDataDetail,
  HealthDataSummary,
  HealthEvent,
  HealthEventMutationResponse,
  Insight,
  Profile,
  ProfileListEntry,
  UpdateObservationResponse
} from "./types.js";
import type { BodyCompositionDraft, UploadImportDraft } from "./parsers.js";

export const apiErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string(),
  correlationId: z.string().optional()
}).passthrough();
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

export const healthResponseSchema = z.object({
  ok: z.boolean(),
  uptime: z.number().nonnegative()
}).strict();
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const aiQueryRequestSchema = z.object({
  question: z.string().min(3).max(500),
  timezone: z.string().max(80).optional(),
  debug: z.boolean().optional().default(false)
}).strict();
export type AiQueryRequest = z.input<typeof aiQueryRequestSchema>;

export const aiQueryChartSeriesSchema = z.object({
  label: z.string(),
  value: z.number()
}).strict();

export const aiQueryChartSchema = z.object({
  type: z.string(),
  series: z.array(aiQueryChartSeriesSchema)
}).strict();

export const aiQueryResponseSchema = z.object({
  question: z.string(),
  answer: z.string(),
  limitations: z.array(z.string()),
  assumptions: z.array(z.string()).default([]),
  confidence: z.number(),
  plan: z.unknown().nullable(),
  sql: z.string().nullable(),
  resolvedTimeRange: z.object({ start: z.string(), end: z.string(), label: z.string() }).strict().optional(),
  rowCount: z.number().int().nonnegative().optional(),
  rows: z.array(z.record(z.unknown())),
  chart: aiQueryChartSchema.nullable(),
  model: z.string().optional(),
  modelError: z.string().optional(),
  suggestedRephrase: z.string().optional(),
  debug: z.object({ plannerElapsedMs: z.number().optional(), summaryElapsedMs: z.number().optional() }).passthrough().optional()
}).passthrough();
export type AiQueryResponse = z.infer<typeof aiQueryResponseSchema>;

export const llmConfigResponseSchema = z.object({
  provider: z.enum(["ollama", "openai"]),
  endpoint: z.string(),
  model: z.string(),
  timeoutMs: z.number().int()
}).passthrough();
export type LlmConfigResponse = z.infer<typeof llmConfigResponseSchema>;

export const aiSettingsRequestSchema = z.object({
  provider: z.enum(["ollama", "openai"]),
  endpoint: z.string().url().max(2048),
  apiKey: z.string().max(2048).optional(),
  model: z.string().trim().min(1).max(120),
  timeoutMs: z.number().int().min(1000).max(180000).default(30000)
}).strict();
export type AiSettingsRequest = z.input<typeof aiSettingsRequestSchema>;

export const aiSettingsResponseSchema = llmConfigResponseSchema.extend({
  hasApiKey: z.boolean()
}).passthrough();
export type AiSettingsResponse = z.infer<typeof aiSettingsResponseSchema>;

export const modelValidationResponseSchema = z.object({
  ok: z.boolean(),
  provider: z.enum(["ollama", "openai"]),
  endpoint: z.string(),
  model: z.string(),
  timeoutMs: z.number().int(),
  elapsedMs: z.number(),
  text: z.string().optional(),
  status: z.number().int().optional(),
  error: z.string().optional(),
  bodySnippet: z.string().optional()
}).passthrough();
export type ModelValidationResponse = z.infer<typeof modelValidationResponseSchema>;

export const pendingPairingSchema = z.object({
  id: z.string(),
  deviceId: z.string(),
  deviceName: z.string(),
  requestedAt: z.string()
}).passthrough();
export type PendingPairing = z.infer<typeof pendingPairingSchema>;

export const pairedDeviceSchema = pendingPairingSchema.extend({
  resolvedAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  allowedProfileIds: z.tuple([z.string()])
}).passthrough();
export type PairedDevice = z.infer<typeof pairedDeviceSchema>;

export const pendingPairingsResponseSchema = z.array(pendingPairingSchema);
export const pairedDevicesResponseSchema = z.array(pairedDeviceSchema);

export const profileListEntrySchema: z.ZodType<ProfileListEntry> = z.object({
  id: z.string(),
  displayName: z.string(),
  updatedAt: z.string()
}).strict();

export const profilesResponseSchema = z.object({
  profiles: z.array(profileListEntrySchema),
  activeProfileId: z.string()
}).strict();
export type ProfilesResponse = z.infer<typeof profilesResponseSchema>;

export const assignedProfilesResponseSchema = z.object({
  profiles: z.array(z.object({
    id: z.string(),
    displayName: z.string()
  }).strict()).max(1)
}).strict();
export type AssignedProfilesResponse = z.infer<typeof assignedProfilesResponseSchema>;

export const profileIdResponseSchema = z.object({ profileId: z.string() }).strict();
export const profileDeleteResponseSchema = z.object({
  deletedProfileId: z.string(),
  activeProfileId: z.string(),
  profiles: z.array(profileListEntrySchema)
}).strict();
export const pairingMutationResponseSchema = z.object({ id: z.string(), status: z.string() }).strict();

export const importCategoryOutcomeSchema = z.object({
  attempted: z.number().int().nonnegative(),
  accepted: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  evicted: z.literal(0)
}).strict();

export const importMutationResponseSchema = z.object({
  import: z.object({
    id: z.string(),
    sourceKind: z.string(),
    fileName: z.string(),
    importedAt: z.string(),
    parserVersion: z.string(),
    checksum: z.string(),
    rowCount: z.number(),
    status: z.string(),
    diagnostics: z.array(z.string())
  }).passthrough(),
  outcome: z.object({
    sourceImport: importCategoryOutcomeSchema,
    dataSource: importCategoryOutcomeSchema,
    observations: importCategoryOutcomeSchema,
    observationGroups: importCategoryOutcomeSchema,
    timeSeriesSamples: importCategoryOutcomeSchema,
    activitySessions: importCategoryOutcomeSchema
  }).strict(),
  analyticsStorage: z.unknown().optional()
}).passthrough();
export type ImportMutationResponse = z.infer<typeof importMutationResponseSchema>;

function objectResponseSchema<T>(): z.ZodType<T> {
  return z.custom<T>((value) => typeof value === "object" && value !== null && !Array.isArray(value), {
    message: "Expected an API response object."
  });
}

export const appBootstrapResponseSchema = objectResponseSchema<AppBootstrap>();
export const analyticsSummaryResponseSchema = objectResponseSchema<AnalyticsSummary>();
export const biologicalAgeResponseSchema = objectResponseSchema<BiologicalAgeReport>();
export const healthDataSummaryResponseSchema = objectResponseSchema<HealthDataSummary>();
export const healthDataDetailResponseSchema = objectResponseSchema<HealthDataDetail>();
export const healthDataChartSeriesResponseSchema = objectResponseSchema<HealthDataChartSeries>();
export const profileResponseSchema = objectResponseSchema<Profile>();
export const cloudAiConsentResponseSchema = objectResponseSchema<CloudAiConsent>();
export const bodyCompositionDraftResponseSchema = objectResponseSchema<BodyCompositionDraft>();
export const uploadImportDraftResponseSchema = objectResponseSchema<UploadImportDraft>();
export const insightResponseSchema = objectResponseSchema<Insight>();
export const updateObservationResponseSchema = objectResponseSchema<UpdateObservationResponse>();
export const deleteObservationResponseSchema = objectResponseSchema<DeleteObservationResponse>();
export const deleteObservationsByTypeResponseSchema = objectResponseSchema<DeleteObservationsByTypeResponse>();

const isoTimestampSchema = z.string().datetime({ offset: true });
const optionalTrimmedString = (max: number) => z.string().trim().max(max).optional();

export const healthEventSchema: z.ZodType<HealthEvent> = z.discriminatedUnion("kind", [
  z.object({
    id: z.string(),
    kind: z.literal("immunization"),
    status: z.enum(["completed", "entered-in-error"]),
    occurredAt: isoTimestampSchema,
    occurredEnd: isoTimestampSchema.optional(),
    source: z.enum(["health-connect", "manual-entry", "blood-test-csv", "observation-csv", "structured-upload", "blood-test-report", "body-composition-report", "derived"]),
    provider: optionalTrimmedString(160),
    notes: optionalTrimmedString(4000),
    metadata: z.record(z.unknown()).optional(),
    immunization: z.object({
      vaccine: z.string(),
      targetDisease: z.string().optional(),
      doseNumber: z.number().int().positive().optional(),
      series: z.string().optional(),
      manufacturer: z.string().optional(),
      lotNumber: z.string().optional(),
      expiresAt: z.string().optional(),
      route: z.string().optional(),
      site: z.string().optional(),
      reaction: z.string().optional()
    }).strict().optional()
  }).strict(),
  z.object({
    id: z.string(),
    kind: z.literal("medication-administration"),
    status: z.enum(["completed", "entered-in-error"]),
    occurredAt: isoTimestampSchema,
    occurredEnd: isoTimestampSchema.optional(),
    source: z.enum(["health-connect", "manual-entry", "blood-test-csv", "observation-csv", "structured-upload", "blood-test-report", "body-composition-report", "derived"]),
    provider: optionalTrimmedString(160),
    notes: optionalTrimmedString(4000),
    metadata: z.record(z.unknown()).optional(),
    medicationAdministration: z.object({
      medication: z.string(),
      activeIngredient: z.string().optional(),
      dose: z.number(),
      unit: z.string(),
      route: z.string().optional()
    }).strict().optional()
  }).strict(),
  z.object({
    id: z.string(),
    kind: z.literal("other"),
    status: z.enum(["completed", "entered-in-error"]),
    occurredAt: isoTimestampSchema,
    occurredEnd: isoTimestampSchema.optional(),
    source: z.enum(["health-connect", "manual-entry", "blood-test-csv", "observation-csv", "structured-upload", "blood-test-report", "body-composition-report", "derived"]),
    provider: optionalTrimmedString(160),
    notes: optionalTrimmedString(4000),
    metadata: z.record(z.unknown()).optional()
  }).strict()
]);

export const careItemSchema: z.ZodType<CareItem> = z.object({
  id: z.string(),
  kind: z.string(),
  code: z.string().optional(),
  title: z.string(),
  dueStart: isoTimestampSchema.optional(),
  dueEnd: isoTimestampSchema.optional(),
  reminderAt: isoTimestampSchema.optional(),
  priority: z.enum(["low", "normal", "high"]),
  status: z.enum(["open", "completed", "cancelled", "skipped"]),
  scheduleProvenance: z.string().optional(),
  scheduleVersion: z.string().optional(),
  notes: z.string().optional(),
  originatingHealthEventId: z.string().optional(),
  completedHealthEventId: z.string().optional(),
  completedAt: isoTimestampSchema.optional()
}).strict();

const carePaginationSchema = z.object({
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  hasMore: z.boolean()
}).strict();

export const healthEventListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  search: optionalTrimmedString(120),
  kind: z.enum(["immunization", "medication-administration", "other"]).optional(),
  status: z.enum(["completed", "entered-in-error"]).optional(),
  occurredFrom: isoTimestampSchema.optional(),
  occurredTo: isoTimestampSchema.optional(),
  includeId: z.string().trim().min(1).max(160).optional()
}).strict().superRefine((value, context) => {
  if (value.occurredFrom && value.occurredTo && value.occurredFrom > value.occurredTo) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["occurredTo"], message: "Occurred end must be on or after occurred start." });
  }
});
export type HealthEventListQueryContract = z.infer<typeof healthEventListQuerySchema>;

export const careItemListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  search: optionalTrimmedString(120),
  status: z.enum(["open", "completed", "cancelled", "skipped"]).optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  dueFrom: isoTimestampSchema.optional(),
  dueTo: isoTimestampSchema.optional(),
  includeId: z.string().trim().min(1).max(160).optional()
}).strict().superRefine((value, context) => {
  if (value.dueFrom && value.dueTo && value.dueFrom > value.dueTo) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["dueTo"], message: "Due end must be on or after due start." });
  }
});
export type CareItemListQueryContract = z.infer<typeof careItemListQuerySchema>;

export const createHealthEventInputSchema = z.object({
  kind: z.enum(["immunization", "medication-administration", "other"]),
  status: z.enum(["completed", "entered-in-error"]),
  occurredAt: isoTimestampSchema,
  occurredEnd: isoTimestampSchema.optional(),
  provider: optionalTrimmedString(160),
  notes: optionalTrimmedString(4000)
}).strict().superRefine((value, context) => {
  if (value.occurredEnd && value.occurredAt > value.occurredEnd) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["occurredEnd"], message: "Occurred end must be on or after occurred start." });
  }
});
export const updateHealthEventInputSchema = createHealthEventInputSchema;

export const createCareItemInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  kind: z.string().trim().min(1).max(80),
  dueStart: isoTimestampSchema.optional(),
  dueEnd: isoTimestampSchema.optional(),
  reminderAt: isoTimestampSchema.optional(),
  priority: z.enum(["low", "normal", "high"]),
  status: z.enum(["open", "completed", "cancelled", "skipped"]),
  notes: optionalTrimmedString(4000),
  originatingHealthEventId: z.string().trim().min(1).max(160).optional(),
  completedHealthEventId: z.string().trim().min(1).max(160).optional()
}).strict().superRefine((value, context) => {
  if (value.dueStart && value.dueEnd && value.dueStart > value.dueEnd) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["dueEnd"], message: "Due end must be on or after due start." });
  }
  if (value.reminderAt && !(value.dueStart || value.dueEnd)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["reminderAt"], message: "A due time is required when setting a reminder." });
  }
  const upperDue = value.dueEnd ?? value.dueStart;
  if (value.reminderAt && upperDue && value.reminderAt > upperDue) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["reminderAt"], message: "Reminder must be on or before the due time." });
  }
  if (value.originatingHealthEventId && value.completedHealthEventId && value.originatingHealthEventId === value.completedHealthEventId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["completedHealthEventId"], message: "Originating and completion events must be different." });
  }
  if (value.status !== "completed" && value.completedHealthEventId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["completedHealthEventId"], message: "A completion event can be linked only when the care item is completed." });
  }
});
export const updateCareItemInputSchema = createCareItemInputSchema;

export const paginatedHealthEventsResponseSchema = z.object({
  items: z.array(healthEventSchema),
  ...carePaginationSchema.shape
}).strict();
export const paginatedCareItemsResponseSchema = z.object({
  items: z.array(careItemSchema),
  ...carePaginationSchema.shape
}).strict();
export const healthEventMutationResponseSchema = objectResponseSchema<HealthEventMutationResponse>();
export const careItemMutationResponseSchema = objectResponseSchema<CareItemMutationResponse>();
export const deleteHealthEventResponseSchema = objectResponseSchema<DeleteHealthEventResponse>();
export const deleteCareItemResponseSchema = objectResponseSchema<DeleteCareItemResponse>();
export const linkedHealthEventConflictSchema = apiErrorResponseSchema.extend({
  code: z.literal("CARE_HEALTH_EVENT_LINK_CONFLICT"),
  linkedCareItems: z.array(z.object({
    id: z.string(),
    title: z.string(),
    role: z.enum(["originating", "completion"])
  }).strict())
}).strict();
