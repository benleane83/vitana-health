import { describe, expect, it } from "vitest";
import type { ReplicaPage } from "@vitana/shared";
import { MemoryLocalStore } from "../standalone/memoryLocalStore";
import { ConnectedReplicaRepository } from "./connectedRepository";

const identity = {
  serverInstanceId: "c65b97ac-ae21-4e39-9bed-1411718f85d6",
  profileId: "profile-1",
  pairingId: "pairing-1"
};

describe("connected replica repository", () => {
  it("reads and filters Care data from a completed offline snapshot", async () => {
    const store = new MemoryLocalStore();
    const changes: ReplicaPage["changes"] = [
      upsert("profile", "profile-1", {
        id: "profile-1",
        displayName: "Cached profile",
        subjectKind: "adult",
        units: "metric",
        updatedAt: "2026-07-25T13:00:00.000Z"
      }),
      upsert("measurement-type", "weight", {
        code: "weight",
        display: "Weight",
        category: "body",
        kind: "point",
        canonicalUnit: "kg",
        preferredUnits: { metric: "kg", imperial: "lb" },
        unitAliases: { kg: ["kg"], lb: ["lb"] },
        aliases: [],
        aggregation: "latest"
      }),
      upsert("data-source", "source-1", {
        id: "source-1",
        sourceKind: "manual-entry",
        label: "Phone entry",
        createdAt: "2026-07-20T10:00:00.000Z"
      }),
      upsert("data-source", "source-2", {
        id: "source-2",
        sourceKind: "health-connect",
        label: "Health Connect",
        createdAt: "2026-07-10T10:00:00.000Z"
      }),
      upsert("observation-group", "group-1", {
        id: "group-1",
        kind: "manual_panel",
        label: "Weight readings",
        sourceId: "source-1",
        collectedAt: "2026-07-25T09:00:00.000Z"
      }),
      upsert("observation", "observation-1", {
        id: "observation-1",
        measurementCode: "weight",
        observedAt: "2026-07-25T09:00:00.000Z",
        value: 70,
        unit: "kg",
        sourceId: "source-1",
        observationGroupId: "group-1"
      }),
      upsert("observation", "observation-2", {
        id: "observation-2",
        measurementCode: "weight",
        observedAt: "2026-07-20T09:00:00.000Z",
        value: 71,
        unit: "kg",
        sourceId: "source-1"
      }),
      upsert("observation", "observation-3", {
        id: "observation-3",
        measurementCode: "weight",
        observedAt: "2026-07-10T09:00:00.000Z",
        value: 72,
        unit: "kg",
        sourceId: "source-2"
      }),
      upsert("health-event", "event-1", {
        id: "event-1",
        kind: "visit",
        status: "completed",
        occurredAt: "2026-07-25T10:00:00.000Z",
        source: "manual-entry",
        provider: "Local clinic"
      }),
      upsert("health-event", "event-2", {
        id: "event-2",
        kind: "procedure",
        status: "completed",
        occurredAt: "2026-07-20T10:00:00.000Z",
        source: "manual-entry"
      }),
      upsert("care-item", "care-1", {
        id: "care-1",
        kind: "visit",
        title: "Book clinic follow-up",
        dueStart: "2026-08-01",
        priority: "high",
        status: "completed",
        completedHealthEventId: "event-1"
      }),
      upsert("care-item", "care-2", {
        id: "care-2",
        kind: "visit",
        title: "Book dentist",
        priority: "normal",
        status: "open"
      })
    ];
    await store.applyReplicaPage({
      protocolVersion: 2,
      ...identity,
      kind: "snapshot",
      changes,
      highWaterMark: { revision: 1, sequence: changes.length },
      complete: true,
      cachedAt: "2026-07-25T14:00:00.000Z"
    });
    const repository = new ConnectedReplicaRepository(store, identity);

    await expect(repository.bootstrap()).resolves.toMatchObject({
      counts: { healthEvents: 2, careItems: 2 }
    });
    await expect(repository.listHealthEvents({ search: "clinic" })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: "event-1" })],
      total: 1
    });
    await expect(repository.listCareItems({ status: "completed" })).resolves.toMatchObject({
      items: [expect.objectContaining({
        id: "care-1",
        completedHealthEvent: expect.objectContaining({ id: "event-1" })
      })],
      total: 1
    });
    await expect(repository.listCareItems({ limit: 1, includeId: "care-2" })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: "care-1" }), expect.objectContaining({ id: "care-2" })],
      total: 2,
      hasMore: true
    });
    await expect(repository.observationGroup("group-1")).resolves.toMatchObject({
      label: "Weight readings",
      source: { label: "Phone entry" },
      observations: [expect.objectContaining({ id: "observation-1", displayName: "Weight" })]
    });
    await expect(repository.observationGroup("missing")).resolves.toBeUndefined();

    const reopened = new ConnectedReplicaRepository(store, identity);
    await expect(reopened.healthDataDetail("weight", { limit: 1 })).resolves.toMatchObject({
      entries: [expect.objectContaining({
        id: "observation-1",
        value: 70,
        canDelete: true,
        deleteLabel: "Delete reading"
      })],
      pagination: { loaded: 1, total: 3, hasMore: true }
    });
    await expect(reopened.healthDataDetail("weight", { limit: 1, offset: 1 })).resolves.toMatchObject({
      entries: [expect.objectContaining({ id: "observation-2", value: 71 })],
      pagination: { loaded: 2, total: 3, hasMore: true }
    });
    await expect(reopened.healthDataDetail("weight", { limit: 1, offset: 2 })).resolves.toMatchObject({
      entries: [expect.objectContaining({ id: "observation-3", value: 72, canDelete: false })],
      pagination: { loaded: 3, total: 3, hasMore: false }
    });
  });

  it("keeps a short chart range dense even when the replica holds years of readings", async () => {
    const store = new MemoryLocalStore();
    const days = 1500;
    const changes: ReplicaPage["changes"] = [
      upsert("profile", "profile-1", {
        id: "profile-1",
        displayName: "Cached profile",
        subjectKind: "adult",
        units: "metric",
        updatedAt: "2026-07-25T13:00:00.000Z"
      }),
      upsert("measurement-type", "weight", {
        code: "weight",
        display: "Weight",
        category: "body",
        kind: "point",
        canonicalUnit: "kg",
        preferredUnits: { metric: "kg", imperial: "lb" },
        unitAliases: { kg: ["kg"], lb: ["lb"] },
        aliases: [],
        aggregation: "latest"
      }),
      upsert("data-source", "source-1", {
        id: "source-1",
        sourceKind: "manual-entry",
        label: "Phone entry",
        createdAt: "2026-07-20T10:00:00.000Z"
      })
    ];
    for (let day = 0; day < days; day++) {
      const observedAt = new Date(Date.now() - day * 86_400_000).toISOString();
      changes.push(upsert("observation", `observation-${day}`, {
        id: `observation-${day}`,
        measurementCode: "weight",
        observedAt,
        value: 70 + (day % 5),
        unit: "kg",
        sourceId: "source-1"
      }));
    }
    await store.applyReplicaPage({
      protocolVersion: 2,
      ...identity,
      kind: "snapshot",
      changes,
      highWaterMark: { revision: 1, sequence: changes.length },
      complete: true,
      cachedAt: "2026-07-25T14:00:00.000Z"
    });
    const repository = new ConnectedReplicaRepository(store, identity);

    // Downsampling to 500 points across all four years used to leave roughly eight inside "1m",
    // which reads to a user as data loss.
    const month = await repository.healthDataChartSeries("weight", { range: "1m", mode: "raw" });
    expect(month.points.length).toBeGreaterThan(25);
    const all = await repository.healthDataChartSeries("weight", { range: "all", mode: "raw" });
    expect(all.points.length).toBeLessThanOrEqual(500);
  });

  it("builds offline Calendar data from samples and aggregates", async () => {
    const store = new MemoryLocalStore();
    const changes: ReplicaPage["changes"] = [
      upsert("profile", "profile-1", {
        id: "profile-1",
        displayName: "Cached profile",
        subjectKind: "adult",
        units: "metric",
        updatedAt: "2026-08-07T12:00:00.000Z"
      }),
      upsert("measurement-type", "steps", {
        code: "steps",
        display: "Steps",
        category: "activity",
        kind: "interval",
        canonicalUnit: "count",
        aliases: [],
        aggregation: "sum"
      }),
      upsert("measurement-type", "heart_rate", {
        code: "heart_rate",
        display: "Heart rate",
        category: "cardio",
        kind: "interval",
        canonicalUnit: "bpm",
        aliases: [],
        aggregation: "average"
      }),
      upsert("data-source", "source-1", {
        id: "source-1",
        sourceKind: "health-connect",
        label: "Health Connect",
        createdAt: "2026-08-01T00:00:00.000Z"
      }),
      upsert("time-series-sample", "steps-1", {
        id: "steps-1",
        measurementCode: "steps",
        startAt: "2026-08-04T08:00:00.000Z",
        endAt: "2026-08-04T09:00:00.000Z",
        value: 1200,
        unit: "count",
        sourceId: "source-1"
      }),
      upsert("measurement-aggregate", "heart-rate-1", {
        id: "heart-rate-1",
        measurementCode: "heart_rate",
        granularity: "15m",
        startAt: "2026-08-04T09:00:00.000Z",
        endAt: "2026-08-04T09:15:00.000Z",
        average: 72,
        minimum: 64,
        maximum: 81,
        count: 12,
        unit: "bpm",
        sourceId: "source-1"
      })
    ];
    await store.applyReplicaPage({
      protocolVersion: 2,
      ...identity,
      kind: "snapshot",
      changes,
      highWaterMark: { revision: 1, sequence: changes.length },
      complete: true,
      cachedAt: "2026-08-07T12:00:00.000Z"
    });
    const repository = new ConnectedReplicaRepository(store, identity);

    await expect(repository.calendarMonth({
      month: "2026-08",
      timezone: "UTC",
      measurementCodes: ["steps", "heart_rate"]
    })).resolves.toMatchObject({
      measurements: [
        { date: "2026-08-04", measurementCode: "heart_rate", value: 72, count: 12, min: 64, max: 81 },
        { date: "2026-08-04", measurementCode: "steps", value: 1200, count: 1, min: 1200, max: 1200 }
      ]
    });
  });
});

function upsert(
  entityType: ReplicaPage["changes"][number]["entityType"],
  entityId: string,
  payload: Record<string, unknown>
): ReplicaPage["changes"][number] {
  return { revision: 1, sequence: 1, entityType, entityId, operation: "upsert", payload };
}