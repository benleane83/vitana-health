import { describe, it, expect } from "vitest";
import { analyticsCountsFromStore, computeAnalytics } from "../analytics.js";
import type { HealthStoreData, Observation, MeasurementType } from "../types.js";
import { defaultMeasurementTypes } from "../registry.js";

const analyticsOf = (store: HealthStoreData) =>
  computeAnalytics({ ...store, counts: analyticsCountsFromStore(store) });

function makeEmptyStore(): HealthStoreData {
  return {
    schemaVersion: 2,
    profile: { id: "self", displayName: "Test", units: "metric", updatedAt: "2026-01-01T00:00:00.000Z" },
    sourceImports: [],
    dataSources: [],
    devices: [],
    measurementTypes: defaultMeasurementTypes,
    personalReferenceRanges: [],
    pinnedMeasurements: [],
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
    const result = analyticsOf(makeEmptyStore());
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
    const result = analyticsOf(store);
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
    const result = analyticsOf(store);
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
    const result = analyticsOf(store);
    const hrMetric = result.latestMetrics.find((m) => m.code === "heart_rate");
    expect(hrMetric?.status).toBe("high");
  });

  it("keeps every latest observation available for AI insight generation", () => {
    const store = makeEmptyStore();
    const measurementTypes = defaultMeasurementTypes.slice(0, 13);
    store.measurementTypes = measurementTypes;
    store.observations = measurementTypes.map((type, index) => makeObservation({
      id: `o${index}`,
      measurementCode: type.code,
      observedAt: "2026-01-01T00:00:00.000Z",
      value: index + 1,
      unit: type.canonicalUnit,
      sourceId: "src1"
    }));

    const result = analyticsOf(store);
    expect(result.latestMetrics).toHaveLength(12);
    expect(result.latestMetricsForInsight).toHaveLength(13);
  });

  it("places all pinned metrics first without changing insight recency", () => {
    const store = makeEmptyStore();
    const measurementTypes = defaultMeasurementTypes.slice(0, 14);
    store.measurementTypes = measurementTypes;
    store.observations = measurementTypes.map((type, index) => makeObservation({
      id: `o${index}`,
      measurementCode: type.code,
      observedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      value: index + 1,
      unit: type.canonicalUnit,
      sourceId: "src1"
    }));
    store.pinnedMeasurements = [
      { measurementCode: measurementTypes[0].code, pinnedAt: "2026-02-01T00:00:00.000Z" },
      { measurementCode: measurementTypes[1].code, pinnedAt: "2026-02-02T00:00:00.000Z" }
    ];

    const result = analyticsOf(store);

    expect(result.latestMetrics).toHaveLength(14);
    expect(result.latestMetrics.slice(0, 2).map((metric) => metric.code)).toEqual([
      measurementTypes[1].code,
      measurementTypes[0].code
    ]);
    expect(result.latestMetrics.slice(0, 2).every((metric) => metric.isPinned)).toBe(true);
    expect(result.latestMetricsForInsight?.[0].code).toBe(measurementTypes[13].code);
    expect(result.evidenceDigest[1]).toContain(measurementTypes[13].display);
  });
});

