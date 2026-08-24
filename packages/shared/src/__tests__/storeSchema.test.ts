import { describe, expect, it } from "vitest";
import { EXPORT_FORMAT_VERSION, parsePersistedHealthStore } from "../storeSchema.js";

function store(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: EXPORT_FORMAT_VERSION,
    profile: { id: "self", displayName: "Test", setupStatus: "complete", units: "metric", updatedAt: "2026-01-01T00:00:00.000Z" },
    sourceImports: [], dataSources: [], devices: [], measurementTypes: [], observations: [], observationGroups: [],
    timeSeriesSamples: [], measurementAggregates: [], activitySessions: [], personalReferenceRanges: [], pinnedMeasurements: [], insights: [], auditEvents: [],
    ...overrides
  };
}

describe("persisted health store schema", () => {
  it("accepts the current persisted shape and rejects malformed collections", () => {
    expect(parsePersistedHealthStore(store()).schemaVersion).toBe(EXPORT_FORMAT_VERSION);
    expect(() => parsePersistedHealthStore(store({ observations: {} }))).toThrow();
  });

  it("preserves measurement aggregates", () => {
    const aggregate = {
      id: "aggregate-1", measurementCode: "heart_rate", granularity: "15m",
      startAt: "2026-01-01T10:00:00.000Z", endAt: "2026-01-01T10:15:00.000Z",
      average: 72, minimum: 60, maximum: 90, count: 20,
      unit: "beats/min", sourceId: "source-1"
    };
    expect(parsePersistedHealthStore(store({ measurementAggregates: [aggregate] })).measurementAggregates)
      .toEqual([aggregate]);
  });

  it("rejects any other format version rather than mis-parsing it", () => {
    // This is the guard the restore path relies on: a backup written by a different build must
    // fail loudly instead of being coerced into the current shape.
    for (const version of [0, 1, 7, EXPORT_FORMAT_VERSION + 1]) {
      expect(() => parsePersistedHealthStore(store({ schemaVersion: version })))
        .toThrow(/Unsupported health store schema version/);
    }
  });

  it("validates personal range bounds", () => {
    expect(parsePersistedHealthStore(store({
      personalReferenceRanges: [{
        measurementCode: "glucose", normalLow: 4, normalHigh: 6, optimalLow: 4.5, optimalHigh: 5.5,
        unit: "mmol/L", updatedAt: "2026-01-01T00:00:00.000Z"
      }]
    })).personalReferenceRanges[0]).toMatchObject({
      normalLow: 4, normalHigh: 6, optimalLow: 4.5, optimalHigh: 5.5
    });
    expect(() => parsePersistedHealthStore(store({
      personalReferenceRanges: [{ measurementCode: "glucose", unit: "mmol/L", updatedAt: "2026-01-01T00:00:00.000Z" }]
    }))).toThrow(/bound/i);
    for (const range of [
      { normalLow: 4, normalHigh: 6, optimalLow: 4.5 },
      { normalLow: 4, optimalLow: 4.5, optimalHigh: 5.5 },
      { normalLow: 4, normalHigh: 6, optimalLow: 3.5, optimalHigh: 5.5 }
    ]) {
      expect(() => parsePersistedHealthStore(store({
        personalReferenceRanges: [{
          measurementCode: "glucose", ...range, unit: "mmol/L", updatedAt: "2026-01-01T00:00:00.000Z"
        }]
      }))).toThrow(/optimal/i);
    }
  });

  it("preserves persisted profile metadata and audit events", () => {
    const result = parsePersistedHealthStore(store({
      profile: {
        id: "self",
        displayName: "Test",
        setupStatus: "complete",
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

    expect(result.profile.bloodType).toBe("unknown");
    expect(result.auditEvents[0]?.eventType).toBe("migration-applied");
  });

  it("migrates version 9 Health Event kinds and removes obsolete events", () => {
    const legacyEvent = (id: string, kind: string, day: string) => ({
      id,
      kind,
      status: "completed",
      occurredAt: `2026-01-${day}T00:00:00.000Z`,
      source: "manual-entry"
    });
    const result = parsePersistedHealthStore(store({
      schemaVersion: 9,
      healthEvents: [
        { ...legacyEvent("medication", "medication-administration", "01"),
          medicationAdministration: { medication: "Test", dose: 10, unit: "mg" } },
        legacyEvent("allergy", "allergy-reaction", "02"),
        legacyEvent("treatment", "treatment", "03"),
        legacyEvent("dental", "dental", "04"),
        legacyEvent("test", "test", "05"),
        legacyEvent("injury", "injury", "06")
      ],
      careItems: [{
        id: "care-1",
        kind: "test-screening",
        title: "Screening",
        priority: "normal",
        status: "completed",
        completedHealthEventId: "test",
        completedAt: "2026-01-05T00:00:00.000Z"
      }]
    }));

    expect(result.schemaVersion).toBe(EXPORT_FORMAT_VERSION);
    expect(result.healthEvents).toEqual([
      expect.objectContaining({ id: "medication", kind: "medication" }),
      expect.objectContaining({ id: "allergy", kind: "allergy-intolerance" })
    ]);
    expect(result.careItems[0]).toMatchObject({
      id: "care-1",
      status: "completed",
      completedAt: "2026-01-05T00:00:00.000Z"
    });
    expect(result.careItems[0]?.completedHealthEventId).toBeUndefined();
  });

  it("migrates version 10 Care Item kinds to the consolidated taxonomy", () => {
    const result = parsePersistedHealthStore(store({
      schemaVersion: 10,
      careItems: [
        { id: "routine", kind: "routine-checkup", title: "Routine", priority: "normal", status: "open" },
        { id: "follow-up", kind: "follow-up", title: "Follow-up", priority: "normal", status: "open" },
        { id: "dental", kind: "dental", title: "Dental", priority: "normal", status: "open" },
        { id: "screening", kind: "test-screening", title: "Screening", priority: "normal", status: "open" },
        { id: "therapy", kind: "treatment-therapy", title: "Therapy", priority: "normal", status: "open" },
        { id: "monitoring", kind: "monitoring", title: "Monitoring", priority: "normal", status: "open" }
      ]
    }));

    expect(result.schemaVersion).toBe(EXPORT_FORMAT_VERSION);
    expect(result.careItems?.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: "routine", kind: "visit" },
      { id: "follow-up", kind: "visit" },
      { id: "dental", kind: "visit" },
      { id: "screening", kind: "procedure" },
      { id: "therapy", kind: "procedure" },
      { id: "monitoring", kind: "monitoring" }
    ]);
  });

  it("migrates version 11 profiles as already set up", () => {
    const legacy = store({
      schemaVersion: 11,
      profile: {
        id: "self",
        displayName: "Existing user",
        units: "metric",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    });

    const migrated = parsePersistedHealthStore(legacy);
    expect(migrated.profile.setupStatus).toBe("complete");
  });

  it("migrates version 12 skipped care items to cancelled", () => {
    const legacy = store({
      schemaVersion: 12,
      careItems: [{
        id: "skipped-care-item",
        kind: "visit",
        title: "Legacy appointment",
        priority: "normal",
        status: "skipped"
      }]
    });

    const migrated = parsePersistedHealthStore(legacy);
    expect(migrated.careItems).toEqual([
      expect.objectContaining({ id: "skipped-care-item", status: "cancelled" })
    ]);
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
        kind: "medication",
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

    expect(result.healthEvents).toEqual([
      expect.objectContaining({ id: "event-1", kind: "immunization" }),
      expect.objectContaining({ id: "event-2", kind: "medication" }),
      expect.objectContaining({ id: "event-3", kind: "visit" })
    ]);
  });
});
