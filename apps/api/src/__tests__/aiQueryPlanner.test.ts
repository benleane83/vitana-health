import { beforeEach, describe, expect, it, vi } from "vitest";

const callConfiguredModel = vi.hoisted(() => vi.fn());

vi.mock("../modelClient.js", () => ({ callConfiguredModel }));

import {
  planAiQuery,
  QUERY_DSL_JSON_SCHEMA,
  QueryDSLSchema,
  resolveTimeRange,
  validateQueryDslSemantics
} from "../aiQueryPlanner.js";

beforeEach(() => {
  callConfiguredModel.mockReset();
});

describe("AI query planner domain sources", () => {
  it("accepts a health event source and typed filters from the planner", async () => {
    callConfiguredModel.mockResolvedValue({
      ok: true,
      provider: "ollama",
      endpoint: "http://localhost",
      model: "test",
      timeoutMs: 100,
      elapsedMs: 2,
      text: JSON.stringify({
        source: "health_events",
        intent: "count",
        metric: null,
        aggregation: "count",
        groupBy: "kind",
        timeRange: { preset: "last_90d" },
        sort: "desc",
        limit: 20,
        chartType: "bar",
        filters: { status: "completed", source: "manual-entry" }
      })
    });

    const result = await planAiQuery("How many completed health events were entered manually?");

    expect(result).toMatchObject({
      ok: true,
      dsl: {
        source: "health_events",
        intent: "count",
        groupBy: "kind",
        filters: { status: "completed", source: "manual-entry" }
      }
    });
    expect(callConfiguredModel.mock.calls[0][0]).toContain('source="health_events"');
  });

  it("rejects invalid source-specific filter enum values", () => {
    expect(QueryDSLSchema.safeParse({
      source: "care_items",
      intent: "count",
      metric: null,
      aggregation: "count",
      groupBy: "priority",
      timeRange: { preset: "last_30d" },
      sort: "desc",
      limit: 20,
      chartType: "bar",
      filters: { priority: "urgent" }
    }).success).toBe(false);
  });
});

describe("AI query planner reliability contract", () => {
  it("uses the JSON Schema subset supported by Foundry structured outputs", () => {
    const schema = JSON.stringify(QUERY_DSL_JSON_SCHEMA);

    for (const keyword of ["$schema", "format", "maxLength", "maximum", "minLength", "minimum", "multipleOf", "pattern"]) {
      expect(schema).not.toContain(`"${keyword}"`);
    }
  });

  it("normalizes strict-output null placeholders before runtime validation", async () => {
    callConfiguredModel.mockResolvedValue(modelResponse({
      source: null,
      intent: "aggregation",
      metric: "heart_rate",
      aggregation: "avg",
      groupBy: null,
      timeRange: { preset: "last_month", start: null, end: null },
      sort: "desc",
      limit: 1,
      chartType: "none",
      filters: {
        kind: null,
        status: null,
        source: null,
        provider: null,
        priority: null,
        code: null,
        completion: null,
        dueWithinRange: null
      }
    }));

    const result = await planAiQuery("What was my average heart rate last month?");

    expect(result).toMatchObject({
      ok: true,
      dsl: {
        intent: "aggregation",
        metric: "heart_rate",
        timeRange: { preset: "last_month" }
      },
      attempts: 1,
      repaired: false
    });
  });

  it("uses the documented 30-day default time range", () => {
    expect(resolveTimeRange({}, new Date("2026-07-22T12:00:00.000Z"))).toEqual({
      start: "2026-06-22",
      end: "2026-07-22",
      label: "last 30 days"
    });
  });

  it("rejects unknown metrics before compilation", () => {
    const result = validateQueryDslSemantics({
      intent: "aggregation",
      metric: "resting_pulse",
      aggregation: "avg",
      groupBy: null,
      timeRange: { preset: "last_30d" },
      sort: "desc",
      limit: 1,
      chartType: "none"
    });

    expect(result).toEqual({
      valid: false,
      issues: ['Metric "resting_pulse" is not supported.']
    });
  });

  it("repairs a semantically invalid plan exactly once", async () => {
    callConfiguredModel
      .mockResolvedValueOnce(modelResponse({
        intent: "aggregation",
        metric: "resting_pulse",
        aggregation: "avg",
        groupBy: null,
        timeRange: { preset: "last_30d" },
        sort: "desc",
        limit: 1,
        chartType: "none"
      }))
      .mockResolvedValueOnce(modelResponse({
        intent: "aggregation",
        metric: "heart_rate",
        aggregation: "avg",
        groupBy: null,
        timeRange: { preset: "last_30d" },
        sort: "desc",
        limit: 1,
        chartType: "none"
      }));

    const result = await planAiQuery("average heart rate in the last 30 days");

    expect(result).toMatchObject({
      ok: true,
      dsl: { metric: "heart_rate" },
      attempts: 2,
      repaired: true
    });
    expect(callConfiguredModel).toHaveBeenCalledTimes(2);
    expect(callConfiguredModel.mock.calls[1][0]).toContain('Metric "resting_pulse" is not supported.');
  });

  it("repairs to a compiler-compatible plan within the same two-call budget", async () => {
    const invalidPlan = {
      intent: "aggregation",
      metric: "heart_rate",
      aggregation: "avg",
      groupBy: null,
      timeRange: { preset: "last_30d" },
      sort: "desc",
      limit: 1,
      chartType: "none"
    };
    callConfiguredModel
      .mockResolvedValueOnce(modelResponse(invalidPlan))
      .mockResolvedValueOnce(modelResponse(invalidPlan));

    const result = await planAiQuery("average heart rate", {
      validatePlan: () => ["Compiler rejected this plan."]
    });

    expect(result).toMatchObject({
      ok: false,
      category: "compile",
      attempts: 2,
      repaired: true
    });
    expect(callConfiguredModel).toHaveBeenCalledTimes(2);
  });
});

function modelResponse(plan: Record<string, unknown>) {
  return {
    ok: true,
    provider: "ollama",
    endpoint: "http://localhost",
    model: "test",
    timeoutMs: 100,
    elapsedMs: 2,
    text: JSON.stringify(plan)
  };
}