describe("computeAnalytics — trendCards", () => {
  it("returns 'up' direction when latest value is higher than first", () => {
    const store = makeEmptyStore();
    store.observations = [
      makeObservation({ id: "o1", measurementCode: "weight", observedAt: "2026-01-01T00:00:00.000Z", value: 78, unit: "kg", sourceId: "src1" }),
      makeObservation({ id: "o2", measurementCode: "weight", observedAt: "2026-01-15T00:00:00.000Z", value: 82, unit: "kg", sourceId: "src1" })
    ];
    const result = analyticsOf(store);
    const card = result.trendCards.find((c) => c.code === "weight");
    expect(card?.direction).toBe("up");
  });

  it("returns 'down' direction when latest value is lower than first", () => {
    const store = makeEmptyStore();
    store.observations = [
      makeObservation({ id: "o1", measurementCode: "weight", observedAt: "2026-01-01T00:00:00.000Z", value: 85, unit: "kg", sourceId: "src1" }),
      makeObservation({ id: "o2", measurementCode: "weight", observedAt: "2026-01-15T00:00:00.000Z", value: 80, unit: "kg", sourceId: "src1" })
    ];
    const result = analyticsOf(store);
    const card = result.trendCards.find((c) => c.code === "weight");
    expect(card?.direction).toBe("down");
  });

  it("does not generate a trend card with only one observation", () => {
    const store = makeEmptyStore();
    store.observations = [
      makeObservation({ id: "o1", measurementCode: "weight", observedAt: "2026-01-01T00:00:00.000Z", value: 80, unit: "kg", sourceId: "src1" })
    ];
    const result = analyticsOf(store);
    expect(result.trendCards.find((c) => c.code === "weight")).toBeUndefined();
  });

  it("does not generate a trend card when repeated readings have not changed", () => {
    const store = makeEmptyStore();
    store.observations = [
      makeObservation({ id: "h1", measurementCode: "height", observedAt: "2026-01-01T00:00:00.000Z", value: 176, unit: "cm", sourceId: "src1" }),
      makeObservation({ id: "h2", measurementCode: "height", observedAt: "2026-01-15T00:00:00.000Z", value: 176, unit: "cm", sourceId: "src1" })
    ];

    expect(analyticsOf(store).trendCards.find((card) => card.code === "height")).toBeUndefined();
  });

  it("does not generate a trend card for fractional rounding noise", () => {
    const store = makeEmptyStore();
    store.observations = [
      makeObservation({ id: "h1", measurementCode: "height", observedAt: "2026-01-01T00:00:00.000Z", value: 176, unit: "cm", sourceId: "src1" }),
      makeObservation({ id: "h2", measurementCode: "height", observedAt: "2026-01-15T00:00:00.000Z", value: 176.0001, unit: "cm", sourceId: "src1" })
    ];

    expect(analyticsOf(store).trendCards.find((card) => card.code === "height")).toBeUndefined();
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
    const result = analyticsOf(store);
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
    const result = analyticsOf(store);
    expect(result.labAlerts).toMatchObject([{ unit: "mmol/L", flag: "high", observedAt: "2026-01-01T00:00:00.000Z" }]);
    expect(result.labAlerts[0].value).toBeCloseTo(9.99, 2);
  });

  it("uses only the latest observation for each current lab alert", () => {
    const store = makeEmptyStore();
    store.observations = [
      makeObservation({ id: "old", measurementCode: "glucose", observedAt: "2026-01-01T00:00:00.000Z", value: 8, unit: "mmol/L", sourceId: "source" }),
      makeObservation({ id: "new", measurementCode: "glucose", observedAt: "2026-02-01T00:00:00.000Z", value: 5, unit: "mmol/L", sourceId: "source" })
    ];

    expect(analyticsOf(store).labAlerts).toEqual([]);
  });

  it.each(["child", "pet"] as const)("suppresses adult reference classifications for %s profiles", (subjectKind) => {
    const store = makeEmptyStore();
    store.profile.subjectKind = subjectKind;
    store.observations = [
      makeObservation({ id: "lab", measurementCode: "glucose", observedAt: "2026-01-01T00:00:00.000Z", value: 8, unit: "mmol/L", sourceId: "source" })
    ];

    const result = analyticsOf(store);
    expect(result.labAlerts).toEqual([]);
    expect(result.rangeAlerts).toEqual([]);
    expect(result.latestMetrics.find((metric) => metric.code === "glucose")?.status).toBe("unknown");
  });

  it("does not generate a mixed-unit trend for conversion rounding noise", () => {
    const store = makeEmptyStore();
    store.profile.units = "imperial";
    store.observations = [
      makeObservation({ id: "w1", measurementCode: "weight", observedAt: "2026-01-01T00:00:00.000Z", value: 70, unit: "kg", sourceId: "source" }),
      makeObservation({ id: "w2", measurementCode: "weight", observedAt: "2026-01-02T00:00:00.000Z", value: 154.324, unit: "lb", sourceId: "source" })
    ];
    const result = analyticsOf(store);
    expect(result.trendCards.find((card) => card.code === "weight")).toBeUndefined();
  });
});

describe("computeAnalytics — rangeAlerts", () => {
  it("includes out-of-range Body measurements while keeping labAlerts lab-only", () => {
    const store = makeEmptyStore();
    store.observations = [
      makeObservation({ id: "body", measurementCode: "bmi", observedAt: "2026-02-01T00:00:00.000Z", value: 29, unit: "kg/m2", sourceId: "source" }),
      makeObservation({ id: "lab", measurementCode: "glucose", observedAt: "2026-01-01T00:00:00.000Z", value: 8, unit: "mmol/L", sourceId: "source" })
    ];

    const result = analyticsOf(store);

    expect(result.rangeAlerts).toMatchObject([
      { code: "bmi", category: "body", flag: "high" },
      { code: "glucose", category: "lab", flag: "high" }
    ]);
    expect(result.labAlerts).toMatchObject([{ code: "glucose", flag: "high" }]);
    expect(result.labAlerts[0]).not.toHaveProperty("category");
  });

  it("uses personal Body ranges and excludes normal Body results", () => {
    const store = makeEmptyStore();
    store.personalReferenceRanges = [{
      measurementCode: "weight",
      normalLow: 60,
      normalHigh: 80,
      unit: "kg",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }];
    store.observations = [
      makeObservation({ id: "weight", measurementCode: "weight", observedAt: "2026-02-01T00:00:00.000Z", value: 85, unit: "kg", sourceId: "source" }),
      makeObservation({ id: "bmi", measurementCode: "bmi", observedAt: "2026-02-01T00:00:00.000Z", value: 22, unit: "kg/m2", sourceId: "source" })
    ];

    expect(analyticsOf(store).rangeAlerts).toMatchObject([
      { code: "weight", category: "body", reference: "60-80", flag: "high" }
    ]);
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
    const result = analyticsOf(store);
    expect(result.evidenceDigest[0]).toMatch(/1 source file/);
    expect(result.evidenceDigest[0]).toMatch(/1 observation/);
  });

  it("notes no lab markers out of range when all markers are normal", () => {
    const result = analyticsOf(makeEmptyStore());
    expect(result.evidenceDigest[2]).toMatch(/No lab markers are outside/);
  });
});
