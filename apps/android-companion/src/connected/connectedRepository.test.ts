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
      upsert("observation", "observation-1", {
        id: "observation-1",
        measurementCode: "weight",
        observedAt: "2026-07-25T09:00:00.000Z",
        value: 70,
        unit: "kg",
        sourceId: "source-1"
      }),
      upsert("observation", "observation-2", {
        id: "observation-2",
        measurementCode: "weight",
        observedAt: "2026-07-20T09:00:00.000Z",
        value: 71,
        unit: "kg",
        sourceId: "source-1"
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
        kind: "test",
        status: "completed",
        occurredAt: "2026-07-20T10:00:00.000Z",
        source: "manual-entry"
      }),
      upsert("care-item", "care-1", {
        id: "care-1",
        kind: "follow-up",
        title: "Book clinic follow-up",
        dueStart: "2026-08-01",
        priority: "high",
        status: "completed",
        completedHealthEventId: "event-1"
      }),
      upsert("care-item", "care-2", {
        id: "care-2",
        kind: "dental",
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

    const reopened = new ConnectedReplicaRepository(store, identity);
    await expect(reopened.healthDataDetail("weight", { limit: 1 })).resolves.toMatchObject({
      entries: [expect.objectContaining({
        id: "observation-1",
        value: 70,
        canDelete: true,
        deleteLabel: "Delete reading"
      })],
      pagination: { loaded: 1, total: 2, hasMore: true }
    });
    await expect(reopened.healthDataDetail("weight", { limit: 1, offset: 1 })).resolves.toMatchObject({
      entries: [expect.objectContaining({ id: "observation-2", value: 71 })],
      pagination: { loaded: 2, total: 2, hasMore: false }
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