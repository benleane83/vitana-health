import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  Object.defineProperty(globalThis, "__DEV__", { configurable: true, value: true });
  return {
    getSdkStatus: vi.fn(),
    initialize: vi.fn(),
    readRecords: vi.fn(),
    requestPermission: vi.fn(),
    pinnedFetch: vi.fn()
  };
});

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("react-native-health-connect", () => ({
  SdkAvailabilityStatus: { SDK_AVAILABLE: "available" },
  getSdkStatus: mocks.getSdkStatus,
  initialize: mocks.initialize,
  readRecords: mocks.readRecords,
  requestPermission: mocks.requestPermission
}));
vi.mock("./endpointStore", () => ({
  DEFAULT_HEALTH_CONNECT_SYNC_WINDOW_DAYS: 365,
  HEALTH_CONNECT_CATEGORIES: ["Steps", "Weight", "ExerciseSession"]
}));
vi.mock("./pinnedFetch", () => ({ LONG_RUNNING_PINNED_REQUEST_TIMEOUT_MS: 60_000, pinnedFetch: mocks.pinnedFetch }));

import { chunkPayload, syncHealthConnect, type HealthConnectImportPayload } from "./syncHealthConnect";

const sessionsPath = "/api/import/health-connect/sessions";

function jsonResponse(body: unknown, status = 201) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function sessionBody(processedBatchIds: string[] = []) {
  return { protocolVersion: 1, sessionId: "session-1", processedBatchIds };
}

function acknowledgementBody() {
  return { protocolVersion: 1, sessionId: "session-1", batchId: "batch", counts: { accepted: 2, duplicates: 0, rejected: 0 } };
}

/** Routes the session handshake and the chunk uploads the way the API does, recording call order. */
function mockTransport(options: { processedBatchIds?: string[] } = {}): string[] {
  const order: string[] = [];
  mocks.pinnedFetch.mockImplementation(async (url: string) => {
    if (url.endsWith(sessionsPath)) {
      order.push("session");
      return jsonResponse(sessionBody(options.processedBatchIds));
    }
    order.push("upload");
    return jsonResponse(acknowledgementBody());
  });
  return order;
}

