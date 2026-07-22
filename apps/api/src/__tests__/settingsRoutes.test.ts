import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { planAiQuery } = vi.hoisted(() => ({ planAiQuery: vi.fn() }));

vi.mock("../aiQueryPlanner.js", () => ({ planAiQuery }));

import { plannerEvaluationCases } from "../aiQueryEvaluation.js";
import { makeSettingsRoutes } from "../routes/settingsRoutes.js";

beforeEach(() => {
  planAiQuery.mockReset();
});

function settingsApp(
  desktopRuntimeController?: NonNullable<Parameters<typeof makeSettingsRoutes>[0]>["desktopRuntimeController"],
  desktopUpdaterController?: NonNullable<Parameters<typeof makeSettingsRoutes>[0]>["desktopUpdaterController"]
) {
  const app = express();
  app.use(express.json());
  app.use("/api/settings", makeSettingsRoutes({ desktopRuntimeController, desktopUpdaterController }));
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error && typeof error === "object" && "issues" in error) {
      response.status(400).json({ code: "VALIDATION_ERROR" });
      return;
    }
    response.status(500).json({ code: "INTERNAL_ERROR" });
  });

  return app;
}

describe("desktop update routes", () => {
  const state = { status: "idle" as const, currentVersion: "1.0.0", channel: "production" as const };

  it("reports unsupported development hosts and rejects commands", async () => {
    expect((await request(settingsApp()).get("/api/settings/updates")).body.status).toBe("unsupported");
    const result = await request(settingsApp()).post("/api/settings/updates/check");
    expect(result.status).toBe(501);
    expect(result.body.code).toBe("DESKTOP_UPDATES_UNSUPPORTED");
  });

  it("delegates each explicit update command", async () => {
    const controller = {
      getState: vi.fn(() => state),
      check: vi.fn(async () => ({ ...state, status: "checking" as const })),
      download: vi.fn(async () => ({ ...state, status: "downloading" as const })),
      restartToInstall: vi.fn(async () => ({ ...state, status: "downloaded" as const }))
    };
    expect((await request(settingsApp(undefined, controller)).get("/api/settings/updates")).body).toEqual(state);
    await request(settingsApp(undefined, controller)).post("/api/settings/updates/check");
    await request(settingsApp(undefined, controller)).post("/api/settings/updates/download");
    await request(settingsApp(undefined, controller)).post("/api/settings/updates/restart");
    expect(controller.check).toHaveBeenCalledOnce();
    expect(controller.download).toHaveBeenCalledOnce();
    expect(controller.restartToInstall).toHaveBeenCalledOnce();
  });
});

describe("desktop runtime settings routes", () => {
  it("reports unsupported hosts and rejects updates with a stable error", async () => {
    expect((await request(settingsApp()).get("/api/settings/desktop")).body).toEqual({
      supported: false,
      backgroundServiceEnabled: false
    });
    const update = await request(settingsApp()).put("/api/settings/desktop").send({ backgroundServiceEnabled: true });
    expect(update.status).toBe(501);
    expect(update.body.code).toBe("DESKTOP_RUNTIME_UNSUPPORTED");
  });

  it("delegates owner settings reads and strict updates", async () => {
    const controller = {
      getSettings: vi.fn().mockResolvedValue({ supported: true, backgroundServiceEnabled: false }),
      updateSettings: vi.fn().mockResolvedValue({ supported: true, backgroundServiceEnabled: true })
    };
    expect((await request(settingsApp(controller)).get("/api/settings/desktop")).body.backgroundServiceEnabled).toBe(false);
    const update = await request(settingsApp(controller))
      .put("/api/settings/desktop")
      .send({ backgroundServiceEnabled: true });
    expect(update.body.backgroundServiceEnabled).toBe(true);
    expect(controller.updateSettings).toHaveBeenCalledWith({ backgroundServiceEnabled: true });

    const invalid = await request(settingsApp(controller))
      .put("/api/settings/desktop")
      .send({ backgroundServiceEnabled: true, platform: "win32" });
    expect(invalid.status).toBe(400);
    expect(controller.updateSettings).toHaveBeenCalledOnce();
  });

  it("passes controller failures to the API error boundary", async () => {
    const controller = {
      getSettings: vi.fn().mockRejectedValue(new Error("failed")),
      updateSettings: vi.fn().mockRejectedValue(new Error("failed"))
    };
    expect((await request(settingsApp(controller)).get("/api/settings/desktop")).status).toBe(500);
    expect((await request(settingsApp(controller)).put("/api/settings/desktop")
      .send({ backgroundServiceEnabled: true })).status).toBe(500);
  });
});

