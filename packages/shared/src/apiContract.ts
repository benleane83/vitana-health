import { z } from "zod";
import { careItemKindCodes, generalHealthEventKindCodes, healthEventKindCodes } from "./types.js";
import {
  activitySessionSchema,
  insightSchema,
  measurementTypeSchema,
  observationGroupKindSchema,
  observationSchema,
  profileSchema,
  referenceRangeSchema,
  sourceKindSchema
} from "./storeSchema.js";
import type {
  AnalyticsSummary,
  AppBootstrap,
  BiologicalAgeReport,
  CalendarMonthData,
  CareItem,
  CareItemMutationResponse,
  CompleteCareItemResponse,
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
  HealthEventReference,
  Insight,
  MeasurementPinState,
  Profile,
  ProfilePhotoResponse,
  ProfileListEntry,
  ReferenceRangeState,
  UpdateObservationResponse
} from "./types.js";
import type { BloodTestDraft, BodyCompositionDraft, UploadImportDraft } from "./parsers.js";

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

export const aiQueryContextFiltersSchema = z.object({
  kind: z.string().trim().min(1).max(80).optional(),
  status: z.enum(["completed", "entered-in-error", "open", "cancelled", "skipped"]).optional(),
  source: z.enum([
    "health-connect",
    "manual-entry",
    "blood-test-csv",
    "observation-csv",
    "structured-upload",
    "blood-test-report",
    "body-composition-report",
    "derived"
  ]).optional(),
  provider: z.string().trim().min(1).max(120).optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  code: z.string().trim().min(1).max(80).optional(),
  completion: z.enum(["completed", "incomplete"]).optional(),
  dueWithinRange: z.boolean().optional()
}).strict();

export const aiQueryTurnContextSchema = z.object({
  version: z.literal(1),
  profileId: z.string().trim().min(1).max(120),
  source: z.enum(["metrics", "activities", "health_events", "care_items"]),
  metric: z.string().trim().min(1).max(80).nullable(),
  intent: z.enum(["timeseries", "aggregation", "top_n", "latest", "list_activities", "list", "count", "overdue"]),
  aggregation: z.enum(["avg", "max", "min", "sum", "count", "latest"]),
  groupBy: z.enum(["day", "week", "month", "kind", "status", "source", "priority", "due_bucket"]).nullable(),
  sort: z.enum(["asc", "desc"]),
  filters: aiQueryContextFiltersSchema.optional(),
  resolvedTimeRange: z.object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  }).strict()
}).strict();
export type AiQueryTurnContext = z.infer<typeof aiQueryTurnContextSchema>;

export const aiQueryRequestSchema = z.object({
  question: z.string().min(3).max(500),
  timezone: z.string().max(80).optional(),
  debug: z.boolean().optional().default(false),
  context: aiQueryTurnContextSchema.optional()
}).strict();
export type AiQueryRequest = z.input<typeof aiQueryRequestSchema>;

export const aiQueryErrorCodeSchema = z.enum([
  "QUERY_NOT_UNDERSTOOD",
  "QUERY_UNSUPPORTED",
  "MODEL_UNAVAILABLE",
  "MODEL_TIMEOUT",
  "QUERY_EXECUTION_FAILED"
]);
export type AiQueryErrorCode = z.infer<typeof aiQueryErrorCodeSchema>;

export const aiQueryDiagnosticsSchema = z.object({
  plannerElapsedMs: z.number().nonnegative().optional(),
  summaryElapsedMs: z.number().nonnegative().optional(),
  attempts: z.number().int().min(1).max(2).optional(),
  repaired: z.boolean().optional(),
  firstFailureCategory: z.enum(["model", "json", "schema", "semantic", "compile"]).optional(),
  failureCategory: z.enum(["model", "json", "schema", "semantic", "compile", "sql_safety", "execution"]).optional(),
  structuredOutputMode: z.enum(["not_requested", "enforced", "fallback"]).optional(),
  issues: z.array(z.string()).max(10).optional()
}).strict();

export const aiQueryErrorResponseSchema = apiErrorResponseSchema.extend({
  code: aiQueryErrorCodeSchema,
  suggestions: z.array(z.string()).default([]),
  suggestedRephrase: z.string().optional(),
  diagnostics: aiQueryDiagnosticsSchema.optional()
}).passthrough();
export type AiQueryErrorResponse = z.infer<typeof aiQueryErrorResponseSchema>;

