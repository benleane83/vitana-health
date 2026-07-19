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
    expect(runActiveCompiledQuery).toHaveBeenCalledWith(expect.stringContaining("FROM v_ai_health_events"));
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
    expect(runActiveCompiledQuery).toHaveBeenCalledWith(expect.stringContaining("FROM v_ai_care_items"));
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
    runActiveCompiledQuery
  } as unknown as ProfileStoreManager;
  const app = express();
  app.use(express.json());
  app.use("/api/query", makeQueryRoutes(manager));
  return { app, runActiveCompiledQuery };
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