describe("AI model compatibility validation", () => {
  it("reports compatible when the single planner probe passes", async () => {
    const testCase = plannerEvaluationCases.find((candidate) => candidate.probe)!;
    planAiQuery.mockResolvedValue({
      ok: true,
      dsl: {
        source: testCase.expected.source,
        intent: testCase.expected.intents![0],
        metric: testCase.expected.metric ?? null,
        aggregation: "avg",
        groupBy: testCase.expected.groupBy ?? null,
        timeRange: { preset: testCase.expected.timePreset ?? "last_30d" },
        sort: "desc",
        limit: 20,
        chartType: "none"
      },
      confidence: 1,
      limitations: [],
      assumptions: [],
      modelElapsedMs: 1,
      attempts: 1,
      repaired: false,
      structuredOutputMode: "enforced"
    });

    const response = await request(settingsApp()).post("/api/settings/ai/validate");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      compatibility: "compatible",
      plannerProbe: {
        passed: 1,
        total: 1,
        elapsedMs: 1,
        structuredOutputMode: "enforced"
      }
    });
    expect(planAiQuery).toHaveBeenCalledOnce();
    expect(planAiQuery).toHaveBeenCalledWith(testCase.question, {
      timeoutMs: 30000,
      maxAttempts: 1
    });
  });

  it("warns without blocking and reuses the cached planner probe", async () => {
    const probeCases = plannerEvaluationCases.filter((testCase) => testCase.probe);
    planAiQuery.mockImplementation(async (question: string) => {
      const index = probeCases.findIndex((testCase) => testCase.question === question);
      const testCase = probeCases[index];
      if (index < 2) {
        return {
          ok: false,
          error: "Unsupported test plan.",
          limitations: [],
          modelElapsedMs: 1,
          attempts: 1,
          repaired: false,
          category: "semantic",
          structuredOutputMode: "fallback"
        };
      }
      return {
        ok: true,
        dsl: {
          source: testCase.expected.source,
          intent: testCase.expected.intents![0],
          metric: testCase.expected.metric ?? null,
          aggregation: testCase.expected.intents![0] === "count" ? "count" : null,
          groupBy: testCase.expected.groupBy ?? null,
          timeRange: { preset: testCase.expected.timePreset ?? "last_30d" },
          sort: "desc",
          limit: 20,
          chartType: "none"
        },
        confidence: 1,
        limitations: [],
        assumptions: [],
        modelElapsedMs: 1,
        attempts: 1,
        repaired: false,
        structuredOutputMode: "enforced"
      };
    });

    const app = settingsApp();
    const first = await request(app).post("/api/settings/ai/validate");
    const second = await request(app).post("/api/settings/ai/validate");

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      ok: true,
      compatibility: "limited",
      plannerProbe: {
        passed: 0,
        total: 1,
        elapsedMs: 1,
        structuredOutputMode: "fallback"
      }
    });
    expect(second.status).toBe(200);
    expect(second.body.plannerProbe).toEqual(first.body.plannerProbe);
    expect(planAiQuery).toHaveBeenCalledOnce();
    expect(planAiQuery).toHaveBeenCalledWith(probeCases[0].question, {
      timeoutMs: 30000,
      maxAttempts: 1
    });
  });

  it("reports a transient model failure with a safe upstream reason", async () => {
    planAiQuery.mockResolvedValue({
      ok: false,
      error: "The model request failed.",
      limitations: [
        "Could not reach the configured model endpoint.",
        "Model error: Model endpoint returned HTTP 429"
      ],
      modelElapsedMs: 12,
      attempts: 1,
      repaired: false,
      category: "model",
      structuredOutputMode: "enforced"
    });

    const response = await request(settingsApp()).post("/api/settings/ai/validate");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: false,
      compatibility: "limited",
      plannerProbe: {
        passed: 0,
        total: 1,
        elapsedMs: 12,
        failureCategory: "model",
        issues: ["metric-average-heart-rate: Model error: Model endpoint returned HTTP 429"]
      }
    });
    expect(planAiQuery).toHaveBeenCalledOnce();
  });
});
