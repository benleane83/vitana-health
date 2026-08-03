import {
  safetyNotice,
  type AiQueryErrorResponse,
  type AiQueryResponse,
  type AiQueryTurnContext
} from "@vitana/shared";
import { planAiQuery, type PlannerResult, type QueryDSL } from "./aiQueryPlanner.js";
import { callConfiguredModel } from "./modelClient.js";
import { sanitizeQuestionForModel, sanitizeRowsForPrompt } from "./privacy.js";
import {
  compileAnalyticsQuery,
  runAnalyticsQuery,
  validateAnalyticsQuery
} from "./storage/analyticsBackend.js";
import type { ProfileStoreManager } from "./storage/profileStoreManager.js";

export type AiQueryServiceResult =
  | { ok: true; body: AiQueryResponse }
  | { ok: false; status: 422 | 500 | 502 | 504; body: AiQueryErrorResponse };

export async function executeAiQuery(
  storeManager: ProfileStoreManager,
  input: {
    question: string;
    timezone?: string;
    debug?: boolean;
    allowCloud: boolean;
    context?: AiQueryTurnContext;
  }
): Promise<AiQueryServiceResult> {
  const activeProfile = await storeManager.getActiveStore().getProfile();
  const context = input.context?.profileId === activeProfile?.id ? input.context : undefined;
  const planner = await planAiQuery(input.question, {
    timezone: input.timezone,
    allowCloud: input.allowCloud,
    context,
    validatePlan: (dsl) => {
      const compiled = compileAnalyticsQuery(storeManager, dsl);
      return compiled.ok ? [] : [compiled.error];
    }
  });

  if (!planner.ok) {
    const failureDetails = [planner.error, ...planner.limitations].join(" ");
    const timedOut = planner.category === "model" && /timed?\s*out|timeout|aborted/i.test(failureDetails);
    const code = planner.category === "model"
      ? timedOut ? "MODEL_TIMEOUT" : "MODEL_UNAVAILABLE"
      : planner.category === "compile" ? "QUERY_UNSUPPORTED" : "QUERY_NOT_UNDERSTOOD";
    const error = code === "MODEL_TIMEOUT"
      ? "The AI model took too long to answer. Try again or choose a faster model."
      : code === "MODEL_UNAVAILABLE"
        ? "The configured AI model could not be reached. Check its connection in Settings."
        : code === "QUERY_UNSUPPORTED"
          ? "This question cannot be answered with the local query tools yet."
          : "I could not understand that question well enough to query your data safely.";

    return {
      ok: false,
      status: code === "MODEL_TIMEOUT" ? 504 : code === "MODEL_UNAVAILABLE" ? 502 : 422,
      body: {
        error,
        code,
        suggestions: [
          "Ask about one metric or record type.",
          "Include a time range such as last month."
        ],
        suggestedRephrase: planner.suggestedRephrase,
        diagnostics: input.debug ? {
          plannerElapsedMs: planner.modelElapsedMs,
          attempts: planner.attempts,
          repaired: planner.repaired,
          failureCategory: planner.category,
          structuredOutputMode: planner.structuredOutputMode,
          issues: planner.category === "model" ? undefined : planner.limitations
        } : undefined
      }
    };
  }

  const compiled = compileAnalyticsQuery(storeManager, planner.dsl);
  if (!compiled.ok) return internalError("compile", planner, input.debug, [compiled.error]);

  const validation = validateAnalyticsQuery(storeManager, compiled.sql);
  if (!validation.valid) {
    return internalError("sql_safety", planner, input.debug, validation.violations);
  }

  let rows: Array<Record<string, unknown>>;
  try {
    rows = await runAnalyticsQuery(storeManager, compiled);
  } catch {
    return internalError("execution", planner, input.debug);
  }

  const plannerDebug = input.debug ? {
    plannerElapsedMs: planner.modelElapsedMs,
    attempts: planner.attempts,
    repaired: planner.repaired,
    firstFailureCategory: planner.firstFailureCategory,
    structuredOutputMode: planner.structuredOutputMode
  } : undefined;
  const turnContext = buildTurnContext(activeProfile.id, planner.dsl, compiled.resolvedTimeRange);

  if (rows.length === 0) {
    return {
      ok: true,
      body: {
        outcome: "no_data",
        question: input.question,
        answer: "No matching data was found in your local profile.",
        limitations: [
          "Try a wider time range or confirm that this data has been imported.",
          ...planner.limitations
        ],
        assumptions: planner.assumptions,
        confidence: planner.confidence,
        plan: planner.dsl,
        sql: compiled.sql,
        resolvedTimeRange: compiled.resolvedTimeRange,
        rowCount: 0,
        rows: [],
        chart: buildChartSeries(planner.dsl, []),
        context: turnContext,
        suggestedFollowUps: buildSuggestedFollowUps(planner.dsl, "no_data"),
        debug: plannerDebug
      }
    };
  }

  const deterministicAnswer = buildDeterministicTemporalAnswer(planner.dsl, rows);
  const modelResult = deterministicAnswer ? undefined : await callConfiguredModel([
    "You are a wellness analytics assistant. Answer the question using only the SQL result rows below.",
    "Provide one concise sentence. Do not diagnose or recommend treatments.",
    `Safety notice: ${safetyNotice}`,
    `Question: ${sanitizeQuestionForModel(input.question)}`,
    `Time range: ${compiled.resolvedTimeRange.label}`,
    `SQL result (first 20 rows): ${JSON.stringify(sanitizeRowsForPrompt(rows.slice(0, 20)))}`
  ].join("\n"), {
    allowCloud: input.allowCloud,
    task: "query-summary"
  });
  const answer = deterministicAnswer
    ?? (modelResult?.ok && modelResult.text
      ? modelResult.text
      : buildFallbackAnswer(planner.dsl, rows, compiled.resolvedTimeRange.label));

  return {
    ok: true,
    body: {
      outcome: "answered",
      question: input.question,
      answer,
      limitations: planner.limitations,
      assumptions: planner.assumptions,
      confidence: planner.confidence,
      plan: planner.dsl,
      sourceResolved: resolveQuerySource(planner.dsl),
      intentResolved: planner.dsl.intent,
      sql: compiled.sql,
      resolvedTimeRange: compiled.resolvedTimeRange,
      rowCount: rows.length,
      rows: rows.slice(0, 100),
      chart: buildChartSeries(planner.dsl, rows),
      model: deterministicAnswer
        ? "deterministic-summary"
        : modelResult?.ok ? `${modelResult.provider}:${modelResult.model}` : "deterministic-fallback",
      modelError: modelResult && !modelResult.ok ? modelResult.error : undefined,
      context: turnContext,
      suggestedFollowUps: buildSuggestedFollowUps(planner.dsl, "answered"),
      debug: plannerDebug && modelResult
        ? { ...plannerDebug, summaryElapsedMs: modelResult.elapsedMs }
        : plannerDebug
    }
  };
}

