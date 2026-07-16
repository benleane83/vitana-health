import { describe, it, expect } from "vitest";
import { computeAnalytics } from "../analytics.js";
import type { HealthStoreData, Observation, MeasurementType } from "../types.js";
import { defaultMeasurementTypes } from "../registry.js";

function makeEmptyStore(): HealthStoreData {
  return {
    schemaVersion: 2,
    profile: { id: "self", displayName: "Test", units: "metric", updatedAt: "2026-01-01T00:00:00.000Z" },
    sourceImports: [],
    dataSources: [],
    devices: [],
    measurementTypes: defaultMeasurementTypes,
    observations: [],
    observationGroups: [],
    timeSeriesSamples: [],
    activitySessions: [],
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
      insights: 0
    });
  });

  it("counts source imports and observations", () => {
    const store = makeEmptyStore();
    store.sourceImports = [
      { id: "s1", sourceKind: "manual-entry", fileName: "f.csv", importedAt: "2026-01-01T00:00:00.000Z", parserVersion: "v1", checksum: "abc", rowCount: 2, status: "processed", diagnostics: [] }
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
      makeObservation({ id: "o1", measurementCode: "heart_rate", observedAt: "2026-01-01T00:00:00.000Z", value: 110, unit: "beats/min", sourceId: "src1" })
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
  it("includes only observations outside matching metadata ranges", () => {
    const store = makeEmptyStore();
    store.observations = [
      makeObservation({ id: "m1", measurementCode: "glucose", observedAt: "2026-01-01T00:00:00.000Z", value: 6.2, unit: "mmol/L", sourceId: "source" }),
      makeObservation({ id: "m2", measurementCode: "total_cholesterol", observedAt: "2026-01-01T00:00:00.000Z", value: 4.8, unit: "mmol/L", sourceId: "source" }),
      makeObservation({ id: "m3", measurementCode: "hdl_cholesterol", observedAt: "2026-01-01T00:00:00.000Z", value: 0.8, unit: "mmol/L", sourceId: "source" })
    ];
    const result = computeAnalytics(store);
    expect(result.labAlerts).toHaveLength(2);
    expect(result.labAlerts.map((alert) => alert.code)).toEqual(expect.arrayContaining(["glucose", "hdl_cholesterol"]));
    expect(result.labAlerts.map((a) => a.flag)).toContain("high");
    expect(result.labAlerts.map((a) => a.flag)).toContain("low");
  });

  it("classifies mismatched units after conversion", () => {
    const store = makeEmptyStore();
    store.observations = [
      makeObservation({ id: "m1", measurementCode: "glucose", observedAt: "2026-01-01T00:00:00.000Z", value: 180, unit: "mg/dL", sourceId: "source" })
    ];
    const result = computeAnalytics(store);
    expect(result.labAlerts).toMatchObject([{ unit: "mmol/L", flag: "high", observedAt: "2026-01-01T00:00:00.000Z" }]);
    expect(result.labAlerts[0].value).toBeCloseTo(9.99, 2);
  });

  it("uses only the latest observation for each current lab alert", () => {
    const store = makeEmptyStore();
    store.observations = [
      makeObservation({ id: "old", measurementCode: "glucose", observedAt: "2026-01-01T00:00:00.000Z", value: 8, unit: "mmol/L", sourceId: "source" }),
      makeObservation({ id: "new", measurementCode: "glucose", observedAt: "2026-02-01T00:00:00.000Z", value: 5, unit: "mmol/L", sourceId: "source" })
    ];

    expect(computeAnalytics(store).labAlerts).toEqual([]);
  });

  it.each(["child", "pet"] as const)("suppresses adult reference classifications for %s profiles", (subjectKind) => {
    const store = makeEmptyStore();
    store.profile.subjectKind = subjectKind;
    store.observations = [
      makeObservation({ id: "lab", measurementCode: "glucose", observedAt: "2026-01-01T00:00:00.000Z", value: 8, unit: "mmol/L", sourceId: "source" })
    ];

    const result = computeAnalytics(store);
    expect(result.labAlerts).toEqual([]);
    expect(result.latestMetrics.find((metric) => metric.code === "glucose")?.status).toBe("unknown");
  });

  it("displays mixed-unit trends in the active profile's preferred unit", () => {
    const store = makeEmptyStore();
    store.profile.units = "imperial";
    store.observations = [
      makeObservation({ id: "w1", measurementCode: "weight", observedAt: "2026-01-01T00:00:00.000Z", value: 70, unit: "kg", sourceId: "source" }),
      makeObservation({ id: "w2", measurementCode: "weight", observedAt: "2026-01-02T00:00:00.000Z", value: 154.324, unit: "lb", sourceId: "source" })
    ];
    const result = computeAnalytics(store);
    const trend = result.trendCards.find((card) => card.code === "weight");
    expect(trend?.unit).toBe("lb");
    expect(trend?.points[0].value).toBeCloseTo(trend?.points[1].value ?? 0, 2);
  });
});

describe("computeAnalytics — evidenceDigest", () => {
  it("mentions import and observation counts", () => {
    const store = makeEmptyStore();
    store.sourceImports = [
      { id: "s1", sourceKind: "manual-entry", fileName: "f.csv", importedAt: "2026-01-01T00:00:00.000Z", parserVersion: "v1", checksum: "abc", rowCount: 1, status: "processed", diagnostics: [] }
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
