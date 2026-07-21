import { z } from "zod";
import { defaultMeasurementTypes } from "@vitana/shared";
import { callConfiguredModel } from "./modelClient.js";
import { sanitizeQuestionForModel } from "./privacy.js";

// ─── DSL Schema ──────────────────────────────────────────────────────────────

export const TimeRangePresetSchema = z.enum([
  "this_month",
  "last_month",
  "this_week",
  "last_week",
  "last_30d",
  "last_90d",
  "all_time"
]);
export type TimeRangePreset = z.infer<typeof TimeRangePresetSchema>;

export const TimeRangeSchema = z.object({
  preset: TimeRangePresetSchema.optional(),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});
export type TimeRange = z.infer<typeof TimeRangeSchema>;

export const QueryFiltersSchema = z.object({
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

export const QueryDSLSchema = z.object({
  source: z.enum(["metrics", "activities", "health_events", "care_items"]).optional(),
  intent: z.enum(["timeseries", "aggregation", "top_n", "latest", "list_activities", "list", "count", "overdue"]),
  metric: z.string().nullable(),
  aggregation: z.enum(["avg", "max", "min", "sum", "count", "latest"]),
  groupBy: z.enum(["day", "week", "month", "kind", "status", "source", "priority", "due_bucket"]).nullable(),
  timeRange: TimeRangeSchema,
  sort: z.enum(["asc", "desc"]),
  limit: z.number().int().min(1).max(200),
  chartType: z.enum(["line", "bar", "none"]).nullable(),
  filters: QueryFiltersSchema.optional()
});
export type QueryDSL = z.infer<typeof QueryDSLSchema>;

// ─── Result types ─────────────────────────────────────────────────────────────

export interface PlannerResult {
  ok: true;
  dsl: QueryDSL;
  confidence: number;
  limitations: string[];
  assumptions: string[];
  modelElapsedMs: number;
}

export interface PlannerError {
  ok: false;
  error: string;
  limitations: string[];
  suggestedRephrase?: string;
  modelElapsedMs: number;
}

export type PlannerOutcome = PlannerResult | PlannerError;

// ─── Time semantics ───────────────────────────────────────────────────────────

export interface ResolvedTimeRange {
  start: string;
  end: string;
  label: string;
}

export function resolveTimeRange(timeRange: TimeRange, referenceDate?: Date): ResolvedTimeRange {
  const now = referenceDate ?? new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed

  function isoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  if (timeRange.start && timeRange.end) {
    return { start: timeRange.start, end: timeRange.end, label: `${timeRange.start} to ${timeRange.end}` };
  }

  const preset = timeRange.preset ?? "last_90d";

  switch (preset) {
    case "this_month": {
      const start = new Date(year, month, 1);
      const end = new Date(year, month + 1, 0);
      return { start: isoDate(start), end: isoDate(end), label: "this month" };
    }
    case "last_month": {
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 0);
      return { start: isoDate(start), end: isoDate(end), label: "last month" };
    }
    case "this_week": {
      const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1; // Monday=0
      const start = new Date(year, month, now.getDate() - dayOfWeek);
      const end = new Date(year, month, now.getDate() - dayOfWeek + 6);
      return { start: isoDate(start), end: isoDate(end), label: "this week" };
    }
    case "last_week": {
      const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1;
      const start = new Date(year, month, now.getDate() - dayOfWeek - 7);
      const end = new Date(year, month, now.getDate() - dayOfWeek - 1);
      return { start: isoDate(start), end: isoDate(end), label: "last week" };
    }
    case "last_30d": {
      const start = new Date(now);
      start.setDate(start.getDate() - 30);
      return { start: isoDate(start), end: isoDate(now), label: "last 30 days" };
    }
    case "all_time": {
      return { start: "2000-01-01", end: isoDate(now), label: "all time" };
    }
    default: {
      // last_90d (hard max)
      const start = new Date(now);
      start.setDate(start.getDate() - 90);
      return { start: isoDate(start), end: isoDate(now), label: "last 90 days" };
    }
  }
}

// ─── Prompt building ──────────────────────────────────────────────────────────

const ALLOWED_METRICS = defaultMeasurementTypes.map((m) => m.code).join(", ");

const PLANNER_SYSTEM = `You are a JSON-only fitness analytics query planner.
Return ONLY a valid JSON object matching the schema below. No prose, no code blocks, no markdown.

Schema:
{
  "source": one of "metrics" | "activities" | "health_events" | "care_items" (omit for existing metric/activity questions),
  "intent": one of "timeseries" | "aggregation" | "top_n" | "latest" | "list_activities" | "list" | "count" | "overdue",
  "metric": measurement code string for metrics, otherwise null,
  "aggregation": one of "avg" | "max" | "min" | "sum" | "count" | "latest",
  "groupBy": one of "day" | "week" | "month" | "kind" | "status" | "source" | "priority" | "due_bucket" or null,
  "timeRange": {
    "preset": one of "this_month" | "last_month" | "this_week" | "last_week" | "last_30d" | "last_90d" | "all_time"
  },
  "sort": "asc" or "desc",
  "limit": integer 1-200,
  "chartType": "line" | "bar" | "none" or null,
  "filters": optional object with "kind", "status", "source", "provider", "priority", "code", "completion", or "dueWithinRange"
}

Allowed metric codes: ${ALLOWED_METRICS}

Rules:
- "timeseries" intent: use groupBy="day" or "week", include chartType
- "aggregation" intent: single aggregated value, groupBy=null
- "top_n" intent: sort desc by aggregation, limit 5-20
- "latest" intent: aggregation="latest", sort="desc", limit=1
- "list_activities" intent: metric=null, aggregation="count"
- Health event questions: source="health_events"; use list, count, latest, or timeseries (day/week)
- Care item questions: source="care_items"; use list, count, or overdue; group counts by status, priority, kind, or due_bucket
- For health events, filters support kind, status, source, and provider (contains)
- For care items, filters support kind, code, status, priority, and completion
- Use timeRange as the occurred range for health events
- For a requested care-item due window, set filters.dueWithinRange=true and use timeRange as the due range; otherwise omit it
- Unsupported cross-source comparisons are not allowed
- For "this month" / "last month" use the exact preset
- Default time range is "last_30d" unless specified
- Maximum limit is 200`;

function buildPlannerPrompt(question: string, timezone?: string): string {
  const tzNote = timezone ? `\nUser timezone: ${timezone}` : "";
  return `${PLANNER_SYSTEM}${tzNote}\n\nQuestion: ${question}\n\nRespond with the JSON object only:`;
}

// ─── Confidence and limitations derivation ────────────────────────────────────

function deriveConfidenceAndLimitations(
  dsl: QueryDSL,
  rawModel: string
): { confidence: number; limitations: string[]; assumptions: string[] } {
  const limitations: string[] = [];
  const assumptions: string[] = [];
  let score = 1.0;

  // Check metric is known
  if (dsl.metric !== null) {
    const known = defaultMeasurementTypes.find((m) => m.code === dsl.metric);
    if (!known) {
      limitations.push(`Metric "${dsl.metric}" is not in the supported registry; results may be empty.`);
      score -= 0.3;
    }
  }

  // Check groupBy consistency
  if (dsl.intent === "timeseries" && !dsl.groupBy) {
    assumptions.push("Assumed daily grouping for time-series intent.");
    score -= 0.05;
  }

  // Check time range
  if (!dsl.timeRange.preset && !dsl.timeRange.start) {
    assumptions.push("Defaulted to last 30 days time range.");
    score -= 0.1;
  }

  // Penalise if raw model output had obvious JSON issues (extra content around JSON)
  const trimmed = rawModel.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    limitations.push("Planner output contained non-JSON content; parsed from extracted JSON.");
    score -= 0.15;
  }

  // list_activities with unknown aggregation
  if (dsl.intent === "list_activities" && dsl.metric !== null) {
    assumptions.push("Treating activity-type breakdown as activity listing.");
  }

  return {
    confidence: Math.max(0.1, Math.round(score * 10) / 10),
    limitations,
    assumptions
  };
}