function internalError(
  failureCategory: "compile" | "sql_safety" | "execution",
  planner: PlannerResult,
  includeDiagnostics?: boolean,
  issues?: string[]
): AiQueryServiceResult {
  return {
    ok: false,
    status: 500,
    body: {
      error: "The query could not be completed safely.",
      code: "QUERY_EXECUTION_FAILED",
      suggestions: ["Try again.", "Choose a simpler question if the problem continues."],
      diagnostics: includeDiagnostics ? {
        plannerElapsedMs: planner.modelElapsedMs,
        attempts: planner.attempts,
        repaired: planner.repaired,
        firstFailureCategory: planner.firstFailureCategory,
        failureCategory,
        structuredOutputMode: planner.structuredOutputMode,
        issues
      } : undefined
    }
  };
}

function buildChartSeries(
  dsl: QueryDSL,
  rows: Array<Record<string, unknown>>
): { type: string; series: Array<{ label: string; value: number }> } | null {
  if (!dsl.chartType || dsl.chartType === "none") return null;
  if (dsl.intent === "timeseries") {
    const dateKey = dsl.groupBy === "week" ? "week_start" : dsl.groupBy === "month" ? "month_start" : "day";
    const series = rows.map((row) => ({
      label: String(row[dateKey] ?? ""),
      value: typeof (row.value ?? row.count) === "number"
        ? (row.value ?? row.count) as number
        : Number(row.value ?? row.count ?? 0)
    })).filter((point) => point.label);
    return { type: dsl.chartType, series };
  }
  if (dsl.intent === "top_n") {
    return { type: dsl.chartType ?? "bar", series: rows.map((row) => ({
      label: String(row.day ?? row.activity_type ?? row.week_start ?? ""),
      value: typeof row.value === "number" ? row.value : Number(row.value ?? 0)
    })) };
  }
  if (dsl.intent === "list_activities") {
    return { type: "bar", series: rows.map((row) => ({
      label: String(row.activity_type ?? ""),
      value: typeof row.count === "number" ? row.count : Number(row.count ?? 0)
    })) };
  }
  if (dsl.intent === "count" && dsl.groupBy) {
    const key = dsl.groupBy === "week" ? "week_start" : dsl.groupBy;
    return { type: dsl.chartType ?? "bar", series: rows.map((row) => ({
      label: String(row[key] ?? ""),
      value: typeof row.count === "number" ? row.count : Number(row.count ?? 0)
    })) };
  }
  return null;
}

