import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { healthConnectImportRequestSchema } from "@vitana/shared";

const mocks = vi.hoisted(() => {
  Object.defineProperty(globalThis, "__DEV__", { configurable: true, value: true });
  return {
    getSdkStatus: vi.fn(),
    aggregateGroupByDuration: vi.fn(),
    aggregateGroupByPeriod: vi.fn(),
    initialize: vi.fn(),
    readRecords: vi.fn(),
    requestPermission: vi.fn(),
    pinnedFetch: vi.fn()
  };
});

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("react-native-health-connect", () => ({
  ExerciseType: { RUNNING: 56 },
  SdkAvailabilityStatus: { SDK_AVAILABLE: "available" },
  aggregateGroupByDuration: mocks.aggregateGroupByDuration,
  aggregateGroupByPeriod: mocks.aggregateGroupByPeriod,
  getSdkStatus: mocks.getSdkStatus,
  initialize: mocks.initialize,
  readRecords: mocks.readRecords,
  requestPermission: mocks.requestPermission
}));
vi.mock("./endpointStore", () => ({
  DEFAULT_HEALTH_CONNECT_SYNC_WINDOW_DAYS: 365,
  HEALTH_CONNECT_CATEGORIES: [
    "Steps", "Weight", "ExerciseSession", "HeartRateVariabilityRmssd", "RestingHeartRate", "RespiratoryRate"
  ]
}));
vi.mock("./pinnedFetch", () => ({ LONG_RUNNING_PINNED_REQUEST_TIMEOUT_MS: 60_000, pinnedFetch: mocks.pinnedFetch }));

