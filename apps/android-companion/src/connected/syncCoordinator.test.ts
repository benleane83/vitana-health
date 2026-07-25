import { describe, expect, it, vi } from "vitest";
import type { ReplicaPage } from "@vitana/shared";
import { MemoryLocalStore } from "../standalone/memoryLocalStore";
import { ReplicaClient, type ReplicaNetwork } from "./replicaClient";
import { ReplicaSyncCoordinator } from "./syncCoordinator";

const identity = {
  serverInstanceId: "c65b97ac-ae21-4e39-9bed-1411718f85d6",
  profileId: "profile-1",
  pairingId: "pairing-1"
};

function page(kind: ReplicaPage["kind"], complete: boolean, changes: ReplicaPage["changes"]): ReplicaPage {
  return {
    protocolVersion: 1,
    ...identity,
    kind,
    changes,
    highWaterMark: { revision: 1, sequence: 1 },
    ...(complete ? {} : { nextCursor: "next" }),
    complete,
    cachedAt: "2026-07-25T14:00:00.000Z"
  };
}

describe("connected replica sync coordinator", () => {
  it("coalesces lifecycle triggers and makes snapshot plus deltas replay-safe", async () => {
    let releaseHandshake!: () => void;
    const gate = new Promise<void>((resolve) => { releaseHandshake = resolve; });
    const get = vi.fn(async (path: string) => {
      if (path.endsWith("/handshake")) {
        await gate;
        return { protocolVersion: 1, ...identity, highWaterMark: { revision: 0, sequence: 0 } };
      }
      if (path.includes("/snapshot")) {
        return page("snapshot", true, [{
          revision: 0,
          sequence: 0,
          entityType: "profile",
          entityId: "profile-1",
          operation: "upsert",
          payload: {
            id: "profile-1",
            displayName: "Cached profile",
            units: "metric",
            updatedAt: "2026-07-25T13:00:00.000Z"
          }
        }]);
      }
      return page("delta", true, [{
        revision: 1,
        sequence: 1,
        entityType: "observation",
        entityId: "observation-1",
        operation: "upsert",
        payload: {
          id: "observation-1",
          measurementCode: "weight",
          observedAt: "2026-07-25T13:00:00.000Z",
          value: 70,
          unit: "kg",
          sourceId: "source-1"
        }
      }]);
    });
    const store = new MemoryLocalStore();
    const coordinator = new ReplicaSyncCoordinator(
      new ReplicaClient({ get } satisfies ReplicaNetwork),
      store
    );

    const first = coordinator.synchronize();
    const overlapping = coordinator.synchronize();
    expect(first).toBe(overlapping);
    releaseHandshake();
    await Promise.all([first, overlapping]);

    expect(get).toHaveBeenCalledTimes(3);
    expect(await store.replicaMetadata(identity)).toMatchObject({
      initialSnapshotCompleted: true,
      cursorSequence: 1
    });
    expect(await store.replicaEntities(identity)).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: "observation" })
    ]));

    await coordinator.synchronize();
    expect((await store.replicaEntities(identity)).filter((entry) => entry.entityType === "observation")).toHaveLength(1);
  });

  it("retains the previous cache when a page fails and requires a fresh matching identity", async () => {
    const store = new MemoryLocalStore();
    await store.applyReplicaPage(page("snapshot", true, [{
      revision: 0,
      sequence: 0,
      entityType: "profile",
      entityId: "profile-1",
      operation: "upsert",
      payload: { id: "profile-1", displayName: "Cached", units: "metric", updatedAt: "2026-07-25T13:00:00.000Z" }
    }]));
    const coordinator = new ReplicaSyncCoordinator(
      new ReplicaClient({
        get: async () => ({
          protocolVersion: 1,
          ...identity,
          serverInstanceId: "f60e92e9-f145-449e-ad3b-22dca8bc8ac7",
          highWaterMark: { revision: 0, sequence: 0 }
        })
      }),
      store,
      identity
    );

    await expect(coordinator.synchronize()).rejects.toThrow("identity changed");
    expect(await store.replicaEntities(identity)).toHaveLength(1);
  });
});

