import { describe, it, expect } from "vitest";
import { checksum } from "@local-fitness-advisor/shared";
import { parseHealthConnectImport } from "../healthConnectImport.js";
import type { HealthConnectImportRequest } from "../healthConnectImport.js";

const baseRequest: HealthConnectImportRequest = {
  syncedAt: "2026-06-01T12:00:00.000Z",
  rangeStart: "2026-05-01T00:00:00.000Z",
  rangeEnd: "2026-06-01T00:00:00.000Z",
  deviceLabel: "Pixel 8",
  steps: [],
  heartRate: [],
  oxygenSaturation: [],
  hrvRmssd: [],
  basalMetabolicRateKcalDay: [],
  heightCm: [],
  skinTemperatureC: [],
  vo2MaxMlKgMin: [],
  weightKg: [],
  exerciseSessions: [],
  distanceMeters: [],
  activeCaloriesKcal: [],
  totalCaloriesKcal: [],
  sleepSessions: [],
  bodyFatPct: []
};

describe("parseHealthConnectImport — minimal valid payload", () => {
  it("returns a health-connect source import", () => {
    const result = parseHealthConnectImport(baseRequest);
    expect(result.sourceImport.sourceKind).toBe("health-connect");
    expect(result.sourceImport.status).toBe("processed");
    expect(result.sourceImport.fileName).toContain("health-connect");
    expect(result.sourceImport.checksum).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(result.sourceImport.checksum).toBe(
      checksum(
        JSON.stringify({
          rangeStart: baseRequest.rangeStart,
          rangeEnd: baseRequest.rangeEnd,
          sourceId: result.dataSource.id,
          observations: [],
          timeSeriesSamples: [],
          activitySessions: []
        })
      )
    );
  });

  it("returns empty collections for empty payload", () => {
    const result = parseHealthConnectImport(baseRequest);
    expect(result.observations).toHaveLength(0);
    expect(result.timeSeriesSamples).toHaveLength(0);
    expect(result.activitySessions).toHaveLength(0);
  });
});

describe("parseHealthConnectImport — steps → timeSeriesSamples", () => {
  it("maps step records to timeSeriesSamples with measurementCode steps", () => {
    const result = parseHealthConnectImport({
      ...baseRequest,
      steps: [
        { startTime: "2026-05-01T08:00:00.000Z", endTime: "2026-05-01T09:00:00.000Z", count: 1200 },
        { startTime: "2026-05-02T08:00:00.000Z", endTime: "2026-05-02T09:00:00.000Z", count: 950 }
      ]
    });
    expect(result.timeSeriesSamples).toHaveLength(2);
    expect(result.timeSeriesSamples[0].measurementCode).toBe("steps");
    expect(result.timeSeriesSamples[0].value).toBe(1200);
    expect(result.timeSeriesSamples[0].unit).toBe("count");
  });

  it("skips near-24-hour daily aggregate step records", () => {
    const result = parseHealthConnectImport({
      ...baseRequest,
      steps: [
        { startTime: "2026-05-01T00:00:00.000Z", endTime: "2026-05-01T23:59:59.999Z", count: 8450 },
        { startTime: "2026-05-01T08:00:00.000Z", endTime: "2026-05-01T08:05:00.000Z", count: 120 }
      ]
    });

    expect(result.timeSeriesSamples).toHaveLength(1);
    expect(result.timeSeriesSamples[0].value).toBe(120);
    expect(result.sourceImport.status).toBe("needs-review");
    expect(result.sourceImport.diagnostics).toContain("Skipped 1 daily aggregate Steps record(s).");
  });
});

describe("parseHealthConnectImport — heart rate → observations", () => {
  it("maps heart rate records to observations", () => {
    const result = parseHealthConnectImport({
      ...baseRequest,
      heartRate: [
        { time: "2026-05-01T08:00:00.000Z", value: 72 },
        { time: "2026-05-01T09:00:00.000Z", value: 75 }
      ]
    });
    expect(result.observations).toHaveLength(2);
    expect(result.observations[0].measurementCode).toBe("heart_rate");
    expect(result.observations[0].unit).toBe("bpm");
    expect(result.observations[0].value).toBe(72);
  });

  it("is idempotent: calling twice produces the same observation IDs", () => {
    const payload: HealthConnectImportRequest = {
      ...baseRequest,
      heartRate: [{ time: "2026-05-01T08:00:00.000Z", value: 72 }]
    };
    const r1 = parseHealthConnectImport(payload);
    const r2 = parseHealthConnectImport(payload);
    expect(r1.observations[0].id).toBe(r2.observations[0].id);
  });
});

