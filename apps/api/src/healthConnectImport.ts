import { createHash } from "node:crypto";
import { checksum, type ActivitySession, type Observation, type ParsedImport, type TimeSeriesSample } from "@local-fitness-advisor/shared";
import { z } from "zod";

const isoDateString = z.string().datetime({ offset: true });

const stepSchema = z.object({
  startTime: isoDateString,
  endTime: isoDateString,
  count: z.number().int().nonnegative()
});

const intervalSampleSchema = z.object({
  startTime: isoDateString,
  endTime: isoDateString,
  value: z.number().finite().nonnegative(),
  provenance: z.record(z.unknown()).optional()
});

const sleepSessionSchema = z.object({
  startTime: isoDateString,
  endTime: isoDateString,
  durationMinutes: z.number().finite().nonnegative(),
  stages: z.array(z.unknown()).optional(),
  title: z.string().max(500).optional(),
  notes: z.string().max(4000).optional(),
  provenance: z.record(z.unknown()).optional()
});

const pointSampleSchema = z.object({
  time: isoDateString,
  value: z.number().finite(),
  provenance: z.record(z.unknown()).optional()
});

const exerciseSchema = z.object({
  startTime: isoDateString,
  endTime: isoDateString,
  activityType: z.string().min(1).max(120),
  energyKcal: z.number().finite().nonnegative().optional(),
  distanceMeters: z.number().finite().nonnegative().optional(),
  title: z.string().max(500).optional(),
  notes: z.string().max(4000).optional(),
  details: z.record(z.unknown()).optional(),
  provenance: z.record(z.unknown()).optional()
});

export const healthConnectImportRequestSchema = z.object({
  profileId: z.string().trim().toLowerCase().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]{0,63}$/).optional(),
  syncedAt: isoDateString,
  rangeStart: isoDateString,
  rangeEnd: isoDateString,
  deviceLabel: z.string().min(1).max(120).optional(),
  batchId: z.string().min(1).max(160).optional(),
  steps: z.array(stepSchema.extend({ provenance: z.record(z.unknown()).optional() })).default([]),
  heartRate: z.array(pointSampleSchema).default([]),
  oxygenSaturation: z.array(pointSampleSchema).default([]),
  respiratoryRate: z.array(pointSampleSchema).default([]),
  hrvRmssd: z.array(pointSampleSchema).default([]),
  hrvSdnn: z.array(pointSampleSchema).default([]),
  basalBodyTemperatureC: z.array(pointSampleSchema).default([]),
  basalMetabolicRateKcalDay: z.array(pointSampleSchema).default([]),
  bloodGlucoseMgDl: z.array(pointSampleSchema).default([]),
  bloodPressureSystolicMmHg: z.array(pointSampleSchema).default([]),
  bloodPressureDiastolicMmHg: z.array(pointSampleSchema).default([]),
  bodyTemperatureC: z.array(pointSampleSchema).default([]),
  heightCm: z.array(pointSampleSchema).default([]),
  skinTemperatureC: z.array(pointSampleSchema).default([]),
  vo2MaxMlKgMin: z.array(pointSampleSchema).default([]),
  weightKg: z.array(pointSampleSchema).default([]),
  exerciseSessions: z.array(exerciseSchema).default([]),
  distanceMeters: z.array(intervalSampleSchema).default([]),
  floorsClimbed: z.array(intervalSampleSchema).default([]),
  activeCaloriesKcal: z.array(intervalSampleSchema).default([]),
  totalCaloriesKcal: z.array(intervalSampleSchema).default([]),
  sleepSessions: z.array(sleepSessionSchema).default([]),
  bodyFatPct: z.array(pointSampleSchema).default([]),
  leanBodyMassKg: z.array(pointSampleSchema).default([]),
  bodyWaterMassKg: z.array(pointSampleSchema).default([]),
  boneMassKg: z.array(pointSampleSchema).default([])
});

export type HealthConnectImportRequest = z.infer<typeof healthConnectImportRequestSchema>;

