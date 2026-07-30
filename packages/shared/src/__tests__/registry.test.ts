import { describe, it, expect } from "vitest";
import {
  defaultMeasurementTypes
} from "../registry.js";
import {
  classifyValue,
  convertMeasurementValue,
  findMeasurementType,
  getPreferredUnit,
  getReferenceRange,
  resolveReferenceRange,
  normalizeMeasurementUnit
} from "../measurementRegistry.js";
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
    expect(classifyValue(0.8, hdl)).toBe("low");
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

  it("resolves personal ranges before adult catalog ranges and converts them", () => {
    const glucose = defaultMeasurementTypes.find((type) => type.code === "glucose")!;
    const personal = {
      measurementCode: "glucose", normalLow: 4, normalHigh: 6, optimalLow: 4.5, optimalHigh: 5.5,
      unit: "mmol/L", updatedAt: "2026-01-01T00:00:00.000Z"
    };
    expect(resolveReferenceRange(glucose, "mg/dL", personal, "adult")).toMatchObject({
      source: "personal",
      effective: { low: expect.any(Number), high: expect.any(Number), unit: "mg/dL" },
      catalog: expect.any(Object)
    });
    expect(resolveReferenceRange(glucose, "mmol/L", undefined, "adult").source).toBe("catalog");
    expect(resolveReferenceRange(glucose, "mmol/L", undefined, "child")).toEqual({ source: "none" });
    expect(resolveReferenceRange(glucose, "mmol/L", personal, "pet").source).toBe("personal");
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

  it("finds Health Connect activity codes by their canonical codes", () => {
    expect(findMeasurementType("activity_sessions")?.code).toBe("activity_sessions");
    expect(findMeasurementType("total_calories_burned")?.code).toBe("total_calories_burned");
  });
});