function uploadedBodies(): Array<Record<string, any>> {
  return (mocks.pinnedFetch.mock.calls as any[][])
    .filter((call) => !String(call[0]).endsWith(sessionsPath))
    .map((call) => JSON.parse(call[2].body));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-11T12:00:00.000Z"));
  mocks.getSdkStatus.mockResolvedValue("available");
  mocks.initialize.mockResolvedValue(true);
  mocks.requestPermission.mockResolvedValue([{ accessType: "read", recordType: "Steps" }]);
  mocks.readRecords.mockResolvedValue({ records: [], pageToken: undefined });
  mockTransport();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("Health Connect sync", () => {
  it("does not request permission when no categories are selected", async () => {
    await expect(syncHealthConnect("https://desktop.test", "companion-token", null, "pin", {
      deviceId: "device-1"
    })).rejects.toThrow("Select at least one data category to sync.");

    expect(mocks.requestPermission).not.toHaveBeenCalled();
  });

  it("uses an overlapping cursor, follows pages, and leaves ungranted categories on their old cursor", async () => {
    mocks.readRecords.mockImplementation(async (_recordType: string, options: { pageToken?: string }) => (
      options.pageToken
        ? { records: [{ startTime: "2026-01-10T11:00:00.000Z", endTime: "2026-01-10T11:05:00.000Z", count: 11 }], pageToken: undefined }
        : { records: [{ startTime: "2026-01-10T10:00:00.000Z", endTime: "2026-01-10T10:05:00.000Z", count: 10 }], pageToken: "next" }
    ));

    const result = await syncHealthConnect("https://desktop.test/", "companion-token", "profile-1", "pin", {
      deviceId: "device-1",
      syncCursors: { Steps: "2026-01-10T12:00:00.000Z", Weight: "2026-01-05T12:00:00.000Z" },
      syncWindowDays: 30,
      categories: ["Steps", "Weight"]
    });

    expect(mocks.requestPermission).toHaveBeenCalledWith([
      { accessType: "read", recordType: "Steps" },
      { accessType: "read", recordType: "Weight" }
    ]);
    expect(mocks.readRecords).toHaveBeenCalledTimes(2);
    expect(mocks.readRecords.mock.calls[0][1]).toMatchObject({
      pageToken: undefined,
      timeRangeFilter: { startTime: "2026-01-10T11:55:00.000Z", endTime: "2026-01-11T12:00:00.000Z" }
    });
    expect(mocks.readRecords.mock.calls[1][1].pageToken).toBe("next");
    expect(mocks.pinnedFetch.mock.calls[1][0]).toBe("https://desktop.test/api/import/health-connect/sessions/session-1/chunks");
    expect(mocks.pinnedFetch.mock.calls[1][2].headers["x-companion-token"]).toBe("companion-token");
    expect(uploadedBodies()[0].steps).toHaveLength(2);
    expect(result.syncCursors).toEqual({
      Steps: "2026-01-11T12:00:00.000Z",
      Weight: "2026-01-05T12:00:00.000Z"
    });
    expect(result.details).toContain("Synced 2 records");
    expect(result.details).toContain("Oldest record returned by Health Connect: 2026-01-10");
  });

  it("backfills a newly enabled category over the full window while resuming the others", async () => {
    mocks.requestPermission.mockResolvedValue([
      { accessType: "read", recordType: "Steps" },
      { accessType: "read", recordType: "Weight" }
    ]);

    await syncHealthConnect("https://desktop.test", "companion-token", null, "pin", {
      deviceId: "device-1",
      syncCursors: { Steps: "2026-01-10T12:00:00.000Z" },
      syncWindowDays: 30,
      categories: ["Steps", "Weight"]
    });

    expect(mocks.readRecords.mock.calls[0][1].timeRangeFilter.startTime).toBe("2026-01-10T11:55:00.000Z");
    expect(mocks.readRecords.mock.calls[1][1].timeRangeFilter.startTime).toBe("2025-12-12T12:00:00.000Z");
  });

  it("requests historical access for sync windows over 30 days", async () => {
    const result = await syncHealthConnect("https://desktop.test", "companion-token", null, "pin", {
      deviceId: "device-1",
      syncWindowDays: 90,
      categories: ["Steps"]
    });

    expect(mocks.requestPermission).toHaveBeenCalledWith([
      { accessType: "read", recordType: "Steps" },
      { accessType: "read", recordType: "ReadHealthDataHistory" }
    ]);
    expect(result.syncCursors).toEqual({ Steps: "2026-01-11T12:00:00.000Z" });
    expect(result.details).toContain("Extended Health Connect history access was requested");
    expect(result.details).toContain("Health Connect returned no records in this window");
  });

  it("does not upload near-24-hour daily aggregate step records", async () => {
    mocks.readRecords.mockResolvedValue({
      records: [
        { startTime: "2026-01-09T00:00:00.000Z", endTime: "2026-01-09T23:59:59.999Z", count: 8450 },
        { startTime: "2026-01-10T10:00:00.000Z", endTime: "2026-01-10T10:05:00.000Z", count: 120 }
      ],
      pageToken: undefined
    });

    const result = await syncHealthConnect("https://desktop.test", "companion-token", null, "pin", {
      deviceId: "device-1",
      syncWindowDays: 30,
      categories: ["Steps"]
    });

    expect(uploadedBodies()[0].steps).toEqual([
      expect.objectContaining({ startTime: "2026-01-10T10:00:00.000Z", count: 120 })
    ]);
    expect(result.details).toContain("Synced 1 records");
  });

  it("uploads while it is still reading rather than buffering the whole window", async () => {
    const order = mockTransport();
    const page = (label: string) => ({
      records: Array.from({ length: 800 }, () => ({
        startTime: "2026-01-10T10:00:00.000Z",
        endTime: "2026-01-10T11:00:00.000Z",
        exerciseType: "run",
        title: label.repeat(1_500)
      })),
      pageToken: label === "a" ? "next" : undefined
    });
    mocks.requestPermission.mockResolvedValue([{ accessType: "read", recordType: "ExerciseSession" }]);
    mocks.readRecords.mockImplementation(async (_recordType: string, options: { pageToken?: string }) => {
      order.push("read");
      return options.pageToken ? page("b") : page("a");
    });

    await syncHealthConnect("https://desktop.test", "companion-token", null, "pin", {
      deviceId: "device-1",
      categories: ["ExerciseSession"]
    });

    const bodies = uploadedBodies();
    expect(bodies.length).toBeGreaterThan(1);
    // An upload landing before the last read is what proves nothing is held back until the end.
    expect(order.indexOf("upload")).toBeLessThan(order.lastIndexOf("read"));
    expect(bodies.every((body) => new TextEncoder().encode(JSON.stringify(body)).length <= 2_000_000)).toBe(true);
    expect(bodies.flatMap((body) => body.exerciseSessions)).toHaveLength(1_600);
  });

  it("resumes a session by skipping batches the PC already acknowledged", async () => {
    mockTransport({ processedBatchIds: ["device-1:resumed:1"] });
    mocks.readRecords.mockResolvedValue({
      records: [{ startTime: "2026-01-10T10:00:00.000Z", endTime: "2026-01-10T10:05:00.000Z", count: 120 }],
      pageToken: undefined
    });

    const sessionKeys: Array<string | null> = [];
    await syncHealthConnect("https://desktop.test", "companion-token", null, "pin", {
      deviceId: "device-1",
      sessionKey: "device-1:resumed",
      categories: ["Steps"],
      onSessionKey: (key) => { sessionKeys.push(key); }
    });

    expect(uploadedBodies()).toHaveLength(0);
    expect(mocks.pinnedFetch).toHaveBeenCalledTimes(1);
    expect(sessionKeys).toEqual(["device-1:resumed", null]);
  });

  it("mints batch IDs from the session key so a resumed sync reproduces them", async () => {
    await syncHealthConnect("https://desktop.test", "companion-token", null, "pin", {
      deviceId: "device-1",
      sessionKey: "device-1:resumed",
      categories: ["Steps"]
    });

    expect(uploadedBodies()[0]).toMatchObject({ batchId: "device-1:resumed:1", sessionId: "session-1", protocolVersion: 1 });
  });

  it("stops immediately when the sync is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(syncHealthConnect("https://desktop.test", "companion-token", null, "pin", {
      deviceId: "device-1",
      categories: ["Steps"],
      signal: controller.signal
    })).rejects.toThrow("Sync was cancelled.");

    expect(mocks.pinnedFetch).not.toHaveBeenCalled();
  });

  it("retries a timeout once without changing the upload payload or authentication", async () => {
    mocks.pinnedFetch
      .mockRejectedValueOnce(new Error("Pinned HTTPS request timed out while waiting for the API response."))
      .mockImplementation(async (url: string) => (url.endsWith(sessionsPath)
        ? jsonResponse(sessionBody())
        : jsonResponse(acknowledgementBody())));

    const sync = syncHealthConnect("https://desktop.test", "companion-token", null, "pin", {
      deviceId: "device-1",
      categories: ["Steps"]
    });
    await vi.advanceTimersByTimeAsync(1000);
    await sync;

    expect(mocks.pinnedFetch).toHaveBeenCalledTimes(3);
    expect(mocks.pinnedFetch.mock.calls[0][2].body).toBe(mocks.pinnedFetch.mock.calls[1][2].body);
    expect(mocks.pinnedFetch.mock.calls[1][2].headers["x-companion-token"]).toBe("companion-token");
  });

  it("retries an interrupted native connection", async () => {
    mocks.pinnedFetch.mockRejectedValueOnce(
      Object.assign(new Error("The connection to your paired PC was interrupted."), { code: "network-interrupted" })
    );

    const sync = syncHealthConnect("https://desktop.test", "companion-token", null, "pin", {
      deviceId: "device-1",
      categories: ["Steps"]
    });
    await vi.advanceTimersByTimeAsync(1000);
    await sync;

    expect(mocks.pinnedFetch).toHaveBeenCalledTimes(3);
  });

  it("reports the permission, read, upload, and finalization stages", async () => {
    const onProgress = vi.fn();

    await syncHealthConnect("https://desktop.test", "companion-token", null, "pin", {
      deviceId: "device-1",
      categories: ["Steps"],
      onProgress
    });

    expect(onProgress.mock.calls.map(([progress]) => progress.stage)).toEqual([
      "preparing",
      "permissions",
      "reading",
      "uploading",
      "finalizing"
    ]);
    expect(mocks.pinnedFetch.mock.calls[0][2].timeoutMs).toBe(60_000);
  });
});