export const aiQueryChartSeriesSchema = z.object({
  label: z.string(),
  value: z.number()
}).strict();

export const aiQueryChartSchema = z.object({
  type: z.string(),
  series: z.array(aiQueryChartSeriesSchema)
}).strict();

export const aiQueryResponseSchema = z.object({
  outcome: z.enum(["answered", "no_data"]).default("answered"),
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
  context: aiQueryTurnContextSchema.optional(),
  suggestedFollowUps: z.array(z.string().trim().min(3).max(120)).max(3).default([]),
  debug: aiQueryDiagnosticsSchema.optional()
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

export const desktopRuntimeSettingsResponseSchema = z.object({
  supported: z.boolean(),
  backgroundServiceEnabled: z.boolean()
}).strict();
export type DesktopRuntimeSettingsResponse = z.infer<typeof desktopRuntimeSettingsResponseSchema>;

export const desktopRuntimeSettingsUpdateSchema = z.object({
  backgroundServiceEnabled: z.boolean()
}).strict();
export type DesktopRuntimeSettingsUpdate = z.infer<typeof desktopRuntimeSettingsUpdateSchema>;

export const measurementRegistryResetResponseSchema = z.object({
  profileId: z.string(),
  refreshed: z.number().int().nonnegative(),
  inserted: z.number().int().nonnegative()
}).strict();
export type MeasurementRegistryResetResponse = z.infer<typeof measurementRegistryResetResponseSchema>;

export const desktopUpdateStateSchema = z.object({
  status: z.enum(["unsupported", "managed", "idle", "checking", "available", "downloading", "downloaded", "up-to-date", "error"]),
  currentVersion: z.string(),
  channel: z.literal("production").nullable(),
  distributionChannel: z.enum(["github", "store"]),
  availableVersion: z.string().optional(),
  lastCheckedAt: z.string().datetime({ offset: true }).optional(),
  progress: z.object({
    percent: z.number().min(0).max(100),
    transferred: z.number().nonnegative(),
    total: z.number().nonnegative()
  }).strict().optional(),
  error: z.string().optional()
}).strict();
export type DesktopUpdateState = z.infer<typeof desktopUpdateStateSchema>;

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
  bodySnippet: z.string().optional(),
  compatibility: z.enum(["compatible", "limited"]).optional(),
  plannerProbe: z.object({
    passed: z.number().int().nonnegative(),
    total: z.number().int().positive(),
    elapsedMs: z.number().nonnegative(),
    structuredOutputMode: z.enum(["not_requested", "enforced", "fallback"]),
    repairedCases: z.number().int().nonnegative(),
    failureCategory: z.enum(["model", "json", "schema", "semantic", "compile"]).optional(),
    issues: z.array(z.string())
  }).strict().optional()
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
  updatedAt: z.string(),
  profilePhoto: z.object({
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    updatedAt: z.string().datetime({ offset: true })
  }).strict().optional()
}).strict();

export const profilePhotoResponseSchema: z.ZodType<ProfilePhotoResponse> = z.object({
  contentType: z.literal("image/jpeg"),
  contentBase64: z.string().min(4).max(350_000).regex(
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
    "Expected canonical base64."
  ),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  updatedAt: z.string().datetime({ offset: true })
}).strict();
export const profilePhotoUploadSchema = z.object({
  contentType: z.literal("image/jpeg"),
  contentBase64: z.string().min(4).max(350_000)
}).strict();
export const profilePhotoDeleteResponseSchema = z.object({ deleted: z.literal(true) }).strict();

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
export const pairingRequestResponseSchema = z.object({
  pairingId: z.string(),
  status: z.string(),
  pollingSecret: z.string()
}).strict();
/** The token is only present on the single poll that first observes an approval. */
export const pairingStatusResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
  token: z.string().optional()
}).strict();

export const importCategoryOutcomeSchema = z.object({
  attempted: z.number().int().nonnegative(),
  accepted: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  /** Rows dropped because their unit could not be reconciled with the measurement registry. */
  rejected: z.number().int().nonnegative()
}).strict();
export type ImportCategoryOutcome = z.infer<typeof importCategoryOutcomeSchema>;

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
    measurementAggregates: importCategoryOutcomeSchema,
    activitySessions: importCategoryOutcomeSchema
  }).strict(),
  analyticsStorage: z.unknown().optional()
}).passthrough();
export type ImportMutationResponse = z.infer<typeof importMutationResponseSchema>;

