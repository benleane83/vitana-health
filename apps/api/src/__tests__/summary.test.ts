import { describe, expect, it } from "vitest";
import { chartPointsForEntries, summarizeMeasurementEntries } from "../summary.js";

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
});
