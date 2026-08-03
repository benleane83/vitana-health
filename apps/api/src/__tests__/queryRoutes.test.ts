import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileStoreManager } from "../storage/profileStoreManager.js";

const callConfiguredModel = vi.hoisted(() => vi.fn());

vi.mock("../modelClient.js", () => ({
  callConfiguredModel,
  currentModelConfig: () => ({ provider: "ollama", model: "test" })
}));

import { makeQueryRoutes } from "../routes/queryRoutes.js";

beforeEach(() => {
  callConfiguredModel.mockReset();
});

describe("POST /api/query/ai domain sources", () => {
  it("returns a typed misunderstanding after one bounded repair", async () => {
    const { app } = queryApp([]);
    callConfiguredModel
      .mockResolvedValueOnce(modelText("not json"))
      .mockResolvedValueOnce(modelText("still not json"));

    const response = await request(app)
      .post("/api/query/ai")
      .send({ question: "Could you work this out for me?", debug: true });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      code: "QUERY_NOT_UNDERSTOOD",
      diagnostics: { attempts: 2, repaired: true, failureCategory: "json" }
    });
    expect(callConfiguredModel).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(response.body)).not.toContain("still not json");
  });

  it("returns a typed model availability failure", async () => {
    const { app } = queryApp([]);
    callConfiguredModel.mockResolvedValueOnce({
      ok: false,
      provider: "ollama",
      endpoint: "http://localhost",
      model: "test",
      timeoutMs: 100,
      elapsedMs: 4,
      error: "connection refused"
    });

    const response = await request(app).post("/api/query/ai").send({ question: "average heart rate" });

    expect(response.status).toBe(502);
    expect(response.body).toMatchObject({ code: "MODEL_UNAVAILABLE" });
  });

  it("returns a typed model timeout failure", async () => {
    const { app } = queryApp([]);
    callConfiguredModel.mockResolvedValueOnce({
      ok: false,
      provider: "ollama",
      endpoint: "http://localhost",
      model: "test",
      timeoutMs: 100,
      elapsedMs: 100,
      error: "Model request timed out"
    });

    const response = await request(app).post("/api/query/ai").send({ question: "average heart rate" });

    expect(response.status).toBe(504);
    expect(response.body).toMatchObject({ code: "MODEL_TIMEOUT" });
  });

  it("returns an explicit successful no-data result", async () => {
    const { app } = queryApp([]);
    callConfiguredModel.mockResolvedValueOnce(modelText(JSON.stringify(metricPlan())));

    const response = await request(app).post("/api/query/ai").send({ question: "average heart rate" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      outcome: "no_data",
      rowCount: 0,
      rows: [],
      context: {
        version: 1,
        profileId: "self",
        metric: "heart_rate",
        resolvedTimeRange: { start: expect.any(String), end: expect.any(String) }
      },
      suggestedFollowUps: ["Try the last 90 days"]
    });
    expect(callConfiguredModel).toHaveBeenCalledTimes(1);
  });

  it("uses matching prior context but excludes its profile scope from the model prompt", async () => {
    const { app } = queryApp([]);
    callConfiguredModel.mockResolvedValueOnce(modelText(JSON.stringify({
      intent: "top_n",
      metric: "steps",
      aggregation: "max",
      groupBy: "day",
      timeRange: { start: "2026-07-01", end: "2026-07-31" },
      sort: "desc",
      limit: 1,
      chartType: "none"
    })));

    const response = await request(app).post("/api/query/ai").send({
      question: "Which day was that on?",
      context: {
        version: 1,
        profileId: "self",
        source: "metrics",
        metric: "steps",
        intent: "aggregation",
        aggregation: "max",
        groupBy: null,
        sort: "desc",
        resolvedTimeRange: { start: "2026-07-01", end: "2026-07-31" }
      }
    });

    expect(response.status).toBe(200);
    const prompt = String(callConfiguredModel.mock.calls[0][0]);
    expect(prompt).toContain('"metric":"steps"');
    expect(prompt).not.toContain("profileId");
    expect(prompt).not.toContain('"self"');
  });

  it("ignores prior context scoped to another profile", async () => {
    const { app } = queryApp([]);
    callConfiguredModel.mockResolvedValueOnce(modelText(JSON.stringify(metricPlan())));

    const response = await request(app).post("/api/query/ai").send({
      question: "What about this month?",
      context: {
        version: 1,
        profileId: "someone-else",
        source: "metrics",
        metric: "steps",
        intent: "aggregation",
        aggregation: "max",
        groupBy: null,
        sort: "desc",
        resolvedTimeRange: { start: "2026-07-01", end: "2026-07-31" }
      }
    });

    expect(response.status).toBe(200);
    expect(String(callConfiguredModel.mock.calls[0][0])).not.toContain("prior_context");
  });

  it("does not ask the model to repair an execution failure", async () => {
    const { app, runActiveCompiledQuery } = queryApp([]);
    runActiveCompiledQuery.mockRejectedValueOnce(new Error("database unavailable"));
    callConfiguredModel.mockResolvedValueOnce(modelText(JSON.stringify(metricPlan())));

    const response = await request(app)
      .post("/api/query/ai")
      .send({ question: "average heart rate", debug: true });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      code: "QUERY_EXECUTION_FAILED",
      diagnostics: { attempts: 1, repaired: false, failureCategory: "execution" }
    });
    expect(callConfiguredModel).toHaveBeenCalledTimes(1);
  });

  it("summarizes a dated latest result without contradicting its local evidence", async () => {
    const { app } = queryApp([{ day: "2026-08-02T00:00:00.000Z", value: 463, unit: "min" }]);
    callConfiguredModel.mockResolvedValueOnce(modelText(JSON.stringify({
      source: "metrics",
      intent: "latest",
      metric: "sleep_duration",
      aggregation: "latest",
      groupBy: null,
      timeRange: { start: "2026-07-04", end: "2026-08-03" },
      sort: "desc",
      limit: 1,
      chartType: "none"
    })));

    const response = await request(app).post("/api/query/ai").send({ question: "Which day was that on?" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      answer: "Latest sleep duration was 463 min on August 2, 2026.",
      rows: [{ day: "2026-08-02T00:00:00.000Z", value: 463, unit: "min" }],
      model: "deterministic-summary"
    });
    expect(callConfiguredModel).toHaveBeenCalledTimes(1);
  });

  it("runs a health event timeseries and maps event counts to a chart", async () => {
    const { app, runActiveCompiledQuery } = queryApp([{ day: "2026-07-01", count: 2 }]);
    planThenFailSummary({
      source: "health_events",
      intent: "timeseries",
      metric: null,
      aggregation: "count",
      groupBy: "day",
      timeRange: { start: "2026-07-01", end: "2026-07-31" },
      sort: "asc",
      limit: 31,
      chartType: "bar",
      filters: { kind: "immunization" }
    });

    const response = await request(app).post("/api/query/ai").send({ question: "Daily immunizations this month" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      sourceResolved: "health_events",
      intentResolved: "timeseries",
      chart: { type: "bar", series: [{ label: "2026-07-01", value: 2 }] },
      model: "deterministic-fallback"
    });
    expect(runActiveCompiledQuery).toHaveBeenCalledWith(
      expect.objectContaining({ dialect: "duckdb", sql: expect.stringContaining("FROM v_ai_health_events") })
    );
  });

  it("runs grouped care item counts with the existing response envelope", async () => {
    const { app, runActiveCompiledQuery } = queryApp([{ priority: "high", count: 3 }]);
    planThenFailSummary({
      source: "care_items",
      intent: "count",
      metric: null,
      aggregation: "count",
      groupBy: "priority",
      timeRange: { start: "2026-07-01", end: "2026-07-31" },
      sort: "desc",
      limit: 20,
      chartType: "bar",
      filters: { status: "open" }
    });

    const response = await request(app).post("/api/query/ai").send({ question: "Open care items by priority" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      question: "Open care items by priority",
      sourceResolved: "care_items",
      rows: [{ priority: "high", count: 3 }],
      chart: { type: "bar", series: [{ label: "high", value: 3 }] }
    });
    expect(runActiveCompiledQuery).toHaveBeenCalledWith(
      expect.objectContaining({ dialect: "duckdb", sql: expect.stringContaining("FROM v_ai_care_items") })
    );
  });

  it("returns grouped exercise counts when DuckDB supplies BigInt values", async () => {
    const { app, runActiveCompiledQuery } = queryApp([{ activity_type: "walking", count: 3n }]);
    planThenFailSummary({
      source: "activities",
      intent: "list_activities",
      metric: null,
      aggregation: "count",
      groupBy: null,
      timeRange: { start: "2026-08-01", end: "2026-08-31" },
      sort: "desc",
      limit: 1,
      chartType: "bar"
    });

    const response = await request(app).post("/api/query/ai").send({ question: "Top exercise this month" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      question: "Top exercise this month",
      sourceResolved: "activities",
      rows: [{ activity_type: "walking", count: 3 }]
    });
    expect(runActiveCompiledQuery).toHaveBeenCalledWith(
      expect.objectContaining({ dialect: "duckdb", sql: expect.stringContaining("COUNT(*) AS count") })
    );
  });
});

