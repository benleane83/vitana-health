import express from "express";
import { aiQueryRequestSchema, safetyNotice } from "@vitana/shared";
import type { ProfileStoreManager } from "../storage/profileStoreManager.js";
import {
  compileAnalyticsQuery,
  runAnalyticsQuery,
  validateAnalyticsQuery
} from "../storage/analyticsBackend.js";
import { callConfiguredModel, currentModelConfig } from "../modelClient.js";
import { planAiQuery } from "../aiQueryPlanner.js";
import type { QueryDSL } from "../aiQueryPlanner.js";
import { hasCloudAiConsent, sanitizeQuestionForModel, sanitizeRowsForPrompt } from "../privacy.js";

export function makeQueryRoutes(storeManager: ProfileStoreManager): express.Router {
  const router = express.Router();

  function activeStore() {
    return storeManager.getActiveStore();
  }

  async function ensureCloudConsent(response: express.Response, provider?: "ollama" | "openai"): Promise<boolean> {
    const resolved = provider ?? currentModelConfig().provider;
    if (resolved !== "openai") {
      return true;
    }
    if (hasCloudAiConsent(await activeStore().getProfile())) {
      return true;
    }
    response.status(403).json({
      error: "Cloud model consent is required before sending prompts off-device.",
      code: "CLOUD_CONSENT_REQUIRED",
      provider: "openai"
    });
    return false;
  }

  // AI-planned query pipeline (primary query path for the web UI)
  router.post("/ai", async (request, response, next) => {
    try {
      response.setHeader("x-vitana-lifecycle", "supported");
      if (!await ensureCloudConsent(response)) {
        return;
      }
      const parsed = aiQueryRequestSchema.parse(request.body ?? {});

      const plannerOutcome = await planAiQuery(parsed.question, {
        timezone: parsed.timezone,
        allowCloud: hasCloudAiConsent(await activeStore().getProfile())
      });

      if (!plannerOutcome.ok) {
        response.status(400).json({
          question: parsed.question,
          answer: plannerOutcome.error,
          limitations: plannerOutcome.limitations,
          suggestedRephrase: plannerOutcome.suggestedRephrase,
          confidence: 0,
          plan: null,
          sql: null,
          rows: [],
          chart: null
        });
        return;
      }

      const compileOutcome = compileAnalyticsQuery(storeManager, plannerOutcome.dsl);
      if (!compileOutcome.ok) {
        response.status(400).json({
          question: parsed.question,
          answer: `Query could not be compiled: ${compileOutcome.error}`,
          limitations: [compileOutcome.error, ...plannerOutcome.limitations],
          confidence: plannerOutcome.confidence * 0.5,
          plan: plannerOutcome.dsl,
          sql: null,
          rows: [],
          chart: null
        });
        return;
      }

      const validation = validateAnalyticsQuery(storeManager, compileOutcome.sql);
      if (!validation.valid) {
        response.status(500).json({
          question: parsed.question,
          answer: "Generated SQL failed safety validation.",
          limitations: validation.violations,
          confidence: 0,
          plan: plannerOutcome.dsl,
          sql: parsed.debug ? compileOutcome.sql : null,
          rows: [],
          chart: null
        });
        return;
      }

      const rows = await runAnalyticsQuery(storeManager, compileOutcome.sql);

      if (rows.length === 0) {
        response.json({
          question: parsed.question,
          answer:
            "No data found for this query in your local profile. Import more data or adjust the time range.",
          limitations: [
            "No rows returned. The profile may not contain data for the requested metric and time range.",
            ...plannerOutcome.limitations
          ],
          assumptions: plannerOutcome.assumptions,
          confidence: plannerOutcome.confidence,
          plan: plannerOutcome.dsl,
          sql: compileOutcome.sql,
          resolvedTimeRange: compileOutcome.resolvedTimeRange,
          rows: [],
          chart: buildChartSeries(plannerOutcome.dsl, [])
        });
        return;
      }

      const summaryPrompt = [
        "You are a wellness analytics assistant. Answer the question using only the SQL result rows below.",
        "Provide one concise sentence. Do not diagnose or recommend treatments.",
        `Safety notice: ${safetyNotice}`,
        `Question: ${sanitizeQuestionForModel(parsed.question)}`,
        `Time range: ${compileOutcome.resolvedTimeRange.label}`,
        `SQL result (first 20 rows): ${JSON.stringify(sanitizeRowsForPrompt(rows.slice(0, 20)))}`
      ].join("\n");

      const modelResult = await callConfiguredModel(summaryPrompt, {
        allowCloud: hasCloudAiConsent(await activeStore().getProfile())
      });
      const answer =
        modelResult.ok && modelResult.text
          ? modelResult.text
          : buildFallbackAnswer(plannerOutcome.dsl, rows, compileOutcome.resolvedTimeRange.label);

      const debugInfo = parsed.debug
        ? { plannerElapsedMs: plannerOutcome.modelElapsedMs, summaryElapsedMs: modelResult.elapsedMs }
        : undefined;

      response.json({
        question: parsed.question,
        answer,
        limitations: plannerOutcome.limitations,
        assumptions: plannerOutcome.assumptions,
        confidence: plannerOutcome.confidence,
        plan: plannerOutcome.dsl,
        sourceResolved: resolveQuerySource(plannerOutcome.dsl),
        intentResolved: plannerOutcome.dsl.intent,
        sql: compileOutcome.sql,
        resolvedTimeRange: compileOutcome.resolvedTimeRange,
        rowCount: rows.length,
        rows: rows.slice(0, 100),
        chart: buildChartSeries(plannerOutcome.dsl, rows),
        model: modelResult.ok ? `${modelResult.provider}:${modelResult.model}` : "deterministic-fallback",
        modelError: modelResult.ok ? undefined : modelResult.error,
        debug: debugInfo
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function makeLlmRoutes(): express.Router {
  const router = express.Router();

  router.get("/config", (_request, response) => {
    response.json(currentModelConfig());
  });

  return router;
}

/**
 * Converts supported query result rows into the chart series consumed by the
 * web client, or returns null when the requested query has no chart.
 */
function buildChartSeries(
  dsl: QueryDSL,
  rows: Array<Record<string, unknown>>
): { type: string; series: Array<{ label: string; value: number }> } | null {
  if (!dsl.chartType || dsl.chartType === "none") return null;
  if (dsl.intent === "timeseries") {
    const dateKey =
      dsl.groupBy === "week" ? "week_start" : dsl.groupBy === "month" ? "month_start" : "day";
    const series = rows
      .map((row) => ({
        label: String(row[dateKey] ?? ""),
        value: typeof (row.value ?? row.count) === "number"
          ? (row.value ?? row.count) as number
          : Number(row.value ?? row.count ?? 0)
      }))
      .filter((point) => point.label);
    return { type: dsl.chartType, series };
  }
  if (dsl.intent === "top_n") {
    const series = rows.map((row) => ({
      label: String(row.day ?? row.activity_type ?? row.week_start ?? ""),
      value: typeof row.value === "number" ? row.value : Number(row.value ?? 0)
    }));
    return { type: dsl.chartType ?? "bar", series };
  }
  if (dsl.intent === "list_activities") {
    const series = rows.map((row) => ({
      label: String(row.activity_type ?? ""),
      value: typeof row.count === "number" ? row.count : Number(row.count ?? 0)
    }));
    return { type: "bar", series };
  }
  if (dsl.intent === "count" && dsl.groupBy) {
    const key = dsl.groupBy === "week" ? "week_start" : dsl.groupBy;
    const series = rows.map((row) => ({
      label: String(row[key] ?? ""),
      value: typeof row.count === "number" ? row.count : Number(row.count ?? 0)
    }));
    return { type: dsl.chartType ?? "bar", series };
  }
  return null;
}

/**
 * Produces a deterministic summary when a model-generated query answer is
 * unavailable, using only the validated query plan and returned rows.
 */
function buildFallbackAnswer(
  dsl: QueryDSL,
  rows: Array<Record<string, unknown>>,
  timeLabel: string
): string {
  if (rows.length === 0) return "No data available for this query.";
  const metric = dsl.metric ?? "value";
  const firstRow = rows[0];
  const source = resolveQuerySource(dsl).replace("_", " ");
  if ((dsl.intent === "count" || dsl.intent === "overdue") && firstRow?.count !== undefined) {
    const prefix = dsl.intent === "overdue" ? "Overdue" : "Count of";
    return `${prefix} ${source} ${timeLabel}: ${firstRow.count}.`;
  }
  if (dsl.intent === "latest" && firstRow) {
    const val = firstRow.value ?? firstRow[metric];
    return val !== undefined ? `Latest ${metric}: ${val}.` : "Data found but value could not be formatted.";
  }
  if (dsl.intent === "aggregation" && firstRow) {
    const val = firstRow.value ?? firstRow[metric];
    const agg = dsl.aggregation ?? "result";
    return val !== undefined
      ? `${agg.charAt(0).toUpperCase() + agg.slice(1)} ${metric} ${timeLabel}: ${val}.`
      : "Aggregation complete.";
  }
  return `Found ${rows.length} result(s) for ${metric} over ${timeLabel}.`;
}

function resolveQuerySource(dsl: QueryDSL): NonNullable<QueryDSL["source"]> {
  return dsl.source ?? (dsl.intent === "list_activities" ? "activities" : "metrics");
}