describe("defaultMeasurementTypes", () => {
  describe("catalog integrity", () => {
    const normalizeLookup = (value: string) => value.trim().toLowerCase().replaceAll("_", " ");

    it("has unique, non-empty measurement codes", () => {
      const codes = defaultMeasurementTypes.map((type) => type.code.trim());
      expect(codes.every(Boolean)).toBe(true);
      expect(new Set(codes.map(normalizeLookup)).size).toBe(codes.length);
    });

    it("has a plain-language description for every measurement type", () => {
      expect(defaultMeasurementTypes.every((type) => type.description.trim().length > 0)).toBe(true);
    });

    it("has non-empty aliases that resolve unambiguously to their owner", () => {
      const owners = new Map<string, Set<string>>();
      for (const type of defaultMeasurementTypes) {
        expect(type.aliases.length, `${type.code} has no aliases`).toBeGreaterThan(0);
        for (const alias of type.aliases) {
          expect(alias.trim(), `${type.code} has an empty alias`).not.toBe("");
          const normalized = normalizeLookup(alias);
          const aliasOwners = owners.get(normalized) ?? new Set<string>();
          aliasOwners.add(type.code);
          owners.set(normalized, aliasOwners);
          expect(findMeasurementType(alias)?.code, `${type.code} alias "${alias}" does not resolve to its owner`).toBe(type.code);
        }
      }
      expect([...owners.entries()].filter(([, aliasOwners]) => aliasOwners.size > 1)).toEqual([]);
    });

    it("supports every declared preferred-unit conversion in both directions", () => {
      for (const type of defaultMeasurementTypes) {
        for (const preferredUnit of Object.values(type.preferredUnits ?? {})) {
          expect(preferredUnit?.trim(), `${type.code} has an empty preferred unit`).not.toBe("");
          if (!preferredUnit || normalizeMeasurementUnit(type, preferredUnit) === normalizeMeasurementUnit(type, type.canonicalUnit)) continue;
          expect(convertMeasurementValue(1, type, type.canonicalUnit, preferredUnit), `${type.code}: ${type.canonicalUnit} -> ${preferredUnit}`).toEqual(expect.any(Number));
          expect(convertMeasurementValue(1, type, preferredUnit, type.canonicalUnit), `${type.code}: ${preferredUnit} -> ${type.canonicalUnit}`).toEqual(expect.any(Number));
        }
      }
    });

    it("has finite, ordered reference ranges in supported units", () => {
      for (const type of defaultMeasurementTypes) {
        for (const range of type.referenceRanges ?? []) {
          expect(range.unit.trim(), `${type.code} has an empty reference-range unit`).not.toBe("");
          if (range.low !== undefined) expect(Number.isFinite(range.low), `${type.code} has an invalid low bound`).toBe(true);
          if (range.high !== undefined) expect(Number.isFinite(range.high), `${type.code} has an invalid high bound`).toBe(true);
          if (range.low !== undefined && range.high !== undefined) expect(range.low, `${type.code} has an inverted reference range`).toBeLessThanOrEqual(range.high);
          const sameUnit = normalizeMeasurementUnit(type, range.unit) === normalizeMeasurementUnit(type, type.canonicalUnit);
          const supportsUnit = sameUnit || convertMeasurementValue(1, type, type.canonicalUnit, range.unit) !== undefined;
          expect(supportsUnit, `${type.code} reference range uses unsupported unit ${range.unit}`).toBe(true);
        }
      }
    });
  });

  it("uses EU/UK canonical units for common blood biomarkers", () => {
    expect(defaultMeasurementTypes.find((type) => type.code === "glucose")?.canonicalUnit).toBe("mmol/L");
    expect(defaultMeasurementTypes.find((type) => type.code === "hba1c")?.canonicalUnit).toBe("mmol/mol");
    expect(defaultMeasurementTypes.find((type) => type.code === "creatinine")?.canonicalUnit).toBe("µmol/L");
    expect(defaultMeasurementTypes.find((type) => type.code === "total_cholesterol")?.canonicalUnit).toBe("mmol/L");
  });

  it("includes sourced consensus ranges that are not demographic or assay dependent", () => {
    expect(defaultMeasurementTypes.find((type) => type.code === "respiratory_rate")?.referenceRanges).toEqual([
      expect.objectContaining({ low: 12, high: 20, unit: "breaths/min", source: expect.any(String) })
    ]);
    expect(defaultMeasurementTypes.find((type) => type.code === "potassium")?.referenceRanges).toEqual([
      expect.objectContaining({ low: 3.5, high: 5, unit: "mmol/L", source: expect.any(String) })
    ]);
    expect(defaultMeasurementTypes.find((type) => type.code === "sodium")?.referenceRanges).toEqual([
      expect.objectContaining({ low: 135, high: 145, unit: "mmol/L", source: expect.any(String) })
    ]);
  });

  it("is frozen so no consumer can corrupt the shared registry process-wide", () => {
    const weight = defaultMeasurementTypes.find((type) => type.code === "weight")!;
    expect(Object.isFrozen(defaultMeasurementTypes)).toBe(true);
    expect(Object.isFrozen(weight)).toBe(true);
    expect(() => {
      (weight as { display: string }).display = "Tampered";
    }).toThrow(TypeError);
    expect(() => defaultMeasurementTypes.push({ ...weight })).toThrow(TypeError);
    expect(defaultMeasurementTypes.find((type) => type.code === "weight")?.display).toBe(weight.display);
  });

  describe("measurement units", () => {
    const weight = defaultMeasurementTypes.find((type) => type.code === "weight")!;
    const glucose = defaultMeasurementTypes.find((type) => type.code === "glucose")!;

    it("selects profile-appropriate defaults without changing canonical storage units", () => {
      expect(weight.canonicalUnit).toBe("kg");
      expect(getPreferredUnit(weight, "metric")).toBe("kg");
      expect(getPreferredUnit(weight, "imperial")).toBe("lb");
      expect(getPreferredUnit(glucose, "imperial")).toBe("mg/dL");
    });

    it("converts supported units and accepts registered aliases", () => {
      expect(convertMeasurementValue(70, weight, "kg", "lbs")).toBeCloseTo(154.324, 3);
      expect(convertMeasurementValue(180, defaultMeasurementTypes.find((type) => type.code === "height")!, "cm", "inches")).toBeCloseTo(70.866, 3);
      expect(convertMeasurementValue(90, glucose, "mg/dL", "mmol/L")).toBeCloseTo(4.995, 3);
      expect(convertMeasurementValue(1, defaultMeasurementTypes.find((type) => type.code === "total_body_water")!, "L", "fl oz")).toBeCloseTo(33.814, 3);
    });

    it("does not convert unsupported units", () => {
      expect(convertMeasurementValue(70, weight, "kg", "stone")).toBeUndefined();
    });

    it("converts reference ranges before classifying values", () => {
      expect(getReferenceRange(glucose, "mg/dL")).toMatchObject({ low: expect.any(Number), high: expect.any(Number), unit: "mg/dL" });
      expect(classifyValue(180, glucose, "mg/dL")).toBe("high");
      expect(classifyValue(50, glucose, "mg/dL")).toBe("low");
    });
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
