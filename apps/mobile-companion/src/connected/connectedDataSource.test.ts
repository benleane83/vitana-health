import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  live: {
    bootstrap: vi.fn(),
    analytics: vi.fn(),
    summary: vi.fn(),
    healthDataDetail: vi.fn(),
    healthDataChartSeries: vi.fn(),
    calendarMonth: vi.fn(),
    journal: vi.fn(),
    bodyTrendTimeline: vi.fn(),
    importManualObservations: vi.fn(),
    updateObservation: vi.fn(),
    deleteObservation: vi.fn(),
    setPersonalReferenceRange: vi.fn(),
    removePersonalReferenceRange: vi.fn(),
    listHealthEvents: vi.fn(),
    listCareItems: vi.fn(),
    createHealthEvent: vi.fn(),
    updateHealthEvent: vi.fn(),
    deleteHealthEvent: vi.fn(),
    createCareItem: vi.fn(),
    updateCareItem: vi.fn(),
    completeCareItem: vi.fn(),
    deleteCareItem: vi.fn()
  },
  cached: {
    bootstrap: vi.fn(),
    analytics: vi.fn(),
    summary: vi.fn(),
    healthDataDetail: vi.fn(),
    healthDataChartSeries: vi.fn(),
    calendarMonth: vi.fn(),
    journal: vi.fn(),
    bodyTrendTimeline: vi.fn(),
    listHealthEvents: vi.fn(),
    listCareItems: vi.fn(),
    metadata: vi.fn()
  },
  synchronize: vi.fn(),
  saveConnection: vi.fn(),
  createReplicaNetwork: vi.fn(),
  createCompanionApi: vi.fn()
}));

vi.mock("../api", () => ({ createCompanionApi: mocks.createCompanionApi }));
vi.mock("../endpointStore", () => ({ saveConnection: mocks.saveConnection }));
vi.mock("../pinnedFetch", () => ({ LONG_RUNNING_PINNED_REQUEST_TIMEOUT_MS: 60_000 }));
vi.mock("./createConnectedStore", () => ({ createConnectedStore: () => Promise.resolve({ close: vi.fn() }) }));
vi.mock("./connectedRepository", () => ({
  ConnectedReplicaRepository: class {
    bootstrap = mocks.cached.bootstrap;
    analytics = mocks.cached.analytics;
    summary = mocks.cached.summary;
    healthDataDetail = mocks.cached.healthDataDetail;
    healthDataChartSeries = mocks.cached.healthDataChartSeries;
    calendarMonth = mocks.cached.calendarMonth;
    journal = mocks.cached.journal;
    bodyTrendTimeline = mocks.cached.bodyTrendTimeline;
    listHealthEvents = mocks.cached.listHealthEvents;
    listCareItems = mocks.cached.listCareItems;
    metadata = mocks.cached.metadata;
    identity = {
      serverInstanceId: "server-1",
      profileId: "profile-1",
      pairingId: "pairing-1"
    };
  }
}));
vi.mock("./replicaClient", () => ({
  createReplicaNetwork: mocks.createReplicaNetwork,
  ReplicaClient: class {}
}));
vi.mock("./syncCoordinator", () => ({
  ReplicaSyncCoordinator: class {
    synchronize = mocks.synchronize;
    dispose() {}
  }
}));

import { createConnectedDataSource, ReplicaRefreshFailedError } from "./connectedDataSource";

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
  healthSourceCursors: {},
  healthSourceSessionKey: null,
  healthConnectSyncWindowDays: 30,
  healthSourceCategories: [],
  healthConnectDisclosureAcknowledged: false
};