const isoTimestampSchema = z.string().datetime({ offset: true });
const optionalTrimmedString = (max: number) => z.string().trim().max(max).optional();

export const personalReferenceRangeInputSchema = z.object({
  low: z.number().finite().optional(),
  high: z.number().finite().optional(),
  unit: z.string().trim().min(1).max(80)
}).strict().superRefine((range, context) => {
  if (range.low === undefined && range.high === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a lower bound, an upper bound, or both." });
  }
  if (range.low !== undefined && range.high !== undefined && range.low > range.high) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["high"], message: "Upper bound must be greater than or equal to lower bound." });
  }
});
export type PersonalReferenceRangeInput = z.infer<typeof personalReferenceRangeInputSchema>;

const immunizationDetailsSchema = z.object({
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
}).strict();

const medicationAdministrationDetailsSchema = z.object({
  medication: z.string(),
  activeIngredient: z.string().optional(),
  dose: z.number(),
  unit: z.string(),
  route: z.string().optional()
}).strict();

const healthEventBaseShape = {
  id: z.string(),
  status: z.enum(["completed", "entered-in-error"]),
  occurredAt: isoTimestampSchema,
  source: sourceKindSchema,
  provider: optionalTrimmedString(160),
  notes: optionalTrimmedString(4000),
  metadata: z.record(z.unknown()).optional()
};

/**
 * A discriminated union rather than one flat object with cross-field refinements: it makes the
 * "only immunizations carry immunization details" rule structural, so the schema output really is
 * a `HealthEvent` and no `as` cast is needed to claim it.
 */
export const healthEventSchema: z.ZodType<HealthEvent> = z.discriminatedUnion("kind", [
  z.object({
    ...healthEventBaseShape,
    kind: z.literal("immunization"),
    immunization: immunizationDetailsSchema.optional()
  }).strict(),
  z.object({
    ...healthEventBaseShape,
    kind: z.literal("medication"),
    medicationAdministration: medicationAdministrationDetailsSchema.optional()
  }).strict(),
  z.object({
    ...healthEventBaseShape,
    kind: z.enum(generalHealthEventKindCodes)
  }).strict()
]);

export const healthEventReferenceSchema: z.ZodType<HealthEventReference> = z.object({
  id: z.string(),
  kind: z.enum(healthEventKindCodes),
  occurredAt: isoTimestampSchema,
  provider: z.string().optional()
}).strict();

export const careItemSchema: z.ZodType<CareItem> = z.object({
  id: z.string(),
  kind: z.enum(careItemKindCodes),
  code: z.string().optional(),
  title: z.string(),
  dueStart: isoTimestampSchema.optional(),
  reminderAt: isoTimestampSchema.optional(),
  priority: z.enum(["low", "normal", "high"]),
  status: z.enum(["open", "completed", "cancelled", "skipped"]),
  scheduleProvenance: z.string().optional(),
  scheduleVersion: z.string().optional(),
  notes: z.string().optional(),
  completedHealthEventId: z.string().optional(),
  completedAt: isoTimestampSchema.optional(),
  completedHealthEvent: healthEventReferenceSchema.optional()
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
  kind: z.enum(healthEventKindCodes).optional(),
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
/** Caller-facing form: every filter is optional, and the server applies the paging defaults. */
export type HealthEventListQuery = Partial<HealthEventListQueryContract>;

const calendarMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must use YYYY-MM.");
const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const calendarMeasurementCodeSchema = z.string().trim().min(1).max(120)
  .regex(/^[A-Za-z0-9_-]+$/, "Measurement code contains unsupported characters.");

function isIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export const calendarMonthQuerySchema = z.object({
  month: calendarMonthSchema,
  timezone: z.string().trim().min(1).max(80).refine(isIanaTimezone, "Timezone must be a valid IANA timezone."),
  measurementCodes: z.preprocess(
    (value) => typeof value === "string" ? value.split(",").filter(Boolean) : value,
    z.array(calendarMeasurementCodeSchema).min(1).max(3)
  )
}).strict().superRefine((value, context) => {
  if (new Set(value.measurementCodes).size !== value.measurementCodes.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["measurementCodes"],
      message: "Measurement codes must be unique."
    });
  }
});

