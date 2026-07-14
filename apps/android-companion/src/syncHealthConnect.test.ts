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
  HEALTH_CONNECT_CATEGORIES: ["Steps", "Weight"]
}));
vi.mock("./pinnedFetch", () => ({ pinnedFetch: mocks.pinnedFetch }));

import { chunkPayload, syncHealthConnect, type HealthConnectImportPayload } from "./syncHealthConnect";

const response = {
  ok: true,
  status: 201,
  json: async () => ({ counts: { observations: 2, timeSeriesSamples: 0, activitySessions: 0 } })
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-11T12:00:00.000Z"));
  mocks.getSdkStatus.mockResolvedValue("available");
  mocks.initialize.mockResolvedValue(true);
  mocks.requestPermission.mockResolvedValue([{ accessType: "read", recordType: "Steps" }]);
  mocks.readRecords.mockResolvedValue({ records: [], pageToken: undefined });
  mocks.pinnedFetch.mockResolvedValue(response);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("Health Connect sync", () => {
  it("uses an overlapping cursor, follows pages, and does not advance after a partial permission grant", async () => {
    mocks.readRecords.mockImplementation(async (_recordType: string, options: { pageToken?: string }) => (
      options.pageToken
        ? { records: [{ startTime: "2026-01-10T11:00:00.000Z", endTime: "2026-01-10T11:05:00.000Z", count: 11 }], pageToken: undefined }
        : { records: [{ startTime: "2026-01-10T10:00:00.000Z", endTime: "2026-01-10T10:05:00.000Z", count: 10 }], pageToken: "next" }
    ));

    const result = await syncHealthConnect("https://desktop.test/", "companion-token", "profile-1", "pin", {
      deviceId: "device-1",
      syncCursor: "2026-01-10T12:00:00.000Z",
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
    expect(mocks.pinnedFetch).toHaveBeenCalledWith(
      "https://desktop.test/api/import/health-connect",
      "pin",
      expect.objectContaining({ headers: expect.objectContaining({ "x-companion-token": "companion-token" }) })
    );
    expect(JSON.parse(mocks.pinnedFetch.mock.calls[0][2].body).steps).toHaveLength(2);
    expect(result.canAdvanceCursor).toBe(false);
  });

  it("retries a timeout once without changing the upload payload or authentication", async () => {
    mocks.pinnedFetch
      .mockRejectedValueOnce(new Error("Pinned HTTPS request timed out while waiting for the API response."))
      .mockResolvedValueOnce(response);

    const sync = syncHealthConnect("https://desktop.test", "companion-token", null, "pin", {
      deviceId: "device-1",
      categories: ["Steps"]
    });
    await vi.advanceTimersByTimeAsync(1000);
    await sync;

    expect(mocks.pinnedFetch).toHaveBeenCalledTimes(2);
    expect(mocks.pinnedFetch.mock.calls[0][2].headers["x-companion-token"]).toBe("companion-token");
    expect(mocks.pinnedFetch.mock.calls[1][2].body).toBe(mocks.pinnedFetch.mock.calls[0][2].body);
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
      "2026-01-11T12:00:00.000Z:1/2",
      "2026-01-11T12:00:00.000Z:2/2"
    ]);
    expect(chunks.flatMap((chunk) => chunk.exerciseSessions).map((session) => session.title)).toEqual(["a".repeat(500), "b".repeat(500)]);
  });
});

function emptyPayload(): HealthConnectImportPayload {
  return {
    syncedAt: "2026-01-11T12:00:00.000Z",
    rangeStart: "2026-01-01T12:00:00.000Z",
    rangeEnd: "2026-01-11T12:00:00.000Z",
    deviceLabel: "android-companion:device-1",
    steps: [], heartRate: [], oxygenSaturation: [], respiratoryRate: [], hrvRmssd: [], hrvSdnn: [], basalBodyTemperatureC: [],
    basalMetabolicRateKcalDay: [], bloodGlucoseMgDl: [], bloodPressureSystolicMmHg: [], bloodPressureDiastolicMmHg: [],
    bodyTemperatureC: [], heightCm: [], skinTemperatureC: [], vo2MaxMlKgMin: [], weightKg: [], exerciseSessions: [], distanceMeters: [],
    floorsClimbed: [], activeCaloriesKcal: [], totalCaloriesKcal: [], sleepSessions: [], bodyFatPct: [], leanBodyMassKg: [],
    bodyWaterMassKg: [], boneMassKg: []
  };
}