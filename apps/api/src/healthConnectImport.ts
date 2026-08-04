import { createHash } from "node:crypto";
import {
  calendarDateToUtcMidnight,
  checksum,
  healthConnectImportRequestSchema,
  type ActivitySession,
  type HealthConnectImportRequest,
  type MeasurementAggregate,
  type Observation,
  type ParsedImport,
  type TimeSeriesSample
} from "@vitana/shared";

const DAILY_AGGREGATE_MIN_DURATION_MS = 23 * 60 * 60 * 1000;

export { healthConnectImportRequestSchema };
export type { HealthConnectImportRequest };

export function parseHealthConnectImport(payload: HealthConnectImportRequest): ParsedImport {
  const importedAt = normalizeIso(payload.syncedAt) ?? new Date().toISOString();
  const rangeStart = normalizeIso(payload.rangeStart) ?? importedAt;
  const rangeEnd = normalizeIso(payload.rangeEnd) ?? importedAt;
  const normalizedDeviceLabel = (payload.deviceLabel ?? "android-device").trim();
  const importId = stableId("import", ["health-connect", normalizedDeviceLabel, rangeStart, rangeEnd, payload.batchId ?? "single"]);
  const sourceId = stableId("source", ["health-connect", normalizedDeviceLabel]);
  const diagnostics: string[] = [];

  const normalizedSteps = payload.steps
    .map((item) => ({
      startAt: normalizeIso(item.startTime),
      endAt: normalizeIso(item.endTime),
      value: item.count,
      provenance: item.provenance
    }))
    .filter((item) => item.startAt && item.endAt && item.value >= 0);
  const dailyAggregateStepCount = normalizedSteps.filter((item) =>
    isDailyAggregateInterval(item.startAt!, item.endAt!) && !isHealthConnectDailyAggregate(item.provenance)
  ).length;
  if (dailyAggregateStepCount > 0) {
    diagnostics.push(`Skipped ${dailyAggregateStepCount} daily aggregate Steps record(s).`);
  }
  const normalizedStepSamples = normalizedSteps
    .filter((item) => !isDailyAggregateInterval(item.startAt!, item.endAt!) || isHealthConnectDailyAggregate(item.provenance))
    .map((item) => {
      const calendarDate = stepCalendarDate(item.endAt!, item.provenance);
      const dayTimestamp = calendarDateToUtcMidnight(calendarDate);
      if (!dayTimestamp) return undefined;
      return {
        id: stableId("sample", ["steps", calendarDate, sourceId]),
        measurementCode: "steps",
        startAt: dayTimestamp,
        endAt: dayTimestamp,
        value: item.value,
        unit: "count",
        sourceId,
        sourceJson: item.provenance
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== undefined);
  const steps = [...new Map(normalizedStepSamples.map((item) => [item.id, item])).values()];

  const heartRate = toMeasurementAggregates(payload.heartRate, "heart_rate", "beats/min", sourceId);
  const restingHeartRate = toMeasurementAggregates(payload.restingHeartRate, "resting_heart_rate", "beats/min", sourceId);
  const oxygenSaturation = toObservationSamples(payload.oxygenSaturation, "oxygen_saturation", "%", sourceId);
  const hrvRmssd = toMeasurementAggregates(payload.hrvRmssd, "hrv_rmssd", "ms", sourceId);
  const respiratoryRate = toMeasurementAggregates(payload.respiratoryRate, "respiratory_rate", "breaths/min", sourceId);
  const basalMetabolicRate = toObservationSamples(payload.basalMetabolicRateKcalDay, "basal_metabolic_rate", "kcal/day", sourceId);
  const height = toObservationSamples(payload.heightCm, "height", "cm", sourceId);
  const skinTemperature = toObservationSamples(payload.skinTemperatureC, "skin_temperature", "degC", sourceId);
  const vo2Max = toObservationSamples(payload.vo2MaxMlKgMin, "vo2_max", "mL/kg/min", sourceId);
  const weight = toObservationSamples(payload.weightKg, "weight", "kg", sourceId);
  const bodyFatPct = toObservationSamples(payload.bodyFatPct, "body_fat_pct", "%", sourceId);
  const activitySessions = toActivitySessions(payload.exerciseSessions, sourceId);
  const distanceMeters = toTimeSeriesSamples(payload.distanceMeters, "distance", "m", sourceId);
  const activeCalories = toTimeSeriesSamples(payload.activeCaloriesKcal, "active_energy_burned", "kcal", sourceId);
  const totalCalories = toTimeSeriesSamples(payload.totalCaloriesKcal, "total_calories_burned", "kcal", sourceId);
  const physicalActivityDuration = toPhysicalActivityDurationSamples(payload.exerciseSessions, sourceId);
  const sleepDuration = toSleepDurationSamples(payload.sleepSessions, sourceId);

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

  const observations: Observation[] = [
    ...oxygenSaturation,
    ...basalMetabolicRate,
    ...height,
    ...skinTemperature,
    ...vo2Max,
    ...weight,
    ...bodyFatPct
  ];
  const timeSeriesSamples: TimeSeriesSample[] = [
    ...steps,
    ...distanceMeters,
    ...activeCalories,
    ...totalCalories,
    ...physicalActivityDuration,
    ...sleepDuration
  ];
  const fingerprint = checksum(
    JSON.stringify({
      rangeStart,
      rangeEnd,
      sourceId,
      observations: observations.map((item) => [item.measurementCode, item.observedAt, item.value, item.unit, item.sourceJson]),
      measurementAggregates: [...heartRate, ...restingHeartRate, ...hrvRmssd, ...respiratoryRate].map((item) => [
        item.measurementCode,
        item.granularity,
        item.startAt,
        item.endAt,
        item.average,
        item.minimum,
        item.maximum,
        item.count,
        item.unit
      ]),
      timeSeriesSamples: timeSeriesSamples.map((item) => [item.measurementCode, item.startAt, item.endAt, item.value, item.unit, item.sourceJson]),
      activitySessions: activitySessions.map((item) => [
        item.activityType,
        item.startAt,
        item.endAt ?? "",
        item.durationMinutes ?? "",
        item.energyKcal ?? "",
        item.distanceMeters ?? ""
      , item.sourceJson])
    })
  );

  const rowCount =
    payload.steps.length +
    payload.heartRate.length +
    payload.restingHeartRate.length +
    payload.oxygenSaturation.length +
    payload.hrvRmssd.length +
    payload.respiratoryRate.length +
    payload.basalMetabolicRateKcalDay.length +
    payload.heightCm.length +
    payload.skinTemperatureC.length +
    payload.vo2MaxMlKgMin.length +
    payload.weightKg.length +
    payload.exerciseSessions.length +
    payload.distanceMeters.length +
    payload.activeCaloriesKcal.length +
    payload.totalCaloriesKcal.length +
    payload.sleepSessions.length +
    payload.bodyFatPct.length;

  return {
    sourceImport: {
      id: importId,
      sourceKind: "health-connect",
      fileName: `health-connect:${normalizedDeviceLabel}:${rangeStart}:${rangeEnd}`,
      importedAt,
      parserVersion: "health-connect-v2",
      checksum: fingerprint,
      rowCount,
      status: diagnostics.length > 0 ? "needs-review" : "processed",
      diagnostics: diagnostics.slice(0, 25)
    },
    dataSource: {
      id: sourceId,
      sourceKind: "health-connect",
      label: `Health Connect: ${normalizedDeviceLabel}`,
      importId,
      createdAt: importedAt
    },
    observations,
    observationGroups: [],
    timeSeriesSamples,
    measurementAggregates: [...heartRate, ...restingHeartRate, ...hrvRmssd, ...respiratoryRate],
    activitySessions
  };
}

function toMeasurementAggregates(
  rows: HealthConnectImportRequest["heartRate"],
  measurementCode: string,
  unit: string,
  sourceId: string
): MeasurementAggregate[] {
  const aggregates: MeasurementAggregate[] = [];
  for (const row of rows) {
    const startAt = normalizeIso(row.startTime);
    const endAt = normalizeIso(row.endTime);
    if (!startAt || !endAt || endAt <= startAt) {
      continue;
    }
    aggregates.push({
      id: stableId("aggregate", [measurementCode, row.granularity, startAt, endAt, sourceId]),
      measurementCode,
      granularity: row.granularity,
      startAt,
      endAt,
      average: row.average,
      minimum: row.minimum,
      maximum: row.maximum,
      count: row.count,
      unit,
      sourceId,
      calendarDate: row.calendarDate,
      sourceJson: row.provenance
    });
  }
  return aggregates;
}

function normalizeIso(value: string): string | undefined {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString();
}

function isDailyAggregateInterval(startAt: string, endAt: string): boolean {
  return new Date(endAt).getTime() - new Date(startAt).getTime() >= DAILY_AGGREGATE_MIN_DURATION_MS;
}

function isHealthConnectDailyAggregate(provenance: Record<string, unknown> | undefined): boolean {
  return provenance?.aggregation === "health-connect-daily";
}

function stepCalendarDate(endAt: string, provenance: Record<string, unknown> | undefined): string {
  const calendarDate = provenance?.calendarDate;
  if (typeof calendarDate === "string" && calendarDateToUtcMidnight(calendarDate)) {
    return calendarDate;
  }
  return endAt.slice(0, 10);
}

function toObservationSamples(
  rows: Array<{ time: string; value: number; provenance?: Record<string, unknown> }>,
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
      id: stableId("obs", [measurementCode, observedAt, String(row.value), sourceId, JSON.stringify(row.provenance ?? {})]),
      measurementCode,
      observedAt,
      effectiveStart: observedAt,
      effectiveEnd: observedAt,
      value: row.value,
      unit,
      sourceId,
      sourceJson: row.provenance
    });
  }
  return observations;
}