export const calendarMonthResponseSchema: z.ZodType<CalendarMonthData> = z.object({
  month: calendarMonthSchema,
  timezone: z.string().min(1).max(80),
  measurements: z.array(z.object({
    date: calendarDateSchema,
    measurementCode: calendarMeasurementCodeSchema,
    value: z.number().finite(),
    unit: z.string().min(1).max(40),
    count: z.number().int().positive(),
    min: z.number().finite(),
    max: z.number().finite(),
    aggregation: z.enum(["sum", "average", "min", "max", "latest", "none"]),
    sources: z.array(z.string().min(1).max(160))
  }).strict()),
  events: z.array(z.object({
    date: calendarDateSchema,
    count: z.number().int().positive(),
    kinds: z.array(z.enum(healthEventKindCodes))
  }).strict())
}).strict();

export const careItemListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  search: optionalTrimmedString(120),
  kind: z.enum(careItemKindCodes).optional(),
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
/** Caller-facing form: every filter is optional, and the server applies the paging defaults. */
export type CareItemListQuery = Partial<CareItemListQueryContract>;

export const createHealthEventInputSchema = z.object({
  kind: z.enum(healthEventKindCodes),
  status: z.enum(["completed", "entered-in-error"]),
  occurredAt: isoTimestampSchema,
  provider: optionalTrimmedString(160),
  notes: optionalTrimmedString(4000)
}).strict();
export const updateHealthEventInputSchema = createHealthEventInputSchema;
export type CreateHealthEventInput = z.infer<typeof createHealthEventInputSchema>;
export type UpdateHealthEventInput = CreateHealthEventInput;

export const createCareItemInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  kind: z.enum(careItemKindCodes),
  dueStart: isoTimestampSchema.optional(),
  reminderAt: isoTimestampSchema.optional(),
  priority: z.enum(["low", "normal", "high"]),
  status: z.enum(["open", "completed", "cancelled", "skipped"]),
  notes: optionalTrimmedString(4000)
}).strict();
export const updateCareItemInputSchema = createCareItemInputSchema;
export type CreateCareItemInput = z.infer<typeof createCareItemInputSchema>;
export type UpdateCareItemInput = CreateCareItemInput;

export const completeCareItemInputSchema = z.object({
  occurredAt: isoTimestampSchema,
  kind: z.enum(healthEventKindCodes).optional()
}).strict();
export type CompleteCareItemInput = z.infer<typeof completeCareItemInputSchema>;

export const updateObservationInputSchema = z.object({
  measurementCode: z.string().trim().min(1).max(120),
  observedAt: isoTimestampSchema,
  value: z.number().finite(),
  unit: z.string().trim().min(1).max(40),
  note: z.string().trim().max(1000).optional()
}).strict();
export type UpdateObservationInput = z.infer<typeof updateObservationInputSchema>;

export const paginatedHealthEventsResponseSchema = z.object({
  items: z.array(healthEventSchema),
  ...carePaginationSchema.shape
}).strict();
export const paginatedCareItemsResponseSchema = z.object({
  items: z.array(careItemSchema),
  ...carePaginationSchema.shape
}).strict();

// ─── Response schemas ────────────────────────────────────────────────────────
//
// Every response the clients parse has a real schema here. They are `.strict()` on purpose: a
// field the server renames or drops must fail loudly at the boundary rather than arrive as
// `undefined` somewhere deep in a chart.

const nonNegativeInt = z.number().int().nonnegative();

const entityCountsSchema = z.object({
  imports: nonNegativeInt,
  observations: nonNegativeInt,
  samples: nonNegativeInt,
  activities: nonNegativeInt,
  healthEvents: nonNegativeInt,
  careItems: nonNegativeInt
}).strict();

const measurementCategorySchema = z.enum([
  "activity", "cardio", "sleep", "body", "lab", "derived", "uncategorized"
]);
const measurementAggregationSchema = z.enum(["sum", "average", "min", "max", "latest", "none"]);
const measurementStatusSchema = z.enum(["low", "normal", "high", "unknown"]);
const trendDirectionSchema = z.enum(["up", "down", "flat", "unknown"]);

const profilePhotoMetadataSchema = z.object({
  revision: z.string(),
  updatedAt: z.string()
}).strict();

const manualObservationGroupTemplateSchema = z.object({
  label: z.string(),
  normalizedLabel: z.string(),
  measurements: z.array(z.object({
    measurementCode: z.string(),
    marker: z.string(),
    unit: z.string()
  }).strict())
}).strict();

