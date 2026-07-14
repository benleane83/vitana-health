import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, parsePersistedHealthStore } from "../storeSchema.js";

function store(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    profile: { id: "self", displayName: "Test", units: "metric", updatedAt: "2026-01-01T00:00:00.000Z" },
    sourceImports: [], dataSources: [], devices: [], measurementTypes: [], observations: [], observationGroups: [],
    timeSeriesSamples: [], activitySessions: [], insights: [], auditEvents: [],
    ...overrides
  };
}

describe("persisted health store schema", () => {
  it("accepts the current persisted shape and rejects malformed collections", () => {
    expect(parsePersistedHealthStore(store()).data.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(() => parsePersistedHealthStore(store({ observations: {} }))).toThrow();
  });

  it("accepts persisted metabolic measurement types", () => {
    const result = parsePersistedHealthStore(store({
      measurementTypes: [{
        code: "basal_metabolic_rate",
        display: "Basal metabolic rate",
        category: "metabolic",
        kind: "point",
        canonicalUnit: "kcal/day",
        aliases: ["bmr"],
        aggregation: "latest"
      }]
    }));

    expect(result.data.measurementTypes[0]?.category).toBe("metabolic");
  });

  it("preserves previously persisted profile metadata and migration audit events", () => {
    const result = parsePersistedHealthStore(store({
      profile: {
        id: "self",
        displayName: "Test",
        bloodType: "unknown",
        units: "metric",
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      auditEvents: [{
        id: "audit-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        eventType: "migration-applied",
        detail: "Legacy store migrated."
      }]
    }));

    expect(result.data.profile.bloodType).toBe("unknown");
    expect(result.data.auditEvents[0]?.eventType).toBe("migration-applied");
  });

  it("migrates v1 legacy lab fields once and removes obsolete fields", () => {
    const result = parsePersistedHealthStore(store({
      schemaVersion: 1,
      observationGroups: undefined,
      labPanels: [{ id: "panel-1", collectedAt: "2026-01-01T00:00:00.000Z", panelName: "CBC", sourceId: "source-1" }],
      labMarkers: [{ id: "marker-1", panelId: "panel-1", measurementCode: "glucose", value: 90, unit: "mg/dL" }],
      sleepSessions: [],
      sleepStageIntervals: []
    }));

    expect(result.migrated).toBe(true);
    expect(result.data).toMatchObject({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      observationGroups: [{ id: "group_legacy_panel-1", kind: "lab_panel" }],
      observations: [{ id: "obs_legacy_marker-1", observationGroupId: "group_legacy_panel-1" }]
    });
    expect(result.data).not.toHaveProperty("labPanels");
  });
});