function toTimeSeriesSamples(
  rows: Array<{ startTime: string; endTime: string; value: number; provenance?: Record<string, unknown> }>,
  measurementCode: string,
  unit: string,
  sourceId: string
): TimeSeriesSample[] {
  const samples: TimeSeriesSample[] = [];
  for (const row of rows) {
    const startAt = normalizeIso(row.startTime);
    const endAt = normalizeIso(row.endTime);
    if (!startAt || !endAt || endAt < startAt || !Number.isFinite(row.value)) {
      continue;
    }
    samples.push({
      id: stableId("sample", [measurementCode, startAt, endAt, String(row.value), sourceId, JSON.stringify(row.provenance ?? {})]),
      measurementCode,
      startAt,
      endAt,
      value: row.value,
      unit,
      sourceId,
      sourceJson: row.provenance
    });
  }
  return samples;
}

function toSleepDurationSamples(
  rows: HealthConnectImportRequest["sleepSessions"],
  sourceId: string
): TimeSeriesSample[] {
  const samples: TimeSeriesSample[] = [];
  for (const row of rows) {
    const startAt = normalizeIso(row.startTime);
    const endAt = normalizeIso(row.endTime);
    if (!startAt || !endAt || endAt < startAt || !Number.isFinite(row.durationMinutes)) {
      continue;
    }
    samples.push({
      id: stableId("sample", ["sleep_duration", startAt, endAt, String(row.durationMinutes), sourceId, JSON.stringify(row.provenance ?? {})]),
      measurementCode: "sleep_duration",
      startAt,
      endAt,
      value: row.durationMinutes,
      unit: "min",
      sourceId,
      sourceJson: {
        provenance: row.provenance,
        title: row.title,
        notes: row.notes,
        stages: row.stages
      }
    });
  }
  return samples;
}