describe("parseHealthConnectImport — additional supported categories", () => {
  it("maps body fat percentages to body_fat_pct observations", () => {
    const result = parseHealthConnectImport({
      ...baseRequest,
      bodyFatPct: [{ time: "2026-05-01T08:00:00.000Z", value: 21.5 }]
    });
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].measurementCode).toBe("body_fat_pct");
    expect(result.observations[0].unit).toBe("%");
    expect(result.observations[0].value).toBe(21.5);
  });
});

describe("parseHealthConnectImport — exercise sessions", () => {
  it("parses valid exercise sessions into activitySessions", () => {
    const result = parseHealthConnectImport({
      ...baseRequest,
      exerciseSessions: [
        {
          startTime: "2026-05-10T07:00:00.000Z",
          endTime: "2026-05-10T08:00:00.000Z",
          activityType: "Running",
          energyKcal: 450,
          distanceMeters: 6000
        }
      ]
    });
    expect(result.activitySessions).toHaveLength(1);
    expect(result.activitySessions[0].activityType).toBe("Running");
    expect(result.activitySessions[0].durationMinutes).toBe(60);
    expect(result.activitySessions[0].energyKcal).toBe(450);
  });

  it("skips sessions where end is before start and adds a diagnostic", () => {
    const result = parseHealthConnectImport({
      ...baseRequest,
      exerciseSessions: [
        {
          startTime: "2026-05-10T08:00:00.000Z",
          endTime: "2026-05-10T07:00:00.000Z",
          activityType: "Running"
        }
      ]
    });
    expect(result.activitySessions).toHaveLength(0);
    expect(result.sourceImport.diagnostics.length).toBeGreaterThan(0);
    expect(result.sourceImport.diagnostics[0]).toMatch(/end before start/i);
  });
});

describe("parseHealthConnectImport — rowCount", () => {
  it("counts all input records toward rowCount", () => {
    const result = parseHealthConnectImport({
      ...baseRequest,
      steps: [{ startTime: "2026-05-01T08:00:00.000Z", endTime: "2026-05-01T08:30:00.000Z", count: 500 }],
      heartRate: [{ time: "2026-05-01T08:00:00.000Z", value: 70 }],
      exerciseSessions: [{ startTime: "2026-05-01T07:00:00.000Z", endTime: "2026-05-01T08:00:00.000Z", activityType: "Cycling" }]
    });
    expect(result.sourceImport.rowCount).toBe(3);
  });
});

describe("parseHealthConnectImport — provenance and batches", () => {
  it("preserves Health Connect provenance and keeps upload batches distinct", () => {
    const payload: HealthConnectImportRequest = {
      ...baseRequest,
      batchId: "2026-06-01T12:00:00.000Z:1/2",
      steps: [{
        startTime: "2026-05-01T08:00:00.000Z",
        endTime: "2026-05-01T08:30:00.000Z",
        count: 500,
        provenance: { recordId: "hc-record-1", dataOrigin: "com.example.wearable" }
      }],
      exerciseSessions: [{
        startTime: "2026-05-01T07:00:00.000Z",
        endTime: "2026-05-01T08:00:00.000Z",
        activityType: "Running",
        title: "Morning run",
        details: { exerciseType: 56, route: { hasRoute: true } },
        provenance: { recordId: "hc-session-1", dataOrigin: "com.example.wearable" }
      }]
    };
    const result = parseHealthConnectImport(payload);

    expect(result.timeSeriesSamples[0].sourceJson).toEqual(payload.steps[0].provenance);
    expect(result.activitySessions[0].sourceJson).toMatchObject({
      title: "Morning run",
      provenance: payload.exerciseSessions[0].provenance,
      exerciseType: 56
    });
    expect(result.sourceImport.id).not.toBe(parseHealthConnectImport({ ...payload, batchId: "2026-06-01T12:00:00.000Z:2/2" }).sourceImport.id);
  });
});
