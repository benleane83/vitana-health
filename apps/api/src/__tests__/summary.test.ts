import { describe, expect, it } from "vitest";
import { chartPointsForEntries } from "../summary.js";

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