// ─── JSON extraction helper ───────────────────────────────────────────────────

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  // First try to parse as-is
  if (trimmed.startsWith("{")) {
    return trimmed;
  }
  // Extract the first JSON object from prose/markdown
  const match = /\{[\s\S]*\}/.exec(trimmed);
  if (match) {
    return match[0];
  }
  return trimmed;
}

// ─── Main planner function ────────────────────────────────────────────────────

export async function planAiQuery(
  question: string,
  options?: { timezone?: string; timeoutMs?: number; allowCloud?: boolean }
): Promise<PlannerOutcome> {
  const prompt = buildPlannerPrompt(sanitizeQuestionForModel(question), options?.timezone);
  const modelResult = await callConfiguredModel(prompt, {
    timeoutMs: options?.timeoutMs ?? 30000,
    allowCloud: options?.allowCloud
  });

  const elapsedMs = modelResult.elapsedMs;

  if (!modelResult.ok || !modelResult.text) {
    return {
      ok: false,
      error: modelResult.error ?? "Model did not return output.",
      limitations: [
        "The AI planner could not interpret this question. Try rephrasing it.",
        ...(modelResult.error ? [`Model error: ${modelResult.error}`] : [])
      ],
      suggestedRephrase: "Try asking: 'average heart rate last month' or 'steps trend this week'.",
      modelElapsedMs: elapsedMs
    };
  }

  const rawText = modelResult.text;
  const jsonString = extractJson(rawText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    return {
      ok: false,
      error: "Planner returned invalid JSON.",
      limitations: [
        "The AI planner returned a malformed response. The question may be outside supported query classes.",
        `Raw planner output (first 200 chars): ${rawText.slice(0, 200)}`
      ],
      suggestedRephrase: "Try: 'max daily steps this month' or 'average heart rate last month'.",
      modelElapsedMs: elapsedMs
    };
  }

  const validation = QueryDSLSchema.safeParse(parsed);
  if (!validation.success) {
    const issues = validation.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    return {
      ok: false,
      error: `DSL schema validation failed: ${issues}`,
      limitations: [
        "The planner output did not match the required schema.",
        `Validation errors: ${issues}`
      ],
      suggestedRephrase: "Try: 'top exercises this month' or 'weekly steps trend last month'.",
      modelElapsedMs: elapsedMs
    };
  }

  const dsl = validation.data;
  const { confidence, limitations, assumptions } = deriveConfidenceAndLimitations(dsl, rawText);

  return {
    ok: true,
    dsl,
    confidence,
    limitations,
    assumptions,
    modelElapsedMs: elapsedMs
  };
}
