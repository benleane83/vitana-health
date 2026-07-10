import { describe, it, expect } from "vitest";
import { computeAnalytics } from "../analytics.js";
import type { HealthStoreData, Observation, LabResultMarker, MeasurementType } from "../types.js";
import { defaultMeasurementTypes } from "../registry.js";

function makeEmptyStore(): HealthStoreData {
  return {
    profile: { id: "self", displayName: "Test", units: "metric", updatedAt: "2026-01-01T00:00:00.000Z" },
    sourceImports: [],
    dataSources: [],
    devices: [],
    measurementTypes: defaultMeasurementTypes,
    observations: [],
    timeSeriesSamples: [],
    activitySessions: [],
    sleepSessions: [],
    sleepStageIntervals: [],
    labPanels: [],
    labMarkers: [],
    insights: [],
    auditEvents: []
  };
}

function makeObservation(overrides: Partial<Observation> & Pick<Observation, "id" | "measurementCode" | "observedAt" | "value" | "unit" | "sourceId">): Observation {
  return { ...overrides };
}

describe("computeAnalytics — counts", () => {
  it("returns zero counts for empty store", () => {
    const result = computeAnalytics(makeEmptyStore());
    expect(result.counts).toEqual({
      imports: 0,
      observations: 0,
      samples: 0,
      activities: 0,
      labMarkers: 0,
      insights: 0
    });
  });

  it("counts source imports and observations", () => {
    const store = makeEmptyStore();
    store.sourceImports = [
      { id: "s1", sourceKind: "samsung-health", fileName: "f.csv", importedAt: "2026-01-01T00:00:00.000Z", parserVersion: "v1", checksum: "abc", rowCount: 2, status: "processed", diagnostics: [] }
    ];
    store.observations = [
      makeObservation({ id: "o1", measurementCode: "heart_rate", observedAt: "2026-01-01T00:00:00.000Z", value: 72, unit: "bpm", sourceId: "src1" }),
      makeObservation({ id: "o2", measurementCode: "weight", observedAt: "2026-01-02T00:00:00.000Z", value: 80, unit: "kg", sourceId: "src1" })
    ];
    const result = computeAnalytics(store);
    expect(result.counts.imports).toBe(1);
    expect(result.counts.observations).toBe(2);
  });
});

describe("computeAnalytics — latestMetrics", () => {
  it("returns the most recent observation per code, sorted newest-first", () => {
    const store = makeEmptyStore();
    store.observations = [
      makeObservation({ id: "o1", measurementCode: "heart_rate", observedAt: "2026-01-01T00:00:00.000Z", value: 65, unit: "bpm", sourceId: "src1" }),
      makeObservation({ id: "o2", measurementCode: "heart_rate", observedAt: "2026-02-01T00:00:00.000Z", value: 70, unit: "bpm", sourceId: "src1" }),
      makeObservation({ id: "o3", measurementCode: "weight", observedAt: "2026-01-15T00:00:00.000Z", value: 82, unit: "kg", sourceId: "src1" })
    ];
    const result = computeAnalytics(store);
    const hrMetric = result.latestMetrics.find((m) => m.code === "heart_rate");
    expect(hrMetric).toBeDefined();
    expect(hrMetric?.value).toBe(70);
    // sorted newest-first: heart_rate is 2026-02, weight is 2026-01
    expect(result.latestMetrics[0].code).toBe("heart_rate");
  });

  it("classifies status correctly for heart_rate", () => {
    const store = makeEmptyStore();
    store.observations = [
      makeObservation({ id: "o1", measurementCode: "heart_rate", observedAt: "2026-01-01T00:00:00.000Z", value: 110, unit: "bpm", sourceId: "src1" })
    ];
    const result = computeAnalytics(store);
    const hrMetric = result.latestMetrics.find((m) => m.code === "heart_rate");
    expect(hrMetric?.status).toBe("high");
  });
});

