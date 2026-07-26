import {
  classifyValueWithRange,
  defaultMeasurementTypes,
  getReferenceRange,
  parsePersistedHealthStore
} from "@vitana/shared";
import { describe, expect, it } from "vitest";
import {
  TEST_PROFILE_AS_OF,
  createTestProfileFixture
} from "../dev/testProfileFixture.js";

describe("test profile fixture", () => {
  it("creates schema-valid data for every registered measurement type", () => {
    const store = createTestProfileFixture();
    expect(parsePersistedHealthStore(store).data.profile.id).toBe("vitana-test-profile");

    const populatedCodes = new Set([
      ...store.observations.map((entry) => entry.measurementCode),
      ...store.timeSeriesSamples.map((entry) => entry.measurementCode),
      ...(store.activitySessions.length > 0 ? ["activity_sessions"] : [])
    ]);
    expect([...populatedCodes].sort()).toEqual(defaultMeasurementTypes.map((type) => type.code).sort());
    expect(store.observations.length + store.timeSeriesSamples.length).toBeGreaterThan(2_000);
  });

  it("keeps history within six months and future care inside 2026", () => {
    const store = createTestProfileFixture();
    const asOf = new Date(TEST_PROFILE_AS_OF).getTime();
    const earliest = asOf - 181 * 86_400_000;
    const measurementTimes = [
      ...store.observations.map((entry) => new Date(entry.observedAt).getTime()),
      ...store.timeSeriesSamples.map((entry) => new Date(entry.startAt).getTime()),
      ...store.activitySessions.map((entry) => new Date(entry.startAt).getTime())
    ];
    expect(Math.min(...measurementTimes)).toBeGreaterThanOrEqual(earliest);
    expect(Math.max(...measurementTimes)).toBeLessThanOrEqual(asOf);
    expect(store.healthEvents).toHaveLength(12);
    expect(store.healthEvents?.every((event) => new Date(event.occurredAt).getTime() >= earliest && new Date(event.occurredAt).getTime() <= asOf)).toBe(true);
    expect(store.careItems).toHaveLength(10);
    expect(store.careItems?.every((item) => item.dueStart?.startsWith("2026-") && new Date(item.dueStart).getTime() > asOf)).toBe(true);
  });

  it("generates mostly normal range-backed values with selected anomalies", () => {
    const store = createTestProfileFixture();
    const anomalyCodes = new Set<string>();
    for (const type of defaultMeasurementTypes) {
      const range = getReferenceRange(type, type.canonicalUnit);
      if (!range) continue;
      const values = [
        ...store.observations.filter((entry) => entry.measurementCode === type.code).map((entry) => entry.value),
        ...store.timeSeriesSamples.filter((entry) => entry.measurementCode === type.code).map((entry) => entry.value)
      ];
      const statuses = values.map((value) => classifyValueWithRange(value, range));
      expect(statuses.filter((status) => status === "normal").length / statuses.length).toBeGreaterThan(0.7);
      if (statuses.some((status) => status === "low" || status === "high")) anomalyCodes.add(type.code);
    }
    expect(anomalyCodes).toEqual(new Set([
      "heart_rate",
      "oxygen_saturation",
      "blood_pressure_systolic",
      "glucose",
      "ldl_cholesterol"
    ]));
  });

  it("uses unique IDs and resolvable source, device, group, and completion links", () => {
    const store = createTestProfileFixture();
    const ids = [
      ...store.sourceImports.map((entry) => entry.id),
      ...store.dataSources.map((entry) => entry.id),
      ...store.devices.map((entry) => entry.id),
      ...store.observations.map((entry) => entry.id),
      ...store.observationGroups.map((entry) => entry.id),
      ...store.timeSeriesSamples.map((entry) => entry.id),
      ...store.activitySessions.map((entry) => entry.id),
      ...(store.healthEvents ?? []).map((entry) => entry.id),
      ...(store.careItems ?? []).map((entry) => entry.id)
    ];
    expect(new Set(ids).size).toBe(ids.length);

    const sourceIds = new Set(store.dataSources.map((entry) => entry.id));
    const deviceIds = new Set(store.devices.map((entry) => entry.id));
    const groupIds = new Set(store.observationGroups.map((entry) => entry.id));
    expect(store.observations.every((entry) => sourceIds.has(entry.sourceId) && (!entry.deviceId || deviceIds.has(entry.deviceId)) && (!entry.observationGroupId || groupIds.has(entry.observationGroupId)))).toBe(true);
    expect(store.timeSeriesSamples.every((entry) => sourceIds.has(entry.sourceId) && (!entry.deviceId || deviceIds.has(entry.deviceId)))).toBe(true);
    expect(store.activitySessions.every((entry) => sourceIds.has(entry.sourceId))).toBe(true);
  });
});