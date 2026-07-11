import { describe, expect, it } from "vitest";
import { calculateBiologicalAge } from "../biologicalAge.js";
import { defaultMeasurementTypes } from "../registry.js";
import type { HealthStoreData } from "../types.js";

const values = {
  albumin: [43, "g/L"],
  creatinine: [88.4, "µmol/L"],
  glucose: [5.55, "mmol/L"],
  high_sensitivity_c_reactive_protein: [1, "mg/L"],
  lymphocyte_percentage: [30, "%"],
  mean_corpuscular_volume: [90, "fL"],
  red_cell_distribution_width: [13, "%"],
  alkaline_phosphatase: [70, "U/L"],
  white_blood_cell_count: [6, "×10⁹/L"]
} as const;

function makeStore(overrides: Partial<HealthStoreData> = {}): HealthStoreData {
  const groupId = "panel-1";
  return {
    schemaVersion: 2,
    profile: { id: "self", displayName: "Test", birthYear: 1976, units: "metric", updatedAt: "2026-01-01T00:00:00Z" },
    sourceImports: [],
    dataSources: [],
    devices: [],
    measurementTypes: defaultMeasurementTypes,
    observations: Object.entries(values).map(([measurementCode, [value, unit]]) => ({
      id: measurementCode, measurementCode, value, unit, observedAt: "2026-06-01T00:00:00Z", sourceId: "source", observationGroupId: groupId
    })),
    observationGroups: [{ id: groupId, kind: "lab_panel", label: "Complete panel", collectedAt: "2026-06-01T00:00:00Z" }],
    timeSeriesSamples: [],
    activitySessions: [],
    insights: [],
    auditEvents: [],
    ...overrides
  };
}

describe("calculateBiologicalAge", () => {
  it("calculates published PhenoAge with documented unit conversions", () => {
    const result = calculateBiologicalAge(makeStore(), "2026-06-02T00:00:00Z").models[0];
    expect(result.status).toBe("available");
    expect(result.chronologicalAge).toBe(50);
    expect(result.biologicalAge).toBeCloseTo(44.66, 2);
    expect(result.ageAcceleration).toBeCloseTo(-5.34, 2);
    expect(result.inputs.every((input) => input.status === "used")).toBe(true);
    expect(result.inputs.find((input) => input.code === "glucose")?.normalizedValue).toBeCloseTo(5.55, 3);
  });

  it("does not combine biomarkers from separate panels", () => {
    const store = makeStore();
    store.observations[0].observationGroupId = "other-panel";
    store.observationGroups.push({ id: "other-panel", kind: "lab_panel", label: "Other", collectedAt: "2026-06-02T00:00:00Z" });
    const result = calculateBiologicalAge(store).models[0];
    expect(result.status).toBe("incomplete");
    expect(result.inputs.find((input) => input.code === "albumin")?.status).toBe("used");
    expect(result.inputs.find((input) => input.code === "glucose")?.status).toBe("missing");
  });

  it("calls unsupported units invalid and requires a plausible adult chronological age", () => {
    const store = makeStore();
    store.profile.birthYear = 2020;
    store.observations.find((observation) => observation.measurementCode === "creatinine")!.unit = "mg/L";
    const result = calculateBiologicalAge(store).models[0];
    expect(result.status).toBe("incomplete");
    expect(result.chronologicalAge).toBeUndefined();
    expect(result.inputs.find((input) => input.code === "creatinine")?.status).toBe("invalid");
  });

  it("reports Bortz Age as intentionally unavailable", () => {
    expect(calculateBiologicalAge(makeStore()).models[1]).toMatchObject({
      id: "bortz-age-2023",
      status: "not-implemented"
    });
  });
});
