import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, parsePersistedHealthStore } from "../storeSchema.js";

function store(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    profile: { id: "self", displayName: "Test", units: "metric", updatedAt: "2026-01-01T00:00:00.000Z" },
    sourceImports: [], dataSources: [], devices: [], measurementTypes: [], observations: [], observationGroups: [],
    timeSeriesSamples: [], activitySessions: [], personalReferenceRanges: [], insights: [], auditEvents: [],
    ...overrides
  };
}

describe("persisted health store schema", () => {
  it("accepts the current persisted shape and rejects malformed collections", () => {
    expect(parsePersistedHealthStore(store()).data.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(() => parsePersistedHealthStore(store({ observations: {} }))).toThrow();
  });

  it("migrates v4 stores with an empty personal range collection", () => {
    const legacy = store({ schemaVersion: 4 });
    delete legacy.personalReferenceRanges;
    const result = parsePersistedHealthStore(legacy);
    expect(result).toMatchObject({
      migrated: true,
      data: { schemaVersion: CURRENT_SCHEMA_VERSION, personalReferenceRanges: [] }
    });
  });

  it("migrates v6 care records by removing retired interval and origin fields", () => {
    const result = parsePersistedHealthStore(store({
      schemaVersion: 6,
      healthEvents: [{
        id: "event-1", kind: "visit", status: "completed", occurredAt: "2026-01-01T10:00:00.000Z",
        occurredEnd: "2026-01-01T11:00:00.000Z", source: "manual-entry"
      }],
      careItems: [{
        id: "care-1", kind: "follow-up", title: "Review results", dueStart: "2026-01-03T10:00:00.000Z",
        dueEnd: "2026-01-03T11:00:00.000Z", reminderAt: "2026-01-04T10:00:00.000Z", priority: "normal",
        status: "completed", originatingHealthEventId: "event-origin", completedHealthEventId: "event-1",
        completedAt: "2026-01-01T10:00:00.000Z"
      }]
    }));

    expect(result.migrated).toBe(true);
    expect(result.data.healthEvents[0]).not.toHaveProperty("occurredEnd");
    expect(result.data.careItems[0]).toMatchObject({
      id: "care-1", completedHealthEventId: "event-1", reminderAt: "2026-01-04T10:00:00.000Z"
    });
    expect(result.data.careItems[0]).not.toHaveProperty("dueEnd");
    expect(result.data.careItems[0]).not.toHaveProperty("originatingHealthEventId");
  });

  it("validates personal range bounds", () => {
    expect(parsePersistedHealthStore(store({
      personalReferenceRanges: [{
        measurementCode: "glucose", normalLow: 4, normalHigh: 6, optimalLow: 4.5, optimalHigh: 5.5,
        unit: "mmol/L", updatedAt: "2026-01-01T00:00:00.000Z"
      }]
    })).data.personalReferenceRanges[0]).toMatchObject({
      normalLow: 4, normalHigh: 6, optimalLow: 4.5, optimalHigh: 5.5
    });
    expect(() => parsePersistedHealthStore(store({
      personalReferenceRanges: [{ measurementCode: "glucose", unit: "mmol/L", updatedAt: "2026-01-01T00:00:00.000Z" }]
    }))).toThrow(/bound/i);
  });

  it("migrates v5 low and high bounds to normal bounds", () => {
    const result = parsePersistedHealthStore(store({
      schemaVersion: 5,
      personalReferenceRanges: [{
        measurementCode: "glucose", low: 4, high: 6, unit: "mmol/L", updatedAt: "2026-01-01T00:00:00.000Z"
      }]
    }));
    expect(result).toMatchObject({
      migrated: true,
      data: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        personalReferenceRanges: [{ normalLow: 4, normalHigh: 6 }]
      }
    });
  });

  it("migrates persisted metabolic measurement types to the current registry category", () => {
    const result = parsePersistedHealthStore(store({
      measurementTypes: [{
        code: "glucose",
        display: "Glucose",
        category: "metabolic",
        kind: "panel-component",
        canonicalUnit: "mg/dL",
        aliases: ["glucose"],
        aggregation: "latest"
      }]
    }));

    expect(result.migrated).toBe(true);
    expect(result.data.measurementTypes[0]).toMatchObject({ code: "glucose", category: "lab", canonicalUnit: "mmol/L" });
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

  it("accepts base-only health event kinds without specialist payloads", () => {
    const result = parsePersistedHealthStore(store({
      healthEvents: [{
        id: "event-1",
        kind: "immunization",
        status: "completed",
        occurredAt: "2026-01-01T00:00:00.000Z",
        source: "manual-entry"
      }, {
        id: "event-2",
        kind: "medication-administration",
        status: "completed",
        occurredAt: "2026-01-02T00:00:00.000Z",
        source: "manual-entry"
      }, {
        id: "event-3",
        kind: "visit",
        status: "completed",
        occurredAt: "2026-01-03T00:00:00.000Z",
        source: "manual-entry"
      }]
    }));

    expect(result.data.healthEvents).toEqual([
      expect.objectContaining({ id: "event-1", kind: "immunization" }),
      expect.objectContaining({ id: "event-2", kind: "medication-administration" }),
      expect.objectContaining({ id: "event-3", kind: "visit" })
    ]);
  });
});