export const appBootstrapResponseSchema: z.ZodType<AppBootstrap, z.ZodTypeDef, unknown> = z.object({
  profile: profileSchema,
  profilePhoto: profilePhotoMetadataSchema.optional(),
  measurementTypes: z.array(measurementTypeSchema),
  manualObservationGroupTemplates: z.array(manualObservationGroupTemplateSchema),
  latestInsight: insightSchema.optional(),
  counts: entityCountsSchema
}).strict();

const latestMetricSchema = z.object({
  code: z.string(),
  label: z.string(),
  value: z.number(),
  unit: z.string(),
  observedAt: z.string(),
  status: measurementStatusSchema,
  isPinned: z.boolean()
}).strict();

export const analyticsSummaryResponseSchema: z.ZodType<AnalyticsSummary, z.ZodTypeDef, unknown> = z.object({
  counts: entityCountsSchema.extend({ insights: nonNegativeInt }),
  latestMetrics: z.array(latestMetricSchema),
  latestMetricsForInsight: z.array(latestMetricSchema).optional(),
  trendCards: z.array(z.object({
    code: z.string(),
    label: z.string(),
    unit: z.string(),
    points: z.array(z.object({ date: z.string(), value: z.number() }).strict()),
    direction: trendDirectionSchema,
    summary: z.string()
  }).strict()),
  labAlerts: z.array(z.object({
    code: z.string(),
    marker: z.string(),
    value: z.number(),
    unit: z.string(),
    observedAt: z.string(),
    reference: z.string().optional(),
    flag: z.enum(["low", "high", "critical", "unknown"])
  }).strict()),
  evidenceDigest: z.array(z.string())
}).strict();

export const biologicalAgeResponseSchema: z.ZodType<BiologicalAgeReport> = z.object({
  generatedAt: z.string(),
  disclaimer: z.string(),
  models: z.array(z.object({
    id: z.literal("phenoage-levine-2018"),
    name: z.string(),
    version: z.string(),
    status: z.enum(["available", "incomplete", "not-implemented"]),
    methodology: z.string(),
    citation: z.string(),
    chronologicalAge: z.number().optional(),
    chronologicalAgeDetail: z.string().optional(),
    biologicalAge: z.number().optional(),
    ageAcceleration: z.number().optional(),
    calculatedAt: z.string().optional(),
    panelCollectedAt: z.string().optional(),
    inputs: z.array(z.object({
      code: z.string(),
      label: z.string(),
      value: z.number().optional(),
      unit: z.string().optional(),
      normalizedValue: z.number().optional(),
      normalizedUnit: z.string(),
      observedAt: z.string().optional(),
      status: z.enum(["used", "missing", "invalid"]),
      detail: z.string().optional()
    }).strict()),
    limitations: z.array(z.string())
  }).strict())
}).strict();

const sourceCountsSchema = z.object({
  observations: nonNegativeInt,
  samples: nonNegativeInt,
  activities: nonNegativeInt
}).strict();

const healthDataSummaryTypeRowSchema = z.object({
  code: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  category: measurementCategorySchema,
  aggregation: measurementAggregationSchema.optional(),
  counts: sourceCountsSchema.extend({ total: nonNegativeInt }),
  lastMeasuredAt: z.string().optional()
}).strict();

export const healthDataSummaryResponseSchema: z.ZodType<HealthDataSummary> = z.object({
  generatedAt: z.string(),
  totals: sourceCountsSchema.extend({ total: nonNegativeInt, types: nonNegativeInt }),
  categories: z.array(z.object({
    key: measurementCategorySchema,
    label: z.string(),
    counts: sourceCountsSchema.extend({ total: nonNegativeInt, types: nonNegativeInt }),
    rows: z.array(healthDataSummaryTypeRowSchema)
  }).strict())
}).strict();

export const referenceRangeStateResponseSchema: z.ZodType<ReferenceRangeState> = z.object({
  personal: referenceRangeSchema.optional(),
  catalog: referenceRangeSchema.optional(),
  effective: referenceRangeSchema.optional(),
  source: z.enum(["personal", "catalog", "none"])
}).strict();

const healthDataDetailEntryKindSchema = z.enum(["observation", "sample", "activity"]);

