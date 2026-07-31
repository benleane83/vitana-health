import { describe, expect, it } from "vitest";
import { EXPORT_FORMAT_VERSION, parsePersistedHealthStore } from "../storeSchema.js";

function store(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: EXPORT_FORMAT_VERSION,
    profile: { id: "self", displayName: "Test", units: "metric", updatedAt: "2026-01-01T00:00:00.000Z" },
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
  });

  it("preserves persisted profile metadata and audit events", () => {
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

    expect(result.profile.bloodType).toBe("unknown");
    expect(result.auditEvents[0]?.eventType).toBe("migration-applied");
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

    expect(result.healthEvents).toEqual([
      expect.objectContaining({ id: "event-1", kind: "immunization" }),
      expect.objectContaining({ id: "event-2", kind: "medication-administration" }),
      expect.objectContaining({ id: "event-3", kind: "visit" })
    ]);
  });
});