describe("computeAnalytics — trendCards", () => {
  it("returns 'up' direction when latest value is higher than first", () => {
    const store = makeEmptyStore();
    store.observations = [
      makeObservation({ id: "o1", measurementCode: "weight", observedAt: "2026-01-01T00:00:00.000Z", value: 78, unit: "kg", sourceId: "src1" }),
      makeObservation({ id: "o2", measurementCode: "weight", observedAt: "2026-01-15T00:00:00.000Z", value: 82, unit: "kg", sourceId: "src1" })
    ];
    const result = computeAnalytics(store);
    const card = result.trendCards.find((c) => c.code === "weight");
    expect(card?.direction).toBe("up");
  });

  it("returns 'down' direction when latest value is lower than first", () => {
    const store = makeEmptyStore();
    store.observations = [
      makeObservation({ id: "o1", measurementCode: "weight", observedAt: "2026-01-01T00:00:00.000Z", value: 85, unit: "kg", sourceId: "src1" }),
      makeObservation({ id: "o2", measurementCode: "weight", observedAt: "2026-01-15T00:00:00.000Z", value: 80, unit: "kg", sourceId: "src1" })
    ];
    const result = computeAnalytics(store);
    const card = result.trendCards.find((c) => c.code === "weight");
    expect(card?.direction).toBe("down");
  });

  it("does not generate a trend card with only one observation", () => {
    const store = makeEmptyStore();
    store.observations = [
      makeObservation({ id: "o1", measurementCode: "weight", observedAt: "2026-01-01T00:00:00.000Z", value: 80, unit: "kg", sourceId: "src1" })
    ];
    const result = computeAnalytics(store);
    expect(result.trendCards.find((c) => c.code === "weight")).toBeUndefined();
  });
});

describe("computeAnalytics — labAlerts", () => {
  it("includes only markers with non-normal flags", () => {
    const store = makeEmptyStore();
    store.labMarkers = [
      { id: "m1", panelId: "p1", measurementCode: "glucose", displayName: "Glucose", value: 120, unit: "mg/dL", flag: "high" },
      { id: "m2", panelId: "p1", measurementCode: "total_cholesterol", displayName: "Total Cholesterol", value: 185, unit: "mg/dL", flag: "normal" },
      { id: "m3", panelId: "p1", measurementCode: "hdl_cholesterol", displayName: "HDL", value: 30, unit: "mg/dL", flag: "low" }
    ] as LabResultMarker[];
    const result = computeAnalytics(store);
    expect(result.labAlerts).toHaveLength(2);
    expect(result.labAlerts.map((a) => a.flag)).toContain("high");
    expect(result.labAlerts.map((a) => a.flag)).toContain("low");
  });

  it("excludes markers with 'normal' flag", () => {
    const store = makeEmptyStore();
    store.labMarkers = [
      { id: "m1", panelId: "p1", measurementCode: "glucose", displayName: "Glucose", value: 85, unit: "mg/dL", flag: "normal" }
    ] as LabResultMarker[];
    const result = computeAnalytics(store);
    expect(result.labAlerts).toHaveLength(0);
  });
});

describe("computeAnalytics — evidenceDigest", () => {
  it("mentions import and observation counts", () => {
    const store = makeEmptyStore();
    store.sourceImports = [
      { id: "s1", sourceKind: "samsung-health", fileName: "f.csv", importedAt: "2026-01-01T00:00:00.000Z", parserVersion: "v1", checksum: "abc", rowCount: 1, status: "processed", diagnostics: [] }
    ];
    store.observations = [
      makeObservation({ id: "o1", measurementCode: "heart_rate", observedAt: "2026-01-01T00:00:00.000Z", value: 72, unit: "bpm", sourceId: "src1" })
    ];
    const result = computeAnalytics(store);
    expect(result.evidenceDigest[0]).toMatch(/1 source file/);
    expect(result.evidenceDigest[0]).toMatch(/1 observation/);
  });

  it("notes no lab markers out of range when all markers are normal", () => {
    const result = computeAnalytics(makeEmptyStore());
    expect(result.evidenceDigest[2]).toMatch(/No lab markers are outside/);
  });
});