describe("connected data source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createCompanionApi.mockReturnValue(mocks.live);
    mocks.saveConnection.mockImplementation(async (updated) => ({ ...connection, ...updated }));
    mocks.synchronize.mockResolvedValue({
      identity: {
        serverInstanceId: "server-1",
        profileId: "profile-1",
        pairingId: "pairing-1"
      },
      cachedAt: "2026-07-25T14:00:00.000Z"
    });
    mocks.cached.metadata.mockResolvedValue({ appliedAt: "2099-07-25T14:00:00.000Z" });
  });

  it("completes the first snapshot and persists its identity before activation", async () => {
    const uninitializedConnection = {
      ...connection,
      serverInstanceId: null,
      profileId: null,
      pairingId: null
    };
    const source = createConnectedDataSource(uninitializedConnection);

    const prepared = await source.prepareConnectedReplica();

    expect(mocks.createReplicaNetwork).toHaveBeenCalledWith(uninitializedConnection, 60_000);
    expect(mocks.synchronize).toHaveBeenCalledOnce();
    expect(mocks.saveConnection).toHaveBeenCalledWith(expect.objectContaining({
      serverInstanceId: "server-1",
      profileId: "profile-1",
      pairingId: "pairing-1"
    }));
    expect(mocks.saveConnection.mock.calls[0]?.[0]).not.toHaveProperty("healthSourceCategories");
    expect(prepared).toEqual(expect.objectContaining({
      serverInstanceId: "server-1",
      profileId: "profile-1",
      pairingId: "pairing-1"
    }));
  });

  it("uses replica reads immediately and keeps Connected mutations live", async () => {
    mocks.cached.summary.mockResolvedValue({ categories: [] });
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

    expect(mocks.cached.summary).toHaveBeenCalledOnce();
    expect(mocks.live.summary).not.toHaveBeenCalled();
    expect(mocks.live.updateObservation).toHaveBeenCalledOnce();
    expect(mocks.synchronize).toHaveBeenCalledOnce();
    expect(mocks.createCompanionApi).toHaveBeenCalledWith(connection, 60_000);
    expect(source.connectionError(summary)).toBeUndefined();
  });

  it("writes personal reference ranges live and refreshes the replica", async () => {
    mocks.live.setPersonalReferenceRange.mockResolvedValue({ source: "personal" });
    const source = createConnectedDataSource(connection);

    await source.setPersonalReferenceRange("weight", {
      low: 130,
      high: 190,
      optimalLow: 145,
      optimalHigh: 175,
      unit: "lb"
    });

    expect(mocks.live.setPersonalReferenceRange).toHaveBeenCalledWith("weight", {
      low: 130,
      high: 190,
      optimalLow: 145,
      optimalHigh: 175,
      unit: "lb"
    });
    expect(mocks.synchronize).toHaveBeenCalledOnce();
  });

  it("reports a mutation refresh failure instead of leaving the replica silently stale", async () => {
    const refreshError = new Error("Replica refresh failed");
    mocks.live.createCareItem.mockResolvedValue({ id: "care-1" });
    mocks.synchronize.mockRejectedValueOnce(refreshError);
    mocks.cached.listCareItems.mockResolvedValue({ items: [], total: 0 });
    const source = createConnectedDataSource(connection);

    // The item was created on the PC, so the user must not be told the save failed - that is how
    // duplicates appear.
    await expect(source.createCareItem({
      kind: "visit",
      title: "Book follow-up",
      priority: "normal",
      status: "open"
    })).rejects.toBeInstanceOf(ReplicaRefreshFailedError);

    expect(mocks.live.createCareItem).toHaveBeenCalledOnce();
    expect(mocks.synchronize).toHaveBeenCalledOnce();

    // The next read knows the replica is behind the user's own change and catches up first.
    await source.listCareItems({});
    expect(mocks.synchronize).toHaveBeenCalledTimes(2);
  });

  it("reads metric detail and Care without making a live request", async () => {
    mocks.cached.healthDataDetail.mockResolvedValue({
      generatedAt: "2026-07-25T14:00:00.000Z",
      measurement: {
        code: "weight",
        displayName: "Weight",
        category: "body",
        aggregation: "latest",
        counts: { observations: 1, samples: 0, activities: 0, total: 1 },
        lastMeasuredAt: "2026-07-25T14:00:00.000Z"
      },
      referenceRange: { source: "none" },
      entries: [],
      chartPoints: [{ kind: "observation", timestamp: "2026-07-25T14:00:00.000Z", value: 70, unit: "kg" }],
      counts: { observations: 1, samples: 0, activities: 0, total: 1 },
      deletion: { observationEntries: 1, deletableEntries: 1 },
      pagination: { limit: 50, loaded: 0, total: 0, hasMore: false }
    });
    mocks.cached.healthDataChartSeries.mockResolvedValue({
      generatedAt: "2026-07-25T14:00:00.000Z",
      measurementCode: "weight",
      range: "all",
      requestedMode: "auto",
      granularity: "raw",
      aggregation: "latest",
      points: [{ kind: "observation", timestamp: "2026-07-25T14:00:00.000Z", value: 70, unit: "kg", count: 1 }],
      totalPoints: 1,
      truncated: false
    });
    mocks.cached.listCareItems.mockResolvedValue({ items: [], total: 0 });
    const source = createConnectedDataSource(connection);

    const detail = await source.healthDataDetail("weight");
    const chart = await source.healthDataChartSeries("weight", { range: "all", mode: "auto" });
    const care = await source.listCareItems({ status: "open" });
    expect(detail.measurement.code).toBe("weight");
    expect(chart).toMatchObject({ aggregation: "latest", points: [{ value: 70, unit: "kg" }] });
    expect(care).toEqual({ items: [], total: 0 });

    expect(mocks.cached.healthDataDetail).toHaveBeenCalledOnce();
    expect(mocks.cached.healthDataChartSeries).toHaveBeenCalledOnce();
    expect(mocks.cached.listCareItems).toHaveBeenCalledOnce();
    expect(mocks.live.healthDataDetail).not.toHaveBeenCalled();
    expect(mocks.live.healthDataChartSeries).not.toHaveBeenCalled();
    expect(mocks.live.listCareItems).not.toHaveBeenCalled();
  });

  it("reads Journal, Calendar, and Body Trend from the replica", async () => {
    mocks.cached.journal.mockResolvedValue({ timezone: "UTC", days: [] });
    mocks.cached.calendarMonth.mockResolvedValue({ month: "2026-07", timezone: "UTC", measurements: [], events: [] });
    mocks.cached.bodyTrendTimeline.mockResolvedValue({
      generatedAt: "2026-07-25T14:00:00.000Z",
      range: "all",
      timezone: "UTC",
      unit: "kg",
      points: [],
      totalPoints: 0,
      truncated: false
    });
    const source = createConnectedDataSource(connection);

    await source.journal({ timezone: "UTC", dayLimit: 14 });
    await source.calendarMonth({ month: "2026-07", timezone: "UTC", measurementCodes: ["weight"] });
    await source.bodyTrendTimeline({ range: "all", timezone: "UTC" });

    expect(mocks.cached.journal).toHaveBeenCalledOnce();
    expect(mocks.cached.calendarMonth).toHaveBeenCalledOnce();
    expect(mocks.cached.bodyTrendTimeline).toHaveBeenCalledOnce();
    expect(mocks.live.journal).not.toHaveBeenCalled();
    expect(mocks.live.calendarMonth).not.toHaveBeenCalled();
    expect(mocks.live.bodyTrendTimeline).not.toHaveBeenCalled();
  });

  it("skips fresh background synchronization but honors an explicit refresh", async () => {
    const source = createConnectedDataSource(connection);

    await expect(source.synchronizeConnectedReplica()).resolves.toBe(false);
    expect(mocks.synchronize).not.toHaveBeenCalled();
    await expect(source.synchronizeConnectedReplica({ force: true })).resolves.toBe(true);
    expect(mocks.synchronize).toHaveBeenCalledOnce();
  });
});