export function parseHealthConnectImport(payload: HealthConnectImportRequest): ParsedImport {
  const importedAt = normalizeIso(payload.syncedAt) ?? new Date().toISOString();
  const rangeStart = normalizeIso(payload.rangeStart) ?? importedAt;
  const rangeEnd = normalizeIso(payload.rangeEnd) ?? importedAt;
  const normalizedDeviceLabel = (payload.deviceLabel ?? "android-device").trim();
  const importId = stableId("import", ["health-connect", normalizedDeviceLabel, rangeStart, rangeEnd, payload.batchId ?? "single"]);
  const sourceId = stableId("source", ["health-connect", normalizedDeviceLabel]);
  const diagnostics: string[] = [];

  const steps = payload.steps
    .map((item) => ({
      startAt: normalizeIso(item.startTime),
      endAt: normalizeIso(item.endTime),
      value: item.count,
      provenance: item.provenance
    }))
    .filter((item) => item.startAt && item.endAt && item.value >= 0)
    .map((item) => ({
      id: stableId("sample", ["steps", item.startAt ?? "", item.endAt ?? "", String(item.value), sourceId, JSON.stringify(item.provenance ?? {})]),
      measurementCode: "steps",
      startAt: item.startAt ?? importedAt,
      endAt: item.endAt ?? importedAt,
      value: item.value,
      unit: "count",
      sourceId,
      sourceJson: item.provenance
    }));

  const heartRate = toObservationSamples(payload.heartRate, "heart_rate", "bpm", sourceId);
  const oxygenSaturation = toObservationSamples(payload.oxygenSaturation, "oxygen_saturation", "%", sourceId);
  const respiratoryRate = toObservationSamples(payload.respiratoryRate, "respiratory_rate", "breaths/min", sourceId);
  const hrvRmssd = toObservationSamples(payload.hrvRmssd, "hrv_rmssd", "ms", sourceId);
  const hrvSdnn = toObservationSamples(payload.hrvSdnn, "hrv_sdnn", "ms", sourceId);
  const basalBodyTemperature = toObservationSamples(payload.basalBodyTemperatureC, "basal_body_temperature", "degC", sourceId);
  const basalMetabolicRate = toObservationSamples(payload.basalMetabolicRateKcalDay, "basal_metabolic_rate", "kcal/day", sourceId);
  const bloodGlucose = toObservationSamples(payload.bloodGlucoseMgDl, "glucose", "mg/dL", sourceId);
  const bloodPressureSystolic = toObservationSamples(payload.bloodPressureSystolicMmHg, "blood_pressure_systolic", "mmHg", sourceId);
  const bloodPressureDiastolic = toObservationSamples(payload.bloodPressureDiastolicMmHg, "blood_pressure_diastolic", "mmHg", sourceId);
  const bodyTemperature = toObservationSamples(payload.bodyTemperatureC, "body_temperature", "degC", sourceId);
  const height = toObservationSamples(payload.heightCm, "height", "cm", sourceId);
  const skinTemperature = toObservationSamples(payload.skinTemperatureC, "skin_temperature", "degC", sourceId);
  const vo2Max = toObservationSamples(payload.vo2MaxMlKgMin, "vo2_max", "mL/kg/min", sourceId);
  const weight = toObservationSamples(payload.weightKg, "weight", "kg", sourceId);
  const bodyFatPct = toObservationSamples(payload.bodyFatPct, "body_fat_pct", "%", sourceId);
  const leanBodyMass = toObservationSamples(payload.leanBodyMassKg, "lean_body_mass", "kg", sourceId);
  const bodyWaterMass = toObservationSamples(payload.bodyWaterMassKg, "total_body_water", "L", sourceId);
  const boneMass = toObservationSamples(payload.boneMassKg, "bone_mineral_content", "kg", sourceId);
  const activitySessions = toActivitySessions(payload.exerciseSessions, sourceId);
  const distanceMeters = toTimeSeriesSamples(payload.distanceMeters, "distance", "m", sourceId);
  const floorsClimbed = toTimeSeriesSamples(payload.floorsClimbed, "floors_climbed", "count", sourceId);
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
    ...heartRate,
    ...oxygenSaturation,
    ...respiratoryRate,
    ...hrvRmssd,
    ...hrvSdnn,
    ...basalBodyTemperature,
    ...basalMetabolicRate,
    ...bloodGlucose,
    ...bloodPressureSystolic,
    ...bloodPressureDiastolic,
    ...bodyTemperature,
    ...height,
    ...skinTemperature,
    ...vo2Max,
    ...weight,
    ...bodyFatPct,
    ...leanBodyMass,
    ...bodyWaterMass,
    ...boneMass
  ];
  const timeSeriesSamples: TimeSeriesSample[] = [
    ...steps,
    ...distanceMeters,
    ...floorsClimbed,
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
    payload.oxygenSaturation.length +
    payload.respiratoryRate.length +
    payload.hrvRmssd.length +
    payload.hrvSdnn.length +
    payload.basalBodyTemperatureC.length +
    payload.basalMetabolicRateKcalDay.length +
    payload.bloodGlucoseMgDl.length +
    payload.bloodPressureSystolicMmHg.length +
    payload.bloodPressureDiastolicMmHg.length +
    payload.bodyTemperatureC.length +
    payload.heightCm.length +
    payload.skinTemperatureC.length +
    payload.vo2MaxMlKgMin.length +
    payload.weightKg.length +
    payload.exerciseSessions.length +
    payload.distanceMeters.length +
    payload.floorsClimbed.length +
    payload.activeCaloriesKcal.length +
    payload.totalCaloriesKcal.length +
    payload.sleepSessions.length +
    payload.bodyFatPct.length +
    payload.leanBodyMassKg.length +
    payload.bodyWaterMassKg.length +
    payload.boneMassKg.length;

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
    observationGroups: [],
    timeSeriesSamples,
    activitySessions
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
