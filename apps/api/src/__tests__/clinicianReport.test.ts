import { describe, expect, it } from "vitest";
import { buildClinicianReport } from "../clinicianReport.js";
import { analyticsCountsFromStore, computeAnalytics, EXPORT_FORMAT_VERSION, type HealthStoreData } from "@vitana/shared";

const analyticsOf = (data: HealthStoreData) => computeAnalytics({ ...data, counts: analyticsCountsFromStore(data) });

function store(): HealthStoreData {
  return {
    schemaVersion: EXPORT_FORMAT_VERSION,
    profile: { id: "self", displayName: "Alex", setupStatus: "complete", units: "metric", updatedAt: "2026-01-01T00:00:00.000Z" },
    sourceImports: [{ id: "import-1", sourceKind: "blood-test-csv", fileName: "labs.csv", importedAt: "2026-01-02T00:00:00.000Z", parserVersion: "1", checksum: "private", rowCount: 1, status: "processed", diagnostics: [], rawContent: "private" }],
    dataSources: [], devices: [],
    measurementTypes: [{ code: "cholesterol", display: "Cholesterol", description: "The amount of cholesterol in your blood.", category: "lab", kind: "panel-component", canonicalUnit: "mmol/L", aliases: [], aggregation: "latest", normalLow: 3, normalHigh: 5, referenceRanges: [{ low: 3, high: 5, unit: "mmol/L" }] }],
    personalReferenceRanges: [],
    pinnedMeasurements: [],
    observations: [{ id: "obs-1", measurementCode: "cholesterol", observedAt: "2026-01-01T00:00:00.000Z", value: 7, unit: "mmol/L", sourceId: "source-1" }],
    observationGroups: [],
    timeSeriesSamples: [],
    measurementAggregates: [],
    activitySessions: [],
    insights: [], auditEvents: []
  };
}

describe("buildClinicianReport", () => {
  it("derives a deterministic, privacy-scoped report without raw import content", () => {
    const data = store();
    const report = buildClinicianReport({
      profile: data.profile,
      analytics: analyticsOf(data),
      sourceImports: data.sourceImports
    }, "2026-01-03T00:00:00.000Z");

    expect(report).toMatchObject({
      generatedAt: "2026-01-03T00:00:00.000Z",
      patient: { displayName: "Alex" },
      totals: { observations: 1, samples: 0, activities: 0 },
      flaggedLabs: [{ displayName: "Cholesterol", flag: "high", collectedAt: "2026-01-01T00:00:00.000Z" }],
      sources: [{ fileName: "labs.csv", rowCount: 1 }]
    });
    expect(JSON.stringify(report)).not.toContain("private");
  });

  it("uses the profile's preferred unit for height", () => {
    const data = store();
    data.profile = { ...data.profile, units: "imperial", heightCm: 180 };
    const input = { profile: data.profile, analytics: analyticsOf(data), sourceImports: data.sourceImports };

    expect(buildClinicianReport(input).patient.height).toMatchObject({ unit: "in" });
    expect(buildClinicianReport(input).patient.height?.value).toBeCloseTo(70.87, 2);
  });

  it("uses the complete latest-measurement snapshot instead of the capped analytics list", () => {
    const data = store();
    const latestMeasurements = Array.from({ length: 13 }, (_, index) => ({
      category: index === 0 ? "body" as const : "lab" as const,
      displayName: `Measurement ${index + 1}`,
      value: index + 1,
      unit: "unit",
      measuredAt: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`
    }));

    const report = buildClinicianReport({
      profile: data.profile,
      analytics: analyticsOf(data),
      latestMeasurements,
      sourceImports: data.sourceImports
    });

    expect(report.latestMeasurements).toEqual(latestMeasurements);
  });
});
