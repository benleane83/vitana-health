import { describe, expect, it } from "vitest";
import { canonicalizeMeasurement, describeMeasurementRejection } from "../measurementRegistry.js";

describe("canonicalizeMeasurement", () => {
  it("relabels alias units onto the canonical unit without changing the value", () => {
    expect(canonicalizeMeasurement("heart_rate", 62, "bpm")).toEqual({
      rejected: false,
      value: 62,
      unit: "beats/min"
    });
  });

  it("converts a convertible unit and records the source unit", () => {
    expect(canonicalizeMeasurement("haemoglobin", 14.5, "g/dL")).toEqual({
      rejected: false,
      value: 145,
      unit: "g/L",
      sourceUnit: "g/dL"
    });
  });

  it("passes custom entry codes through verbatim because they have no canonical unit", () => {
    expect(canonicalizeMeasurement("manual_grip_comfort", 7, "score")).toEqual({
      rejected: false,
      value: 7,
      unit: "score"
    });
    expect(canonicalizeMeasurement("body_comp_left_arm_lean", 3.2, "kg")).toEqual({
      rejected: false,
      value: 3.2,
      unit: "kg"
    });
  });

  it("rejects a known code carrying a unit it cannot convert", () => {
    const result = canonicalizeMeasurement("body_fat_pct", 22, "unknown");
    expect(result).toEqual({
      rejected: true,
      reason: "unconvertible-unit",
      code: "body_fat_pct",
      unit: "unknown"
    });
    expect(describeMeasurementRejection(result as Extract<typeof result, { rejected: true }>))
      .toContain("cannot be converted");
  });

  it("rejects non-finite values regardless of code", () => {
    expect(canonicalizeMeasurement("weight", Number.NaN, "kg")).toEqual({
      rejected: true,
      reason: "invalid-value",
      code: "weight",
      unit: "kg"
    });
    expect(canonicalizeMeasurement("manual_anything", Number.POSITIVE_INFINITY, "kg").rejected).toBe(true);
  });
});
