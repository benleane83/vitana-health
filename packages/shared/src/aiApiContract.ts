import { z } from "zod";

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