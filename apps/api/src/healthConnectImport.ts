import { createHash } from "node:crypto";
import { checksum, type ActivitySession, type Observation, type ParsedImport, type TimeSeriesSample } from "@local-fitness-advisor/shared";
import { z } from "zod";

const isoDateString = z.string().datetime({ offset: true });

const stepSchema = z.object({
  startTime: isoDateString,
  endTime: isoDateString,
  count: z.number().int().nonnegative()
});

const pointSampleSchema = z.object({
  time: isoDateString,
  value: z.number().finite()
});

const exerciseSchema = z.object({
  startTime: isoDateString,
  endTime: isoDateString,
  activityType: z.string().min(1).max(120),
  energyKcal: z.number().finite().nonnegative().optional(),
  distanceMeters: z.number().finite().nonnegative().optional()
});

export const healthConnectImportRequestSchema = z.object({
  syncedAt: isoDateString,
  rangeStart: isoDateString,
  rangeEnd: isoDateString,
  deviceLabel: z.string().min(1).max(120).optional(),
  steps: z.array(stepSchema).max(20_000).default([]),
  heartRate: z.array(pointSampleSchema).max(20_000).default([]),
  oxygenSaturation: z.array(pointSampleSchema).max(20_000).default([]),
  hrvRmssd: z.array(pointSampleSchema).max(20_000).default([]),
  weightKg: z.array(pointSampleSchema).max(20_000).default([]),
  exerciseSessions: z.array(exerciseSchema).max(5_000).default([])
});

export type HealthConnectImportRequest = z.infer<typeof healthConnectImportRequestSchema>;

export function parseHealthConnectImport(payload: HealthConnectImportRequest): ParsedImport {
  const importedAt = normalizeIso(payload.syncedAt) ?? new Date().toISOString();
  const rangeStart = normalizeIso(payload.rangeStart) ?? importedAt;
  const rangeEnd = normalizeIso(payload.rangeEnd) ?? importedAt;
  const normalizedDeviceLabel = (payload.deviceLabel ?? "android-device").trim();
  const importId = stableId("import", ["health-connect", normalizedDeviceLabel, rangeStart, rangeEnd]);
  const sourceId = stableId("source", ["health-connect", normalizedDeviceLabel]);
  const diagnostics: string[] = [];

  const steps = payload.steps
    .map((item) => ({
      startAt: normalizeIso(item.startTime),
      endAt: normalizeIso(item.endTime),
      value: item.count
    }))
    .filter((item) => item.startAt && item.endAt && item.value >= 0)
    .map((item) => ({
      id: stableId("sample", ["steps", item.startAt ?? "", item.endAt ?? "", String(item.value), sourceId]),
      measurementCode: "steps",
      startAt: item.startAt ?? importedAt,
      endAt: item.endAt ?? importedAt,
      value: item.value,
      unit: "count",
      sourceId
    }));

  const heartRate = toObservationSamples(payload.heartRate, "heart_rate", "bpm", sourceId);
  const oxygenSaturation = toObservationSamples(payload.oxygenSaturation, "oxygen_saturation", "%", sourceId);
  const hrvRmssd = toObservationSamples(payload.hrvRmssd, "hrv_rmssd", "ms", sourceId);
  const weight = toObservationSamples(payload.weightKg, "weight", "kg", sourceId);
  const activitySessions = toActivitySessions(payload.exerciseSessions, sourceId);

  for (const session of payload.exerciseSessions) {
    const startAt = normalizeIso(session.startTime);
    const endAt = normalizeIso(session.endTime);
    if (!startAt || !endAt) {
      diagnostics.push("Skipped exercise session with invalid start/end time.");
      continue;
    }
    if (endAt < startAt) {
      diagnostics.push("Skipped exercise session with end before start.");
    }
  }

  const observations: Observation[] = [...heartRate, ...oxygenSaturation, ...hrvRmssd, ...weight];
  const timeSeriesSamples: TimeSeriesSample[] = steps;
  const fingerprint = checksum(
    JSON.stringify({
      rangeStart,
      rangeEnd,
      sourceId,
      observations: observations.map((item) => [item.measurementCode, item.observedAt, item.value, item.unit]),
      timeSeriesSamples: timeSeriesSamples.map((item) => [item.measurementCode, item.startAt, item.endAt, item.value, item.unit]),
      activitySessions: activitySessions.map((item) => [
        item.activityType,
        item.startAt,
        item.endAt ?? "",
        item.durationMinutes ?? "",
        item.energyKcal ?? "",
        item.distanceMeters ?? ""
      ])
    })
  );

  const rowCount =
    payload.steps.length +
    payload.heartRate.length +
    payload.oxygenSaturation.length +
    payload.hrvRmssd.length +
    payload.weightKg.length +
    payload.exerciseSessions.length;

  return {
    sourceImport: {
      id: importId,
      sourceKind: "health-connect",
      fileName: `health-connect:${normalizedDeviceLabel}:${rangeStart}:${rangeEnd}`,
      importedAt,
      parserVersion: "health-connect-v1",
      checksum: fingerprint,
      rowCount,
      status: diagnostics.length > 0 ? "needs-review" : "processed",
      diagnostics: diagnostics.slice(0, 25),
      rawContent: JSON.stringify(payload)
    },
    dataSource: {
      id: sourceId,
      sourceKind: "health-connect",
      label: `Health Connect: ${normalizedDeviceLabel}`,
      importId,
      createdAt: importedAt
    },
    observations,
    timeSeriesSamples,
    activitySessions,
    labPanels: [],
    labMarkers: []
  };
}

function normalizeIso(value: string): string | undefined {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString();
}

function toObservationSamples(
  rows: Array<{ time: string; value: number }>,
  measurementCode: string,
  unit: string,
  sourceId: string
): Observation[] {
  const observations: Observation[] = [];
  for (const row of rows) {
    const observedAt = normalizeIso(row.time);
    if (!observedAt || !Number.isFinite(row.value)) {
      continue;
    }
    observations.push({
      id: stableId("obs", [measurementCode, observedAt, String(row.value), sourceId]),
      measurementCode,
      observedAt,
      effectiveStart: observedAt,
      effectiveEnd: observedAt,
      value: row.value,
      unit,
      sourceId
    });
  }
  return observations;
}

function toActivitySessions(rows: HealthConnectImportRequest["exerciseSessions"], sourceId: string): ActivitySession[] {
  const sessions: ActivitySession[] = [];
  for (const row of rows) {
    const startAt = normalizeIso(row.startTime);
    const endAt = normalizeIso(row.endTime);
    if (!startAt || !endAt || endAt < startAt) {
      continue;
    }
    const startTimeMs = new Date(startAt).getTime();
    const endTimeMs = new Date(endAt).getTime();
    const durationMinutes = Math.max(0, Math.round((endTimeMs - startTimeMs) / 60_000));
    sessions.push({
      id: stableId("activity", [row.activityType, startAt, endAt, sourceId]),
      activityType: row.activityType,
      startAt,
      endAt,
      durationMinutes,
      energyKcal: row.energyKcal,
      distanceMeters: row.distanceMeters,
      sourceId
    });
  }
  return sessions;
}

function stableId(prefix: string, parts: string[]): string {
  const digest = createHash("sha256").update(parts.join("|"), "utf8").digest("hex").slice(0, 18);
  return `${prefix}_${digest}`;
}
