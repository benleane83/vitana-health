import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@vitana/api-client";

const mocks = vi.hoisted(() => ({
  live: {
    bootstrap: vi.fn(),
    analytics: vi.fn(),
    summary: vi.fn(),
    healthDataDetail: vi.fn(),
    importManualObservations: vi.fn(),
    updateObservation: vi.fn(),
    deleteObservation: vi.fn(),
    listHealthEvents: vi.fn()
  },
  cached: {
    bootstrap: vi.fn(),
    analytics: vi.fn(),
    summary: vi.fn(),
    healthDataDetail: vi.fn()
  },
  synchronize: vi.fn()
}));

vi.mock("../api", () => ({ createCompanionApi: () => mocks.live }));
vi.mock("../endpointStore", () => ({ saveConnection: vi.fn() }));
vi.mock("./createConnectedStore", () => ({ createConnectedStore: () => Promise.resolve({ close: vi.fn() }) }));
vi.mock("./connectedRepository", () => ({
  ConnectedReplicaRepository: class {
    bootstrap = mocks.cached.bootstrap;
    analytics = mocks.cached.analytics;
    summary = mocks.cached.summary;
    healthDataDetail = mocks.cached.healthDataDetail;
  }
}));
vi.mock("./replicaClient", () => ({
  createReplicaNetwork: vi.fn(),
  ReplicaClient: class {}
}));
vi.mock("./syncCoordinator", () => ({
  ReplicaSyncCoordinator: class {
    synchronize = mocks.synchronize;
    dispose() {}
  }
}));

import { createConnectedDataSource } from "./connectedDataSource";

const connection = {
  url: "https://desktop.test",
  deviceId: "device-1",
  token: "token",
  publicKeyHash: "hash",
  name: "Desktop",
  pairedAt: "2026-07-25T14:00:00.000Z",
  lastSyncAt: "2026-07-25T14:00:00.000Z",
  serverInstanceId: "server-1",
  profileId: "profile-1",
  pairingId: "pairing-1",
  healthConnectSyncCursor: null,
  healthConnectSyncWindowDays: 30,
  healthConnectCategories: [],
  healthConnectDisclosureAcknowledged: false
};

describe("connected data source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.synchronize.mockResolvedValue({
      identity: {
        serverInstanceId: "server-1",
        profileId: "profile-1",
        pairingId: "pairing-1"
      }
    });
  });

  it("uses live reads and preserves live Connected mutations while reachable", async () => {
    mocks.live.summary.mockResolvedValue({ categories: [] });
    mocks.live.updateObservation.mockResolvedValue({ updatedCount: 1 });
    const source = createConnectedDataSource(connection);

    const summary = await source.summary();
    expect(summary).toEqual({ categories: [] });
    await source.updateObservation("observation-1", {
      measurementCode: "weight",
      observedAt: "2026-07-25T14:00:00.000Z",
      value: 70,
      unit: "kg"
    });

    expect(mocks.live.summary).toHaveBeenCalledOnce();
    expect(mocks.cached.summary).not.toHaveBeenCalled();
    expect(mocks.live.updateObservation).toHaveBeenCalledOnce();
    expect(source.connectionError(summary)).toBeUndefined();
  });

  it("falls back to the replica for network read failures without redirecting mutations", async () => {
    const networkError = new Error("Network request failed");
    mocks.live.healthDataDetail.mockRejectedValue(networkError);
    mocks.cached.healthDataDetail.mockResolvedValue({ entries: [] });
    mocks.live.deleteObservation.mockRejectedValue(networkError);
    const source = createConnectedDataSource(connection);

    const detail = await source.healthDataDetail("weight");
    expect(detail).toEqual({ entries: [] });
    await expect(source.deleteObservation("observation-1")).rejects.toThrow("Network request failed");

    expect(mocks.cached.healthDataDetail).toHaveBeenCalledOnce();
    expect(source.connectionError(detail)).toBe(networkError);
  });

  it("does not hide errors returned by a reachable PC", async () => {
    mocks.live.summary.mockRejectedValue(new ApiError("Maintenance", 503, "maintenance"));
    const source = createConnectedDataSource(connection);

    await expect(source.summary()).rejects.toThrow("Maintenance");
    expect(mocks.cached.summary).not.toHaveBeenCalled();
  });
});
