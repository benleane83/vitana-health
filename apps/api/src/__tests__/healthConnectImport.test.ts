import { describe, it, expect } from "vitest";
import { checksum } from "@vitana/shared";
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
          measurementAggregates: [],
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
    expect(result.measurementAggregates).toHaveLength(0);
    expect(result.activitySessions).toHaveLength(0);
    expect(result.sourceImport.rawContent).toBeUndefined();
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

  it("uses one date-only identity for readings from the same calendar day", () => {
    const result = parseHealthConnectImport({
      ...baseRequest,
      steps: [
        { startTime: "2026-05-01T08:00:00.000Z", endTime: "2026-05-01T09:00:00.000Z", count: 1200 },
        { startTime: "2026-05-01T18:00:00.000Z", endTime: "2026-05-01T19:00:00.000Z", count: 8450 }
      ]
    });
    expect(result.timeSeriesSamples).toHaveLength(1);
    expect(result.timeSeriesSamples[0]).toMatchObject({
      startAt: "2026-05-01T00:00:00.000Z",
      endAt: "2026-05-01T00:00:00.000Z",
      value: 8450
    });
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

  it("accepts daily totals explicitly resolved by Health Connect", () => {
    const result = parseHealthConnectImport({
      ...baseRequest,
      steps: [{
        startTime: "2026-05-01T00:00:00.000Z",
        endTime: "2026-05-02T00:00:00.000Z",
        count: 8450,
        provenance: {
          aggregation: "health-connect-daily",
          dataOrigins: ["com.google.android.apps.fitness"]
        }
      }]
    });

    expect(result.timeSeriesSamples).toHaveLength(1);
    expect(result.timeSeriesSamples[0]).toMatchObject({
      measurementCode: "steps",
      value: 8450,
      sourceJson: { aggregation: "health-connect-daily" }
    });
    expect(result.sourceImport.diagnostics).not.toContain("Skipped 1 daily aggregate Steps record(s).");
  });
});

describe("parseHealthConnectImport — heart rate aggregates", () => {
  it("maps heart rate buckets without reducing them to observations", () => {
    const result = parseHealthConnectImport({
      ...baseRequest,
      heartRate: [
        {
          startTime: "2026-05-01T08:00:00.000Z",
          endTime: "2026-05-01T08:15:00.000Z",
          granularity: "15m",
          average: 72,
          minimum: 64,
          maximum: 91,
          count: 18
        }
      ]
    });
    expect(result.observations).toHaveLength(0);
    expect(result.measurementAggregates).toEqual([expect.objectContaining({
      measurementCode: "heart_rate",
      granularity: "15m",
      average: 72,
      minimum: 64,
      maximum: 91,
      count: 18,
      unit: "beats/min"
    })]);
  });

  it("uses stable bucket identity even when a retry changes aggregate values", () => {
    const payload: HealthConnectImportRequest = {
      ...baseRequest,
      heartRate: [{
        startTime: "2026-05-01T08:00:00.000Z",
        endTime: "2026-05-01T08:15:00.000Z",
        granularity: "15m",
        average: 72,
        minimum: 64,
        maximum: 91,
        count: 18
      }]
    };
    const r1 = parseHealthConnectImport(payload);
    const r2 = parseHealthConnectImport({
      ...payload,
      heartRate: [{ ...payload.heartRate[0], average: 73, count: 19 }]
    });
    expect(r1.measurementAggregates[0].id).toBe(r2.measurementAggregates[0].id);
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
      heartRate: [{
        startTime: "2026-05-01T08:00:00.000Z",
        endTime: "2026-05-01T08:15:00.000Z",
        granularity: "15m",
        average: 70,
        minimum: 65,
        maximum: 80,
        count: 12
      }],
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