function toPhysicalActivityDurationSamples(
  rows: HealthConnectImportRequest["exerciseSessions"],
  sourceId: string
): TimeSeriesSample[] {
  const samples: TimeSeriesSample[] = [];
  for (const row of rows) {
    const startAt = normalizeIso(row.startTime);
    const endAt = normalizeIso(row.endTime);
    if (!startAt || !endAt || endAt < startAt) {
      continue;
    }
    const durationMinutes = Math.max(0, Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60_000));
    samples.push({
      id: stableId("sample", ["physical_activity_duration", startAt, endAt, String(durationMinutes), sourceId, JSON.stringify(row.provenance ?? {})]),
      measurementCode: "physical_activity_duration",
      startAt,
      endAt,
      value: durationMinutes,
      unit: "min",
      sourceId,
      sourceJson: row.provenance
    });
  }
  return samples;
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
      id: stableId("activity", [row.activityType, startAt, endAt, sourceId, JSON.stringify(row.provenance ?? {})]),
      activityType: row.activityType,
      startAt,
      endAt,
      durationMinutes,
      energyKcal: row.energyKcal,
      distanceMeters: row.distanceMeters,
      sourceId,
      sourceJson: {
        provenance: row.provenance,
        title: row.title,
        notes: row.notes,
        ...row.details
      }
    });
  }
  return sessions;
}

function stableId(prefix: string, parts: string[]): string {
  const digest = createHash("sha256").update(parts.join("|"), "utf8").digest("hex").slice(0, 18);
  return `${prefix}_${digest}`;
}