import { HEALTH_CONNECT_DESCRIPTORS, chunkPayload, syncHealthConnect, type HealthConnectImportPayload } from "./syncHealthConnect";

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
  mocks.aggregateGroupByDuration.mockResolvedValue([]);
  mocks.aggregateGroupByPeriod.mockResolvedValue([]);
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
  it("uses the Health Connect exercise type name for activity sessions", () => {
    const descriptor = HEALTH_CONNECT_DESCRIPTORS.find((entry) => entry.category === "ExerciseSession")!;
    const converted = descriptor.toPayload([{
      startTime: "2026-01-10T10:00:00.000Z",
      endTime: "2026-01-10T11:00:00.000Z",
      exerciseType: 56
    }, {
      startTime: "2026-01-10T12:00:00.000Z",
      endTime: "2026-01-10T13:00:00.000Z",
      exerciseType: 999
    }] as never);

    expect(converted.exerciseSessions).toMatchObject([
      { activityType: "Running", details: { exerciseType: 56 } },
      { activityType: "exercise_type_999", details: { exerciseType: 999 } }
    ]);
  });

  it("omits nullable sleep metadata returned by Health Connect", () => {
    const descriptor = HEALTH_CONNECT_DESCRIPTORS.find((entry) => entry.category === "SleepSession")!;
    const converted = descriptor.toPayload([{
      startTime: "2026-01-10T22:00:00.000Z",
      endTime: "2026-01-11T06:00:00.000Z",
      stages: null,
      title: null,
      notes: null
    } as never]);
    const sleepSession = converted.sleepSessions[0]!;

    expect(sleepSession).toMatchObject({ durationMinutes: 480 });
    expect(sleepSession).not.toHaveProperty("stages");
    expect(sleepSession).not.toHaveProperty("title");
    expect(sleepSession).not.toHaveProperty("notes");
    expect(() => healthConnectImportRequestSchema.parse({ ...emptyPayload(), ...converted })).not.toThrow();
  });

  it("reads completed native Heart Rate aggregates instead of raw samples", async () => {
    mocks.aggregateGroupByDuration.mockImplementation(async (request) => request.timeRangeSlicer.duration === "DAYS"
      ? [{
          startTime: "2026-01-10T00:00:00.000Z",
          endTime: "2026-01-11T00:00:00.000Z",
          result: { BPM_AVG: 71, BPM_MIN: 52, BPM_MAX: 121, MEASUREMENTS_COUNT: 900, dataOrigins: [] }
        }]
      : request.timeRangeFilter.endTime === "2026-01-11T12:00:00.000Z" ? [{
          startTime: "2026-01-11T11:30:00.000Z",
          endTime: "2026-01-11T11:45:00.000Z",
          result: { BPM_AVG: 74, BPM_MIN: 68, BPM_MAX: 89, MEASUREMENTS_COUNT: 24, dataOrigins: [] }
        }] : []);
    const descriptor = HEALTH_CONNECT_DESCRIPTORS.find((entry) => entry.recordType === "HeartRate")!;
    const pages = [];
    for await (const page of descriptor.readPages({
      timeRangeFilter: {
        operator: "between",
        startTime: "2025-01-11T12:00:00.000Z",
        endTime: "2026-01-11T12:07:00.000Z"
      }
    })) {
      pages.push(page);
    }

    expect(mocks.readRecords).not.toHaveBeenCalled();
    expect(mocks.aggregateGroupByDuration).toHaveBeenCalledWith(expect.objectContaining({
      recordType: "HeartRate",
      timeRangeSlicer: { duration: "DAYS", length: 1 }
    }));
    expect(mocks.aggregateGroupByDuration).toHaveBeenCalledWith(expect.objectContaining({
      recordType: "HeartRate",
      timeRangeFilter: {
        operator: "between",
        startTime: "2025-10-13T12:15:00.000Z",
        endTime: "2025-10-20T12:15:00.000Z"
      },
      timeRangeSlicer: { duration: "MINUTES", length: 15 }
    }));
    const quarterHourCalls = mocks.aggregateGroupByDuration.mock.calls
      .map(([request]) => request)
      .filter((request) => request.timeRangeSlicer.duration === "MINUTES");
    expect(quarterHourCalls).toHaveLength(13);
    expect(quarterHourCalls.at(-1)?.timeRangeFilter).toEqual({
      operator: "between",
      startTime: "2026-01-05T12:15:00.000Z",
      endTime: "2026-01-11T12:00:00.000Z"
    });
    expect(pages.flatMap((page) => page.heartRate)).toEqual([
      expect.objectContaining({ granularity: "day", average: 71, minimum: 52, maximum: 121, count: 900 }),
      expect.objectContaining({ granularity: "15m", average: 74, minimum: 68, maximum: 89, count: 24 })
    ]);
    for (const page of pages) {
      expect(() => healthConnectImportRequestSchema.parse({ ...emptyPayload(), ...page })).not.toThrow();
    }
  });

  it("does not request permission when no categories are selected", async () => {
    await expect(syncHealthConnect("https://desktop.test", "companion-token", null, "pin", {
      deviceId: "device-1"
    })).rejects.toThrow("Select at least one data category to sync.");

    expect(mocks.requestPermission).not.toHaveBeenCalled();
  });

  it("reads and uploads Heart Rate Variability RMSSD readings", async () => {
    mocks.requestPermission.mockResolvedValue([{ accessType: "read", recordType: "HeartRateVariabilityRmssd" }]);
    mocks.readRecords.mockResolvedValue({
      records: [{
        time: "2026-01-10T08:00:00.000Z",
        heartRateVariabilityMillis: 36.5,
        metadata: { id: "hrv-record-1", dataOrigin: "com.samsung.android.app.shealth" }
      }],
      pageToken: undefined
    });

    const result = await syncHealthConnect("https://desktop.test", "companion-token", null, "pin", {
      deviceId: "device-1",
      syncWindowDays: 30,
      categories: ["HeartRateVariabilityRmssd"]
    });

    expect(mocks.requestPermission).toHaveBeenCalledWith([
      { accessType: "read", recordType: "HeartRateVariabilityRmssd" }
    ]);
    expect(mocks.readRecords).toHaveBeenCalledWith("HeartRateVariabilityRmssd", expect.objectContaining({
      timeRangeFilter: expect.objectContaining({ operator: "between" })
    }));
    expect(uploadedBodies()[0]?.hrvRmssd).toEqual(expect.arrayContaining([
      expect.objectContaining({
        granularity: "day",
        average: 36.5,
        minimum: 36.5,
        maximum: 36.5,
        count: 1,
        provenance: { aggregation: "companion-daily", dataOrigins: ["com.samsung.android.app.shealth"] }
      }),
      expect.objectContaining({
        granularity: "15m",
        average: 36.5,
        minimum: 36.5,
        maximum: 36.5,
        count: 1,
        provenance: { aggregation: "companion-15m", dataOrigins: ["com.samsung.android.app.shealth"] }
      })
    ]));
    expect(result.syncCursors).toEqual({ HeartRateVariabilityRmssd: "2026-01-11T12:00:00.000Z" });
  });

  it("aggregates and uploads resting heart rate and respiratory rate readings", async () => {
    mocks.requestPermission.mockResolvedValue([
      { accessType: "read", recordType: "RestingHeartRate" },
      { accessType: "read", recordType: "RespiratoryRate" }
    ]);
    mocks.readRecords.mockImplementation(async (recordType: string) => ({
      records: recordType === "RestingHeartRate"
        ? [{ time: "2026-01-10T08:00:00.000Z", beatsPerMinute: 54 }]
        : [{ time: "2026-01-10T08:05:00.000Z", rate: 14.5 }],
      pageToken: undefined
    }));

    const result = await syncHealthConnect("https://desktop.test", "companion-token", null, "pin", {
      deviceId: "device-1",
      syncWindowDays: 30,
      categories: ["RestingHeartRate", "RespiratoryRate"]
    });

    expect(mocks.requestPermission).toHaveBeenCalledWith([
      { accessType: "read", recordType: "RestingHeartRate" },
      { accessType: "read", recordType: "RespiratoryRate" }
    ]);
    expect(uploadedBodies()[0]?.restingHeartRate).toEqual(expect.arrayContaining([
      expect.objectContaining({ granularity: "day", average: 54, minimum: 54, maximum: 54, count: 1 }),
      expect.objectContaining({ granularity: "15m", average: 54, minimum: 54, maximum: 54, count: 1 })
    ]));
    expect(uploadedBodies()[0]?.respiratoryRate).toEqual(expect.arrayContaining([
      expect.objectContaining({ granularity: "day", average: 14.5, minimum: 14.5, maximum: 14.5, count: 1 }),
      expect.objectContaining({ granularity: "15m", average: 14.5, minimum: 14.5, maximum: 14.5, count: 1 })
    ]));
    expect(result.syncCursors).toEqual({
      RestingHeartRate: "2026-01-11T12:00:00.000Z",
      RespiratoryRate: "2026-01-11T12:00:00.000Z"
    });
  });

  it("aligns a Steps cursor to completed local days and leaves ungranted categories on their old cursor", async () => {
    mocks.aggregateGroupByPeriod.mockResolvedValue([
      { startTime: "2026-01-10T00:00:00", endTime: "2026-01-11T00:00:00", result: { COUNT_TOTAL: 10, dataOrigins: [] } },
      { startTime: "2026-01-11T00:00:00", endTime: "2026-01-12T00:00:00", result: { COUNT_TOTAL: 11, dataOrigins: [] } }
    ]);

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
    expect(mocks.aggregateGroupByPeriod).toHaveBeenCalledWith(expect.objectContaining({
      timeRangeFilter: {
        operator: "between",
        startTime: localMidnightIso("2026-01-10T11:55:00.000Z"),
        endTime: localMidnightIso("2026-01-11T12:00:00.000Z")
      }
    }));
    expect(mocks.readRecords).not.toHaveBeenCalled();
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

    expect(mocks.aggregateGroupByPeriod.mock.calls[0][0].timeRangeFilter.startTime).toBe(localMidnightIso("2026-01-10T11:55:00.000Z"));
    expect(mocks.readRecords.mock.calls[0][1].timeRangeFilter.startTime).toBe("2025-12-12T12:00:00.000Z");
  });

  it("keeps an empty category's cursor open while requesting historical access", async () => {
    const result = await syncHealthConnect("https://desktop.test", "companion-token", null, "pin", {
      deviceId: "device-1",
      syncWindowDays: 90,
      categories: ["Steps"]
    });

    expect(mocks.requestPermission).toHaveBeenCalledWith([
      { accessType: "read", recordType: "Steps" },
      { accessType: "read", recordType: "ReadHealthDataHistory" }
    ]);
    expect(result.syncCursors).toEqual({});
    expect(result.details).toContain("Extended Health Connect history access was requested");
    expect(result.details).toContain("Health Connect returned no records in this window");
    expect(result.details).toContain("No records returned: Steps. First-sync backfill was kept because no valid prior cursor exists.");
  });

  it("advances successful empty reads only for categories with valid existing cursors", async () => {
    mocks.requestPermission.mockResolvedValue([
      { accessType: "read", recordType: "Steps" },
      { accessType: "read", recordType: "Weight" }
    ]);

    const result = await syncHealthConnect("https://desktop.test", "companion-token", null, "pin", {
      deviceId: "device-1",
      syncCursors: { Steps: "2026-01-10T12:00:00.000Z", Weight: "not-a-date" },
      syncWindowDays: 30,
      categories: ["Steps", "Weight"]
    });

    expect(result.syncCursors).toEqual({
      Steps: "2026-01-11T12:00:00.000Z",
      Weight: "not-a-date"
    });
    expect(result.details).toContain("No records returned: Steps. Existing sync start dates advanced after the successful read.");
    expect(result.details).toContain("No records returned: Weight. First-sync backfill was kept because no valid prior cursor exists.");
  });

  it("uploads Health Connect-resolved daily step totals instead of overlapping raw records", async () => {
    mocks.aggregateGroupByPeriod.mockResolvedValue([{
      startTime: "2026-01-09T00:00:00",
      endTime: "2026-01-10T00:00:00",
      result: { COUNT_TOTAL: 8450, dataOrigins: ["com.google.android.apps.fitness"] }
    }]);

    const result = await syncHealthConnect("https://desktop.test", "companion-token", null, "pin", {
      deviceId: "device-1",
      syncWindowDays: 30,
      categories: ["Steps"]
    });

    expect(mocks.aggregateGroupByPeriod).toHaveBeenCalledWith(expect.objectContaining({
      recordType: "Steps",
      timeRangeFilter: {
        operator: "between",
        startTime: localMidnightIso("2025-12-12T12:00:00.000Z"),
        endTime: localMidnightIso("2026-01-11T12:00:00.000Z")
      },
      timeRangeSlicer: { period: "DAYS", length: 1 }
    }));
    expect(mocks.readRecords).not.toHaveBeenCalled();
    expect(uploadedBodies()[0].steps).toEqual([expect.objectContaining({
      startTime: localDateTimeIso("2026-01-09T00:00:00"),
      endTime: localDateTimeIso("2026-01-10T00:00:00", -1),
      count: 8450,
      provenance: {
        aggregation: "health-connect-daily",
        calendarDate: "2026-01-09",
        dataOrigins: ["com.google.android.apps.fitness"]
      }
    })]);
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

    const chunks = chunkPayload(payload, 1_300);

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

  it("accounts exactly for escaped Unicode records at the upload boundary", () => {
    const payload = emptyPayload();
    const record = {
      startTime: "2026-01-10T10:00:00.000Z",
      endTime: "2026-01-10T11:00:00.000Z",
      activityType: "run",
      title: "Café 🏃 \"晨\""
    };
    payload.exerciseSessions = [record];
    const exactBytes = new TextEncoder().encode(JSON.stringify({
      ...emptyPayload(),
      batchId: "2026-01-11T12:00:00.000Z:1",
      exerciseSessions: [record]
    })).length;

    expect(chunkPayload(payload, exactBytes)).toHaveLength(1);
    expect(() => chunkPayload(payload, exactBytes - 1)).toThrow(
      `A single Health Connect exerciseSessions record is ${exactBytes} UTF-8 bytes and exceeds the ${exactBytes - 1}-byte upload limit.`
    );
  });

  it("rejects one oversized record locally instead of emitting an oversized chunk", () => {
    const payload = emptyPayload();
    payload.exerciseSessions = [{
      startTime: "2026-01-10T10:00:00.000Z",
      endTime: "2026-01-10T11:00:00.000Z",
      activityType: "run",
      title: "large".repeat(200)
    }];

    expect(() => chunkPayload(payload, 600)).toThrow(
      /single Health Connect exerciseSessions record.*exceeds the 600-byte upload limit/
    );
  });
});

function emptyPayload(): HealthConnectImportPayload {
  return {
    syncedAt: "2026-01-11T12:00:00.000Z",
    rangeStart: "2026-01-01T12:00:00.000Z",
    rangeEnd: "2026-01-11T12:00:00.000Z",
    deviceLabel: "android-companion:device-1",
    steps: [], heartRate: [], restingHeartRate: [], oxygenSaturation: [], hrvRmssd: [], respiratoryRate: [], basalMetabolicRateKcalDay: [],
    heightCm: [], vo2MaxMlKgMin: [], weightKg: [], exerciseSessions: [], distanceMeters: [],
    activeCaloriesKcal: [], totalCaloriesKcal: [], sleepSessions: [], bodyFatPct: []
  };
}

function localMidnightIso(value: string): string {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function localDateTimeIso(value: string, offsetMs = 0): string {
  return new Date(new Date(value).getTime() + offsetMs).toISOString();
}
