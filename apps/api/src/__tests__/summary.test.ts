import { describe, expect, it } from "vitest";
import type { HealthStoreData } from "@vitana/shared";
import { chartPointsForEntries, summarizeMeasurementEntries, summarizeStoreData } from "../summary.js";

describe("chartPointsForEntries", () => {
  it("preserves a measurement reference range for detail charts", () => {
    expect(chartPointsForEntries([{
      kind: "observation",
      id: "glucose-1",
      measurementCode: "glucose",
      displayName: "Glucose",
      timestamp: "2026-07-15T00:00:00.000Z",
      value: 5.2,
      unit: "mmol/L",
      referenceRange: { low: 3.9, high: 5.5, unit: "mmol/L" }
    }])).toEqual([{
      kind: "observation",
      timestamp: "2026-07-15T00:00:00.000Z",
      value: 5.2,
      unit: "mmol/L",
      referenceRange: { low: 3.9, high: 5.5, unit: "mmol/L" }
    }]);
  });
});

describe("summarizeMeasurementEntries", () => {
  it("includes the registered description in measurement detail responses", () => {
    const detail = summarizeMeasurementEntries("steps", {
      code: "steps",
      display: "Steps",
      description: "The number of steps you have taken.",
      category: "activity",
      kind: "interval",
      canonicalUnit: "count",
      aliases: [],
      aggregation: "sum"
    }, []);

    expect(detail.measurement.description).toBe("The number of steps you have taken.");
    expect(detail.measurement.aggregation).toBe("sum");
  });

  describe("summarizeStoreData", () => {
    it.each([
      ["body_composition_report", "body"],
      ["lab_panel", "lab"]
    ] as const)("categorizes an unregistered measurement from a %s group as %s", (kind, category) => {
      const store = {
        profile: { id: "self", displayName: "Test", units: "metric", updatedAt: "2026-01-01" },
        measurementTypes: [],
        observations: [{
          id: "custom-1",
          measurementCode: "manual_custom_score",
          observedAt: "2026-06-15T00:00:00.000Z",
          value: 7,
          unit: "points",
          sourceId: "source-1",
          observationGroupId: "group-1"
        }],
        observationGroups: [{ id: "group-1", kind, label: category === "body" ? "Body" : "Lab" }],
        timeSeriesSamples: [],
        measurementAggregates: [],
        activitySessions: []
      } as unknown as HealthStoreData;

      expect(summarizeStoreData(store).categories[0].key).toBe(category);
    });
  });
});
