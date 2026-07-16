import { z } from "zod";
import type {
  AnalyticsSummary,
  AppBootstrap,
  BiologicalAgeReport,
  CloudAiConsent,
  DeleteObservationResponse,
  DeleteObservationsByTypeResponse,
  HealthDataDetail,
  HealthDataSummary,
  Insight,
  Profile,
  ProfileListEntry,
  UpdateObservationResponse
} from "./types.js";
import type { BodyCompositionDraft } from "./parsers.js";

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
export const profileResponseSchema = objectResponseSchema<Profile>();
export const cloudAiConsentResponseSchema = objectResponseSchema<CloudAiConsent>();
export const bodyCompositionDraftResponseSchema = objectResponseSchema<BodyCompositionDraft>();
export const insightResponseSchema = objectResponseSchema<Insight>();
export const updateObservationResponseSchema = objectResponseSchema<UpdateObservationResponse>();
export const deleteObservationResponseSchema = objectResponseSchema<DeleteObservationResponse>();
export const deleteObservationsByTypeResponseSchema = objectResponseSchema<DeleteObservationsByTypeResponse>();
