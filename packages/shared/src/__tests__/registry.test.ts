import { describe, it, expect } from "vitest";
import { classifyValue, findMeasurementType, defaultMeasurementTypes } from "../registry.js";
import type { MeasurementType } from "../types.js";

describe("classifyValue", () => {
  const heartRate = defaultMeasurementTypes.find((t) => t.code === "heart_rate")!;
  const steps = defaultMeasurementTypes.find((t) => t.code === "steps")!;
  const glucose = defaultMeasurementTypes.find((t) => t.code === "glucose")!;
  const hdl = defaultMeasurementTypes.find((t) => t.code === "hdl_cholesterol")!;

  it("returns 'low' when value is below normalLow", () => {
    expect(classifyValue(45, heartRate)).toBe("low");
    expect(classifyValue(3.5, glucose)).toBe("low");
  });

  it("returns 'high' when value is above normalHigh", () => {
    expect(classifyValue(110, heartRate)).toBe("high");
    expect(classifyValue(6, glucose)).toBe("high");
  });

  it("returns 'normal' when value is within bounds", () => {
    expect(classifyValue(70, heartRate)).toBe("normal");
    expect(classifyValue(4.7, glucose)).toBe("normal");
  });

  it("returns 'normal' when only normalHigh is set and value is within bounds (hdl)", () => {
    // hdl_cholesterol only has normalLow (40), no normalHigh
    expect(classifyValue(50, hdl)).toBe("normal");
  });

  it("returns 'low' when only normalLow is set and value is below it", () => {
    expect(classifyValue(30, hdl)).toBe("low");
  });

  it("returns 'unknown' when neither normalLow nor normalHigh is set", () => {
    // steps has no normal bounds
    expect(classifyValue(5000, steps)).toBe("unknown");
  });

  it("accepts explicit low/high overrides", () => {
    const custom: MeasurementType = {
      ...heartRate,
      normalLow: undefined,
      normalHigh: undefined
    };
    expect(classifyValue(70, custom, 60, 80)).toBe("normal");
    expect(classifyValue(50, custom, 60, 80)).toBe("low");
    expect(classifyValue(90, custom, 60, 80)).toBe("high");
  });

  it("handles value exactly at boundary as normal", () => {
    // normalLow=50, normalHigh=100 for heart_rate
    expect(classifyValue(50, heartRate)).toBe("normal");
    expect(classifyValue(100, heartRate)).toBe("normal");
  });
});

describe("findMeasurementType", () => {
  it("finds by exact code", () => {
    const result = findMeasurementType("heart_rate");
    expect(result?.code).toBe("heart_rate");
  });

  it("finds by alias", () => {
    const result = findMeasurementType("pulse");
    expect(result?.code).toBe("heart_rate");
  });

  it("is case-insensitive", () => {
    expect(findMeasurementType("Heart Rate")?.code).toBe("heart_rate");
    expect(findMeasurementType("STEPS")?.code).toBe("steps");
  });

  it("normalises underscores to spaces", () => {
    expect(findMeasurementType("heart_rate")?.code).toBe("heart_rate");
    expect(findMeasurementType("heart rate")?.code).toBe("heart_rate");
  });

  it("does not resolve retired Samsung-prefixed alias", () => {
    expect(findMeasurementType("com.samsung.health.step_count")).toBeUndefined();
  });

  it("returns undefined for unknown input", () => {
    expect(findMeasurementType("definitely_not_a_metric")).toBeUndefined();
    expect(findMeasurementType("")).toBeUndefined();
  });

  it("finds glucose by LOINC-style alias", () => {
    expect(findMeasurementType("blood glucose")?.code).toBe("glucose");
  });
});

describe("defaultMeasurementTypes", () => {
  it("uses EU/UK canonical units for common blood biomarkers", () => {
    expect(defaultMeasurementTypes.find((type) => type.code === "glucose")?.canonicalUnit).toBe("mmol/L");
    expect(defaultMeasurementTypes.find((type) => type.code === "hba1c")?.canonicalUnit).toBe("mmol/mol");
    expect(defaultMeasurementTypes.find((type) => type.code === "creatinine")?.canonicalUnit).toBe("µmol/L");
    expect(defaultMeasurementTypes.find((type) => type.code === "total_cholesterol")?.canonicalUnit).toBe("mmol/L");
  });

  it("includes Open mHealth, body composition, and biological-age measurements", () => {
    for (const code of [
      "height",
      "blood_pressure_systolic",
      "rr_interval",
      "intracellular_water",
      "bone_mineral_density",
      "albumin",
      "lymphocyte_percentage",
      "estimated_glomerular_filtration_rate",
      "forced_expiratory_volume_1",
      "grip_strength"
    ]) {
      expect(defaultMeasurementTypes.some((type) => type.code === code)).toBe(true);
    }
  });
});