export const healthDataDetailResponseSchema: z.ZodType<HealthDataDetail> = z.object({
  generatedAt: z.string(),
  measurement: healthDataSummaryTypeRowSchema,
  isPinned: z.boolean(),
  referenceRange: referenceRangeStateResponseSchema,
  entries: z.array(z.object({
    kind: healthDataDetailEntryKindSchema,
    id: z.string(),
    measurementCode: z.string(),
    displayName: z.string(),
    timestamp: z.string(),
    value: z.number(),
    unit: z.string(),
    sourceLabel: z.string().optional(),
    sourceKind: sourceKindSchema.optional(),
    importFileName: z.string().optional(),
    importedAt: z.string().optional(),
    note: z.string().optional(),
    observationGroup: z.object({
      id: z.string(),
      kind: observationGroupKindSchema,
      label: z.string(),
      collectedAt: z.string().optional()
    }).strict().optional(),
    referenceRange: referenceRangeSchema.optional(),
    status: measurementStatusSchema.optional(),
    canDelete: z.boolean().optional(),
    deleteLabel: z.string().optional()
  }).strict()),
  chartPoints: z.array(z.object({
    kind: healthDataDetailEntryKindSchema,
    timestamp: z.string(),
    value: z.number(),
    unit: z.string(),
    referenceRange: referenceRangeSchema.optional()
  }).strict()),
  counts: sourceCountsSchema.extend({ total: nonNegativeInt }),
  deletion: z.object({
    observationEntries: nonNegativeInt,
    deletableEntries: nonNegativeInt
  }).strict(),
  pagination: z.object({
    limit: nonNegativeInt,
    loaded: nonNegativeInt,
    total: nonNegativeInt,
    hasMore: z.boolean()
  }).strict()
}).strict();

export const healthDataChartSeriesResponseSchema: z.ZodType<HealthDataChartSeries> = z.object({
  generatedAt: z.string(),
  measurementCode: z.string(),
  range: z.enum(["all", "1y", "3m", "1m"]),
  requestedMode: z.enum(["auto", "raw"]),
  granularity: z.enum(["raw", "daily", "weekly"]),
  aggregation: measurementAggregationSchema,
  points: z.array(z.object({
    timestamp: z.string(),
    value: z.number(),
    unit: z.string(),
    count: nonNegativeInt,
    minValue: z.number().optional(),
    maxValue: z.number().optional(),
    referenceRange: referenceRangeSchema.optional()
  }).strict()),
  totalPoints: nonNegativeInt,
  truncated: z.boolean()
}).strict();

export const measurementPinStateResponseSchema: z.ZodType<MeasurementPinState> = z.object({
  measurementCode: z.string().trim().min(1),
  isPinned: z.boolean(),
  pinnedAt: isoTimestampSchema.optional()
}).strict();

export const profileResponseSchema: z.ZodType<Profile, z.ZodTypeDef, unknown> = profileSchema;

export const cloudAiConsentResponseSchema: z.ZodType<CloudAiConsent> = z.object({
  enabled: z.boolean(),
  providerScopeAccepted: z.boolean(),
  consentedAt: z.string().optional(),
  consentVersion: z.string().optional()
}).strict();

export const insightResponseSchema: z.ZodType<Insight, z.ZodTypeDef, unknown> = insightSchema;

const draftRowConfidenceSchema = z.enum(["high", "medium", "low"]);

export const bodyCompositionDraftResponseSchema: z.ZodType<BodyCompositionDraft> = z.object({
  fileName: z.string(),
  reportDate: z.string().optional(),
  sourceText: z.string(),
  checksum: z.string(),
  parserVersion: z.literal("body-composition-text-v1"),
  diagnostics: z.array(z.string()),
  rows: z.array(z.object({
    id: z.string(),
    label: z.string(),
    measurementCode: z.string(),
    displayName: z.string(),
    value: z.number(),
    unit: z.string(),
    observedAt: z.string().optional(),
    confidence: draftRowConfidenceSchema,
    sourceText: z.string().optional(),
    included: z.boolean(),
    generatedCode: z.boolean().optional()
  }).strict())
}).strict();

