import express from "express";
import { z } from "zod";
import { safetyNotice } from "@local-fitness-advisor/shared";
import type { ProfileStoreManager } from "../store.js";
import {
  compileAnalyticsQuery,
  runAnalyticsQuery,
  validateAnalyticsQuery
} from "../storage/analyticsBackend.js";
import { callConfiguredModel, currentModelConfig, resolvedModelProvider } from "../modelClient.js";
import { planStoreAnswer } from "../askStore.js";
import { planAiQuery } from "../aiQueryPlanner.js";
import type { QueryDSL } from "../aiQueryPlanner.js";
import { hasCloudAiConsent, sanitizeQuestionForModel, sanitizeRowsForPrompt } from "../privacy.js";

const llmSimpleSchema = z.object({
  prompt: z.string().min(1).max(4000).default("Reply with exactly: local model ok"),
  model: z.string().min(1).max(120).optional(),
  timeoutMs: z.number().int().min(1000).max(180000).optional(),
  provider: z.enum(["ollama", "openai"]).optional()
});

const askSchema = z.object({
  question: z.string().min(3).max(500)
});

const aiQuerySchema = z.object({
  question: z.string().min(3).max(500),
  timezone: z.string().max(80).optional(),
  debug: z.boolean().optional().default(false)
});

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

  // Store-backed ask retained as an experimental warehouse-unavailable fallback.
  router.post("/ask-store", async (request, response, next) => {
    try {
      response.setHeader("x-lfa-lifecycle", "experimental");
      if (!await ensureCloudConsent(response)) {
        return;
      }
      const parsed = askSchema.parse(request.body ?? {});
      const plan = planStoreAnswer(parsed.question, await activeStore().readSnapshot());
      if (!plan) {
        response.status(400).json({
          error: "Question is not yet supported by the store ask planner.",
          code: "QUERY_UNSUPPORTED",
          supportedExamples: ["What was the last heart rate recorded?", "What was my latest oxygen saturation?"]
        });
        return;
      }

      if (plan.rows.length === 0) {
        response.json({
          question: parsed.question,
          plan: plan.answerLead,
          rowCount: 0,
          rows: [],
          answer: "I could not find matching data in your datastore yet."
        });
        return;
      }

      const prompt = [
        "Answer the question using only the supplied datastore rows.",
        "Return one concise sentence and do not add medical advice.",
        `Question: ${sanitizeQuestionForModel(parsed.question)}`,
        `Datastore rows JSON: ${JSON.stringify(sanitizeRowsForPrompt(plan.rows))}`
      ].join("\n");

      const modelResult = await callConfiguredModel(prompt, {
        allowCloud: hasCloudAiConsent(await activeStore().getProfile())
      });
      response.json({
        question: parsed.question,
        plan: plan.answerLead,
        rowCount: plan.rows.length,
        rows: plan.rows,
        answer:
          modelResult.ok && modelResult.text
            ? modelResult.text
            : "I found the data, but model wording was unavailable.",
        model: modelResult.ok ? `${modelResult.provider}:${modelResult.model}` : "deterministic-fallback",
        modelError: modelResult.ok ? undefined : modelResult.error
      });
    } catch (error) {
      next(error);
    }
  });

  // AI-planned query pipeline (primary query path for the web UI)
  router.post("/ai", async (request, response, next) => {
    try {
      response.setHeader("x-lfa-lifecycle", "supported");
      if (!await ensureCloudConsent(response)) {
        return;
      }
      const parsed = aiQuerySchema.parse(request.body ?? {});

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
            "No data found for this query in your local warehouse. Import more data or adjust the time range.",
          limitations: [
            "No rows returned. The warehouse may not contain data for the requested metric and time range.",
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

export function makeLlmRoutes(storeManager: ProfileStoreManager): express.Router {
  const router = express.Router();

  function activeStore() {
    return storeManager.getActiveStore();
  }

  router.get("/config", (_request, response) => {
    response.json(currentModelConfig());
  });

  router.post("/simple", async (request, response, next) => {
    try {
      response.setHeader("x-lfa-lifecycle", "experimental");
      const parsed = llmSimpleSchema.parse(request.body ?? {});
      const provider = resolvedModelProvider(parsed.provider);
      if (provider === "openai" && !hasCloudAiConsent(await activeStore().getProfile())) {
        response.status(403).json({
          ok: false,
          provider,
          endpoint: "",
          model: parsed.model ?? "",
          timeoutMs: parsed.timeoutMs ?? 30000,
          elapsedMs: 0,
          error: "CLOUD_CONSENT_REQUIRED",
          code: "CLOUD_CONSENT_REQUIRED",
          message: "Use /api/profile/cloud-ai-consent to grant explicit cloud prompt consent before using cloud models."
        });
        return;
      }
      const result = await callConfiguredModel(parsed.prompt, {
        model: parsed.model,
        timeoutMs: parsed.timeoutMs,
        provider: parsed.provider,
        allowCloud: hasCloudAiConsent(await activeStore().getProfile())
      });
      if (!result.ok) {
        response
          .status(result.error?.includes("timed out") ? 504 : 502)
          .json(result);
        return;
      }
      response.json(result);
    } catch (error) {
      next(error);
    }
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
        value: typeof row.value === "number" ? row.value : Number(row.value ?? 0)
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
