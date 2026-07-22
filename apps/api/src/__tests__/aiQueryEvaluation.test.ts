import { describe, expect, it } from "vitest";
import { evaluatePlannerCase, plannerEvaluationCases } from "../aiQueryEvaluation.js";
import type { PlannerResult, QueryDSL } from "../aiQueryPlanner.js";

describe("AI query evaluation corpus", () => {
  it("scores semantic outcomes rather than byte-identical JSON", () => {
    const testCase = plannerEvaluationCases.find((entry) => entry.id === "metric-average-heart-rate")!;
    const outcome = successfulPlan({
      intent: "aggregation",
      metric: "heart_rate",
      aggregation: "avg",
      groupBy: null,
      timeRange: { preset: "last_month" },
      sort: "asc",
      limit: 20,
      chartType: null
    });

    expect(evaluatePlannerCase(testCase, outcome)).toEqual([]);
  });

  it("reports a semantically wrong but structurally valid plan", () => {
    const testCase = plannerEvaluationCases.find((entry) => entry.id === "metric-daily-steps")!;
    const outcome = successfulPlan({
      intent: "timeseries",
      metric: "heart_rate",
      aggregation: "avg",
      groupBy: "week",
      timeRange: { preset: "this_month" },
      sort: "asc",
      limit: 20,
      chartType: "line"
    });

    expect(evaluatePlannerCase(testCase, outcome)).toEqual([
      "Expected metric steps, got heart_rate.",
      "Expected group day, got week."
    ]);
  });
});

function successfulPlan(dsl: QueryDSL): PlannerResult {
  return {
    ok: true,
    dsl,
    confidence: 1,
    limitations: [],
    assumptions: [],
    modelElapsedMs: 1,
    attempts: 1,
    repaired: false,
    structuredOutputMode: "enforced"
  };
}
