import { describe, expect, it } from "vitest";
import {
  analyticsSummaryResponseSchema,
  aiQueryRequestSchema,
  aiQueryTurnContextSchema,
  appBootstrapResponseSchema,
  bloodTestDraftResponseSchema,
  bodyCompositionDraftResponseSchema,
  careItemSchema,
  healthDataSummaryResponseSchema,
  healthEventSchema
} from "../apiContract.js";

/**
 * These guard the property that used to be missing: response schemas were `z.record(z.unknown())`
 * under the hood, so an empty object satisfied every one of them and drift went unnoticed.
 */
describe("response contracts", () => {
  it("accepts bounded AI Query context and rejects transcript fields", () => {
    const context = {
      version: 1,
      profileId: "self",
      source: "metrics",
      metric: "steps",
      intent: "aggregation",
      aggregation: "max",
      groupBy: null,
      sort: "desc",
      resolvedTimeRange: { start: "2026-07-01", end: "2026-07-31" }
    };

    expect(aiQueryRequestSchema.safeParse({ question: "Which day was that on?", context }).success).toBe(true);
    expect(aiQueryTurnContextSchema.safeParse({
      ...context,
      priorAnswer: "Your maximum was 12,345 steps.",
      sql: "SELECT * FROM private_data"
    }).success).toBe(false);
  });

  it("keeps blood-test and body-composition preview parser contracts distinct", () => {
    const draft = {
      fileName: "results.pdf",
      sourceText: "Glucose: 5.2 mmol/L",
      checksum: "checksum",
      parserVersion: "blood-test-text-v1",
      diagnostics: [],
      rows: []
    };

    expect(bloodTestDraftResponseSchema.safeParse(draft).success).toBe(true);
    expect(bodyCompositionDraftResponseSchema.safeParse(draft).success).toBe(false);
  });

  it("rejects an empty object as every major response", () => {
    for (const schema of [
      appBootstrapResponseSchema,
      analyticsSummaryResponseSchema,
      healthDataSummaryResponseSchema
    ]) {
      expect(schema.safeParse({}).success).toBe(false);
    }
  });

  it("rejects unknown fields rather than silently forwarding them", () => {
    const result = careItemSchema.safeParse({
      id: "care-1",
      kind: "follow-up",
      title: "Follow up",
      priority: "normal",
      status: "open",
      unexpected: true
    });
    expect(result.success).toBe(false);
  });

  it("rejects a care item whose kind is outside the taxonomy", () => {
    expect(careItemSchema.safeParse({
      id: "care-1",
      kind: "made-up",
      title: "Follow up",
      priority: "normal",
      status: "open"
    }).success).toBe(false);
  });

  it("ties health event details to the matching kind", () => {
    expect(healthEventSchema.safeParse({
      id: "event-1",
      kind: "immunization",
      status: "completed",
      occurredAt: "2026-07-25T14:00:00.000Z",
      source: "manual-entry",
      immunization: { vaccine: "flu" }
    }).success).toBe(true);

    expect(healthEventSchema.safeParse({
      id: "event-1",
      kind: "visit",
      status: "completed",
      occurredAt: "2026-07-25T14:00:00.000Z",
      source: "manual-entry",
      immunization: { vaccine: "flu" }
    }).success).toBe(false);
  });
});
