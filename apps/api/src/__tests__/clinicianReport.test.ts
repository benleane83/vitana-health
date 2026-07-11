import { describe, expect, it } from "vitest";
import { buildClinicianReport } from "../clinicianReport.js";
import type { HealthStoreData } from "@local-fitness-advisor/shared";

function store(): HealthStoreData {
  return {
    schemaVersion: 2,
    profile: { id: "self", displayName: "Alex", units: "metric", updatedAt: "2026-01-01T00:00:00.000Z" },
    sourceImports: [{ id: "import-1", sourceKind: "blood-test-csv", fileName: "labs.csv", importedAt: "2026-01-02T00:00:00.000Z", parserVersion: "1", checksum: "private", rowCount: 1, status: "processed", diagnostics: [], rawContent: "private" }],
    dataSources: [], devices: [],
    measurementTypes: [{ code: "cholesterol", display: "Cholesterol", category: "lab", kind: "panel-component", canonicalUnit: "mmol/L", aliases: [], aggregation: "latest" }],
    observations: [], observationGroups: [], timeSeriesSamples: [], activitySessions: [], sleepSessions: [], sleepStageIntervals: [],
    labPanels: [{ id: "panel-1", collectedAt: "2026-01-01T00:00:00.000Z", panelName: "Lipids", sourceId: "source-1" }],
    labMarkers: [{ id: "marker-1", panelId: "panel-1", measurementCode: "cholesterol", displayName: "Cholesterol", value: 7, unit: "mmol/L", referenceLow: 3, referenceHigh: 5, flag: "high" }],
    insights: [], auditEvents: []
  };
}

describe("buildClinicianReport", () => {
  it("derives a deterministic, privacy-scoped report without raw import content", () => {
    const report = buildClinicianReport(store(), "2026-01-03T00:00:00.000Z");

    expect(report).toMatchObject({
      generatedAt: "2026-01-03T00:00:00.000Z",
      patient: { displayName: "Alex" },
      totals: { labMarkers: 1 },
      flaggedLabs: [{ displayName: "Cholesterol", flag: "high", referenceRange: "3–5 mmol/L" }],
      sources: [{ fileName: "labs.csv", rowCount: 1 }]
    });
    expect(JSON.stringify(report)).not.toContain("private");
  });
});