function buildFallbackAnswer(
  dsl: QueryDSL,
  rows: Array<Record<string, unknown>>,
  timeLabel: string
): string {
  const metric = dsl.metric ?? "value";
  const firstRow = rows[0];
  const source = resolveQuerySource(dsl).replace("_", " ");
  if ((dsl.intent === "count" || dsl.intent === "overdue") && firstRow?.count !== undefined) {
    const prefix = dsl.intent === "overdue" ? "Overdue" : "Count of";
    return `${prefix} ${source} ${timeLabel}: ${firstRow.count}.`;
  }
  if (dsl.intent === "latest" && firstRow) {
    const value = firstRow.value ?? firstRow[metric];
    return value !== undefined ? `Latest ${metric}: ${value}.` : "Data found but the value could not be formatted.";
  }
  if (dsl.intent === "aggregation" && firstRow) {
    const value = firstRow.value ?? firstRow[metric];
    const aggregation = dsl.aggregation ?? "result";
    return value !== undefined
      ? `${aggregation.charAt(0).toUpperCase() + aggregation.slice(1)} ${metric} ${timeLabel}: ${value}.`
      : "Aggregation complete.";
  }
  return `Found ${rows.length} result(s) for ${metric} over ${timeLabel}.`;
}

function buildDeterministicTemporalAnswer(
  dsl: QueryDSL,
  rows: Array<Record<string, unknown>>
): string | undefined {
  if (!(["latest", "top_n"] as QueryDSL["intent"][]).includes(dsl.intent)) return undefined;
  const row = rows[0];
  if (!row) return undefined;
  const temporalValue = row.day ?? row.date ?? row.recorded_at ?? row.observed_at;
  const date = formatIsoDate(temporalValue);
  const value = row.value ?? (dsl.metric ? row[dsl.metric] : undefined);
  if (!date || value === undefined || value === null) return undefined;

  const metric = (dsl.metric ?? "value").replaceAll("_", " ");
  const unit = typeof row.unit === "string" && row.unit.trim() ? ` ${row.unit.trim()}` : "";
  const label = dsl.intent === "latest"
    ? `Latest ${metric}`
    : dsl.aggregation === "min" ? `Minimum ${metric}` : `Maximum ${metric}`;
  return `${label} was ${value}${unit} on ${date}.`;
}

function formatIsoDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return undefined;
  const month = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ][Number(match[2]) - 1];
  if (!month) return undefined;
  return `${month} ${Number(match[3])}, ${match[1]}`;
}

function resolveQuerySource(dsl: QueryDSL): NonNullable<QueryDSL["source"]> {
  return dsl.source ?? (dsl.intent === "list_activities" ? "activities" : "metrics");
}

function buildTurnContext(
  profileId: string,
  dsl: QueryDSL,
  resolvedTimeRange: { start: string; end: string }
): AiQueryTurnContext {
  return {
    version: 1,
    profileId,
    source: resolveQuerySource(dsl),
    metric: dsl.metric,
    intent: dsl.intent,
    aggregation: dsl.aggregation,
    groupBy: dsl.groupBy,
    sort: dsl.sort,
    filters: dsl.filters,
    resolvedTimeRange: {
      start: resolvedTimeRange.start,
      end: resolvedTimeRange.end
    }
  };
}

function buildSuggestedFollowUps(
  dsl: QueryDSL,
  outcome: AiQueryResponse["outcome"]
): string[] {
  if (outcome === "no_data") return ["Try the last 90 days"];

  const source = resolveQuerySource(dsl);
  if (source !== "metrics") {
    if (dsl.intent === "count" && dsl.groupBy === null) return ["Group these by kind"];
    return ["Show the last 90 days"];
  }

  if (dsl.intent === "aggregation" && ["max", "min"].includes(dsl.aggregation)) {
    return ["Which day was that on?", "Show the daily trend"];
  }
  if (dsl.intent === "timeseries") return ["What was the highest day?", "What was the average?"];
  if (dsl.intent === "latest") return ["Show the last 30 days"];
  if (dsl.intent === "top_n") return ["Show the daily trend", "What was the average?"];
  return ["Show the daily trend", "What was the highest day?"];
}