describe("payload chunking", () => {
  it("assigns ordered batch IDs when a payload requires multiple uploads", () => {
    const payload = emptyPayload();
    payload.exerciseSessions = [
      { startTime: "2026-01-10T10:00:00.000Z", endTime: "2026-01-10T11:00:00.000Z", activityType: "run", title: "a".repeat(500) },
      { startTime: "2026-01-10T12:00:00.000Z", endTime: "2026-01-10T13:00:00.000Z", activityType: "run", title: "b".repeat(500) }
    ];

    const chunks = chunkPayload(payload, 900);

    expect(chunks).toHaveLength(2);
    expect(chunks.map((chunk) => chunk.batchId)).toEqual([
      "2026-01-11T12:00:00.000Z:1",
      "2026-01-11T12:00:00.000Z:2"
    ]);
    expect(chunks.flatMap((chunk) => chunk.exerciseSessions).map((session) => session.title)).toEqual(["a".repeat(500), "b".repeat(500)]);
  });

  it("keeps large payload chunks within the UTF-8 upload limit without losing rows", () => {
    const payload = emptyPayload();
    payload.exerciseSessions = Array.from({ length: 5_000 }, (_, index) => ({
      startTime: "2026-01-10T10:00:00.000Z",
      endTime: "2026-01-10T11:00:00.000Z",
      activityType: "run",
      title: `Session ${index} 🏃`
    }));
    const maxUploadBytes = 50_000;

    const chunks = chunkPayload(payload, maxUploadBytes);

    expect(chunks.flatMap((chunk) => chunk.exerciseSessions)).toHaveLength(5_000);
    expect(chunks.every((chunk) => new TextEncoder().encode(JSON.stringify(chunk)).length <= maxUploadBytes)).toBe(true);
  });
});

function emptyPayload(): HealthConnectImportPayload {
  return {
    syncedAt: "2026-01-11T12:00:00.000Z",
    rangeStart: "2026-01-01T12:00:00.000Z",
    rangeEnd: "2026-01-11T12:00:00.000Z",
    deviceLabel: "android-companion:device-1",
    steps: [], heartRate: [], oxygenSaturation: [], hrvRmssd: [], basalMetabolicRateKcalDay: [],
    heightCm: [], vo2MaxMlKgMin: [], weightKg: [], exerciseSessions: [], distanceMeters: [],
    activeCaloriesKcal: [], totalCaloriesKcal: [], sleepSessions: [], bodyFatPct: []
  };
}