function queryApp(rows: Array<Record<string, unknown>>) {
  const runActiveCompiledQuery = vi.fn().mockResolvedValue(rows);
  const manager = {
    getActiveStore: () => ({
      getProfile: async () => ({
        id: "self",
        displayName: "Local user",
        units: "metric",
        updatedAt: "2026-07-01T00:00:00.000Z"
      })
    }),
    getStorageBackend: () => "duckdb",
    runActiveCompiledQuery
  } as unknown as ProfileStoreManager;
  const app = express();
  app.use(express.json());
  app.use("/api/query", makeQueryRoutes(manager));
  return { app, runActiveCompiledQuery };
}

function modelText(text: string) {
  return {
    ok: true,
    provider: "ollama",
    endpoint: "http://localhost",
    model: "test",
    timeoutMs: 100,
    elapsedMs: 1,
    text
  };
}

function metricPlan() {
  return {
    intent: "aggregation",
    metric: "heart_rate",
    aggregation: "avg",
    groupBy: null,
    timeRange: { preset: "last_30d" },
    sort: "desc",
    limit: 1,
    chartType: "none"
  };
}

function planThenFailSummary(plan: Record<string, unknown>) {
  callConfiguredModel
    .mockResolvedValueOnce({
      ok: true,
      provider: "ollama",
      endpoint: "http://localhost",
      model: "test",
      timeoutMs: 100,
      elapsedMs: 1,
      text: JSON.stringify(plan)
    })
    .mockResolvedValueOnce({
      ok: false,
      provider: "ollama",
      endpoint: "http://localhost",
      model: "test",
      timeoutMs: 100,
      elapsedMs: 1,
      error: "summary unavailable"
    });
}
