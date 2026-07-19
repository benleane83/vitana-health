import { beforeEach, describe, expect, it, vi } from "vitest";

const callConfiguredModel = vi.hoisted(() => vi.fn());

vi.mock("../modelClient.js", () => ({ callConfiguredModel }));

import { planAiQuery, QueryDSLSchema } from "../aiQueryPlanner.js";

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
