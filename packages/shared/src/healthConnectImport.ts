import { z } from "zod";

/**
 * Wire shape of a Health Connect sync batch. It lives in the shared package rather than the API so
 * the phone's client is typed against the exact same definition the server validates with.
 */

const isoDateString = z.string().datetime({ offset: true });

const provenance = z.record(z.unknown()).optional();

const stepSchema = z.object({
  startTime: isoDateString,
  endTime: isoDateString,
  count: z.number().int().nonnegative(),
  provenance
});

const intervalSampleSchema = z.object({
  startTime: isoDateString,
  endTime: isoDateString,
  value: z.number().finite().nonnegative(),
  provenance
});

export const healthConnectSleepStageSchema = z.object({
  startTime: isoDateString,
  endTime: isoDateString,
  stage: z.number().int().nonnegative()
}).passthrough();

export type HealthConnectSleepStage = z.infer<typeof healthConnectSleepStageSchema>;

const sleepSessionSchema = z.object({
  startTime: isoDateString,
  endTime: isoDateString,
  durationMinutes: z.number().finite().nonnegative(),
  stages: z.array(healthConnectSleepStageSchema).optional(),
  title: z.string().max(500).optional(),
  notes: z.string().max(4000).optional(),
  provenance
});

const pointSampleSchema = z.object({
  time: isoDateString,
  value: z.number().finite(),
  provenance
});

const measurementAggregateSchema = z.object({
  startTime: isoDateString,
  endTime: isoDateString,
  granularity: z.enum(["15m", "day"]),
  average: z.number().finite().nonnegative(),
  minimum: z.number().finite().nonnegative(),
  maximum: z.number().finite().nonnegative(),
  count: z.number().int().positive(),
  calendarDate: z.string().date().optional(),
  provenance
}).superRefine((value, context) => {
  if (value.endTime <= value.startTime) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["endTime"], message: "endTime must be after startTime" });
  }
  if (value.minimum > value.average || value.average > value.maximum) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["average"], message: "average must be between minimum and maximum" });
  }
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
  provenance
});

export const healthConnectImportRequestSchema = z.object({
  profileId: z.string().trim().toLowerCase().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]{0,63}$/).optional(),
  syncedAt: isoDateString,
  rangeStart: isoDateString,
  rangeEnd: isoDateString,
  deviceLabel: z.string().min(1).max(120).optional(),
  batchId: z.string().min(1).max(160).optional(),
  steps: z.array(stepSchema).default([]),
  heartRate: z.array(measurementAggregateSchema).default([]),
  restingHeartRate: z.array(measurementAggregateSchema).default([]),
  oxygenSaturation: z.array(pointSampleSchema).default([]),
  hrvRmssd: z.array(measurementAggregateSchema).default([]),
  respiratoryRate: z.array(measurementAggregateSchema).default([]),
  basalMetabolicRateKcalDay: z.array(pointSampleSchema).default([]),
  heightCm: z.array(pointSampleSchema).default([]),
  skinTemperatureC: z.array(pointSampleSchema).default([]),
  vo2MaxMlKgMin: z.array(pointSampleSchema).default([]),
  weightKg: z.array(pointSampleSchema).default([]),
  exerciseSessions: z.array(exerciseSchema).default([]),
  distanceMeters: z.array(intervalSampleSchema).default([]),
  activeCaloriesKcal: z.array(intervalSampleSchema).default([]),
  totalCaloriesKcal: z.array(intervalSampleSchema).default([]),
  sleepSessions: z.array(sleepSessionSchema).default([]),
  bodyFatPct: z.array(pointSampleSchema).default([])
});

/** Fully-populated form, as the server sees it after defaults are applied. */
export type HealthConnectImportRequest = z.infer<typeof healthConnectImportRequestSchema>;
/** What a caller may send: every sample array is optional. */
export type HealthConnectImportPayload = z.input<typeof healthConnectImportRequestSchema>;
