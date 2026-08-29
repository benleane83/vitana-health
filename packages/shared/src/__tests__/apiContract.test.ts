import { describe, expect, it } from "vitest";
import {
  analyticsSummaryResponseSchema,
  aiQueryRequestSchema,
  aiQueryTurnContextSchema,
  appBootstrapResponseSchema,
  bloodTestDraftResponseSchema,
  bodyCompositionDraftResponseSchema,
  calendarMonthQuerySchema,
  calendarMonthResponseSchema,
  careItemSchema,
  createMedicationInputSchema,
  healthDataSummaryResponseSchema,
  healthEventSchema,
  medicationListQuerySchema,
  medicationSchema,
  personalReferenceRangeInputSchema
} from "../apiContract.js";

/**
 * These guard the property that used to be missing: response schemas were `z.record(z.unknown())`
 * under the hood, so an empty object satisfied every one of them and drift went unnoticed.
 */
describe("response contracts", () => {
  it("validates tri-state optimal reference-range inputs", () => {
    for (const input of [
      { low: 4, high: 6, unit: "mmol/L" },
      { low: 4, high: 6, optimalLow: 4.5, optimalHigh: 5.5, unit: "mmol/L" },
      { low: 4, high: 6, optimalLow: null, optimalHigh: null, unit: "mmol/L" }
    ]) {
      expect(personalReferenceRangeInputSchema.safeParse(input).success).toBe(true);
    }

    for (const input of [
      { low: 4, high: 6, optimalLow: 4.5, unit: "mmol/L" },
      { low: 4, high: 6, optimalLow: null, optimalHigh: 5.5, unit: "mmol/L" },
      { low: 4, optimalLow: 4.5, optimalHigh: 5.5, unit: "mmol/L" },
      { low: 4, high: 6, optimalLow: 5.5, optimalHigh: 4.5, unit: "mmol/L" },
      { low: 4, high: 6, optimalLow: 3.5, optimalHigh: 5.5, unit: "mmol/L" }
    ]) {
      expect(personalReferenceRangeInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it("validates bounded calendar month requests", () => {
    expect(calendarMonthQuerySchema.parse({
      month: "2026-08",
      timezone: "Australia/Sydney",
      measurementCodes: "steps,weight"
    }).measurementCodes).toEqual(["steps", "weight"]);

    for (const input of [
      { month: "2026-8", timezone: "UTC", measurementCodes: ["steps"] },
      { month: "2026-13", timezone: "UTC", measurementCodes: ["steps"] },
      { month: "2026-08", timezone: "Not/A_Zone", measurementCodes: ["steps"] },
      { month: "2026-08", timezone: "UTC", measurementCodes: ["steps", "steps"] },
      { month: "2026-08", timezone: "UTC", measurementCodes: ["a", "b", "c", "d"] }
    ]) {
      expect(calendarMonthQuerySchema.safeParse(input).success).toBe(false);
    }
  });

  it("validates sparse calendar month responses", () => {
    expect(calendarMonthResponseSchema.safeParse({
      month: "2026-08",
      timezone: "UTC",
      measurements: [{
        date: "2026-08-04",
        measurementCode: "steps",
        value: 1234,
        unit: "count",
        count: 2,
        min: 500,
        max: 734,
        aggregation: "sum",
        sources: ["Health Connect"]
      }],
      events: [{ date: "2026-08-04", count: 2, kinds: ["visit", "procedure"] }]
    }).success).toBe(true);
    expect(calendarMonthResponseSchema.safeParse({
      month: "2026-08",
      timezone: "UTC",
      measurements: [],
      events: [],
      notes: "must not leak detail"
    }).success).toBe(false);
  });

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
      kind: "visit",
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

  it("keeps removed medication fields out of records, mutations, and list queries", () => {
    const medication = {
      id: "medication-1",
      name: "Metformin",
      activeIngredient: "Metformin hydrochloride",
      dose: 500,
      unit: "mg",
      startDate: "2026-01-10",
      createdAt: "2026-01-10T08:00:00.000Z",
      updatedAt: "2026-01-10T08:00:00.000Z"
    };

    expect(medicationSchema.safeParse(medication).success).toBe(true);
    expect(createMedicationInputSchema.safeParse({
      name: medication.name,
      activeIngredient: medication.activeIngredient,
      dose: medication.dose,
      unit: medication.unit
    }).success).toBe(true);
    expect(createMedicationInputSchema.safeParse({
      name: medication.name
    }).success).toBe(true);
    expect(createMedicationInputSchema.safeParse({
      name: medication.name,
      dose: medication.dose,
      unit: medication.unit,
      endDate: "2026-01-09"
    }).success).toBe(true);
    expect(createMedicationInputSchema.safeParse({
      name: medication.name,
      dose: medication.dose,
      unit: medication.unit,
      startDate: "2026-01-10",
      endDate: "2026-01-09"
    }).success).toBe(false);

    for (const retiredField of ["route", "schedule", "prescriber", "reason", "status"] as const) {
      expect(medicationSchema.safeParse({ ...medication, [retiredField]: "removed" }).success).toBe(false);
      expect(createMedicationInputSchema.safeParse({
        name: medication.name,
        dose: medication.dose,
        unit: medication.unit,
        startDate: medication.startDate,
        [retiredField]: "removed"
      }).success).toBe(false);
    }
    expect(medicationListQuerySchema.safeParse({ status: "active" }).success).toBe(false);
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