export const bloodTestDraftResponseSchema: z.ZodType<BloodTestDraft> = z.object({
  fileName: z.string(),
  reportDate: z.string().optional(),
  sourceText: z.string(),
  checksum: z.string(),
  parserVersion: z.literal("blood-test-text-v1"),
  diagnostics: z.array(z.string()),
  rows: z.array(z.object({
    id: z.string(),
    label: z.string(),
    measurementCode: z.string(),
    displayName: z.string(),
    value: z.number(),
    unit: z.string(),
    observedAt: z.string().optional(),
    confidence: draftRowConfidenceSchema,
    sourceText: z.string().optional(),
    included: z.boolean(),
    generatedCode: z.boolean().optional()
  }).strict())
}).strict();

const uploadColumnMappingSchema = z.object({
  dateColumn: z.string().optional(),
  measurementColumn: z.string().optional(),
  measurementCodeColumn: z.string().optional(),
  valueColumn: z.string().optional(),
  unitColumn: z.string().optional(),
  labelColumn: z.string().optional(),
  sourceNameColumn: z.string().optional(),
  noteColumn: z.string().optional()
}).strict();

export const uploadImportDraftResponseSchema: z.ZodType<UploadImportDraft> = z.object({
  fileName: z.string(),
  format: z.enum(["csv", "tsv"]),
  checksum: z.string(),
  parserVersion: z.literal("structured-upload-v1"),
  columns: z.array(z.string()),
  mapping: uploadColumnMappingSchema,
  mappingSuggestion: uploadColumnMappingSchema,
  rowCount: nonNegativeInt,
  diagnostics: z.array(z.string()),
  rows: z.array(z.object({
    id: z.string(),
    label: z.string(),
    measurementCode: z.string(),
    displayName: z.string(),
    value: z.number(),
    unit: z.string(),
    observedAt: z.string().optional(),
    confidence: draftRowConfidenceSchema,
    sourceText: z.string().optional(),
    sourceName: z.string().optional(),
    note: z.string().optional(),
    included: z.boolean(),
    generatedCode: z.boolean().optional(),
    sourceRowIndex: nonNegativeInt.optional(),
    sourceColumn: z.string().optional()
  }).strict()),
  truncated: z.boolean()
}).strict();

/** Storage telemetry the desktop attaches to observation mutations; opaque to the clients. */
const analyticsStorageField = { analyticsStorage: z.unknown().optional() };

export const updateObservationResponseSchema: z.ZodType<UpdateObservationResponse, z.ZodTypeDef, unknown> = z.object({
  updatedObservation: observationSchema,
  counts: entityCountsSchema,
  ...analyticsStorageField
}).strict();

export const deleteObservationResponseSchema: z.ZodType<DeleteObservationResponse, z.ZodTypeDef, unknown> = z.object({
  deletedCount: nonNegativeInt,
  deletedObservation: observationSchema.optional(),
  counts: entityCountsSchema,
  ...analyticsStorageField
}).strict();

export const deleteObservationsByTypeResponseSchema: z.ZodType<DeleteObservationsByTypeResponse, z.ZodTypeDef, unknown> = z.object({
  deletedCount: nonNegativeInt,
  measurementCode: z.string(),
  counts: entityCountsSchema,
  ...analyticsStorageField
}).strict();

export const healthEventMutationResponseSchema: z.ZodType<HealthEventMutationResponse> = z.object({
  healthEvent: healthEventSchema,
  counts: entityCountsSchema
}).strict();
export const careItemMutationResponseSchema: z.ZodType<CareItemMutationResponse> = z.object({
  careItem: careItemSchema,
  counts: entityCountsSchema
}).strict();
export const completeCareItemResponseSchema: z.ZodType<CompleteCareItemResponse> = z.object({
  careItem: careItemSchema,
  healthEvent: healthEventSchema.optional(),
  counts: entityCountsSchema
}).strict();
export const deleteHealthEventResponseSchema: z.ZodType<DeleteHealthEventResponse> = z.object({
  deletedCount: nonNegativeInt,
  deletedHealthEvent: healthEventSchema.optional(),
  counts: entityCountsSchema
}).strict();
export const deleteCareItemResponseSchema: z.ZodType<DeleteCareItemResponse> = z.object({
  deletedCount: nonNegativeInt,
  deletedCareItem: careItemSchema.optional(),
  counts: entityCountsSchema
}).strict();
export const linkedHealthEventConflictSchema = apiErrorResponseSchema.extend({
  code: z.literal("CARE_HEALTH_EVENT_LINK_CONFLICT"),
  linkedCareItems: z.array(z.object({
    id: z.string(),
    title: z.string(),
    role: z.literal("completion")
  }).strict())
}).strict();
