import {
  SdkAvailabilityStatus,
  getSdkStatus,
  initialize,
  readRecords,
  requestPermission,
  type Permission,
  type ReadRecordsOptions,
  type RecordType
} from "react-native-health-connect";
import { Platform } from "react-native";
import {
  DEFAULT_HEALTH_CONNECT_SYNC_WINDOW_DAYS,
  HEALTH_CONNECT_CATEGORIES,
  type HealthConnectCategory
} from "./endpointStore";
import { pinnedFetch } from "./pinnedFetch";

const OVERLAP_MS = 5 * 60 * 1000;
const MAX_UPLOAD_BYTES = 2_000_000;
const MAX_UPLOAD_ATTEMPTS = 3;

const PAYLOAD_COLLECTION_KEYS = [
  "steps",
  "heartRate",
  "oxygenSaturation",
  "respiratoryRate",
  "hrvRmssd",
  "hrvSdnn",
  "basalBodyTemperatureC",
  "basalMetabolicRateKcalDay",
  "bloodGlucoseMgDl",
  "bloodPressureSystolicMmHg",
  "bloodPressureDiastolicMmHg",
  "bodyTemperatureC",
  "heightCm",
  "skinTemperatureC",
  "vo2MaxMlKgMin",
  "weightKg",
  "exerciseSessions",
  "distanceMeters",
  "floorsClimbed",
  "activeCaloriesKcal",
  "totalCaloriesKcal",
  "sleepSessions",
  "bodyFatPct",
  "leanBodyMassKg",
  "bodyWaterMassKg",
  "boneMassKg"
] as const;

type PayloadCollectionKey = (typeof PAYLOAD_COLLECTION_KEYS)[number];

interface HealthConnectProvenance {
  recordId?: string;
  dataOrigin?: string;
  clientRecordId?: string;
  lastModifiedTime?: string;
  recordingMethod?: string;
  device?: Record<string, unknown>;
}

interface HealthConnectPointValue {
  time: string;
  value: number;
  provenance?: HealthConnectProvenance;
}

export interface HealthConnectImportPayload {
  profileId?: string;
  syncedAt: string;
  rangeStart: string;
  rangeEnd: string;
  deviceLabel: string;
  batchId?: string;
  steps: Array<{ startTime: string; endTime: string; count: number; provenance?: HealthConnectProvenance }>;
  heartRate: HealthConnectPointValue[];
  oxygenSaturation: HealthConnectPointValue[];
  respiratoryRate: HealthConnectPointValue[];
  hrvRmssd: HealthConnectPointValue[];
  hrvSdnn: HealthConnectPointValue[];
  basalBodyTemperatureC: HealthConnectPointValue[];
  basalMetabolicRateKcalDay: HealthConnectPointValue[];
  bloodGlucoseMgDl: HealthConnectPointValue[];
  bloodPressureSystolicMmHg: HealthConnectPointValue[];
  bloodPressureDiastolicMmHg: HealthConnectPointValue[];
  bodyTemperatureC: HealthConnectPointValue[];
  heightCm: HealthConnectPointValue[];
  skinTemperatureC: HealthConnectPointValue[];
  vo2MaxMlKgMin: HealthConnectPointValue[];
  weightKg: HealthConnectPointValue[];
  exerciseSessions: Array<{
    startTime: string;
    endTime: string;
    activityType: string;
    energyKcal?: number;
    distanceMeters?: number;
    title?: string;
    notes?: string;
    details?: Record<string, unknown>;
    provenance?: HealthConnectProvenance;
  }>;
  distanceMeters: Array<{ startTime: string; endTime: string; value: number; provenance?: HealthConnectProvenance }>;
  floorsClimbed: Array<{ startTime: string; endTime: string; value: number; provenance?: HealthConnectProvenance }>;
  activeCaloriesKcal: Array<{ startTime: string; endTime: string; value: number; provenance?: HealthConnectProvenance }>;
  totalCaloriesKcal: Array<{ startTime: string; endTime: string; value: number; provenance?: HealthConnectProvenance }>;
  sleepSessions: Array<{
    startTime: string;
    endTime: string;
    durationMinutes: number;
    stages?: unknown[];
    title?: string;
    notes?: string;
    provenance?: HealthConnectProvenance;
  }>;
  bodyFatPct: HealthConnectPointValue[];
  leanBodyMassKg: HealthConnectPointValue[];
  bodyWaterMassKg: HealthConnectPointValue[];
  boneMassKg: HealthConnectPointValue[];
}

export interface SyncOptions {
  deviceId: string;
  syncCursor?: string | null;
  syncWindowDays?: number;
  categories?: HealthConnectCategory[];
}

export interface SyncResult {
  status: string;
  details: string;
  syncCursor: string;
  canAdvanceCursor: boolean;
}

const permissionsByCategory: Partial<Record<HealthConnectCategory, Permission>> = {
  Steps: { accessType: "read", recordType: "Steps" },
  HeartRate: { accessType: "read", recordType: "HeartRate" },
  OxygenSaturation: { accessType: "read", recordType: "OxygenSaturation" },
  RespiratoryRate: { accessType: "read", recordType: "RespiratoryRate" as RecordType },
  HeartRateVariabilityRmssd: { accessType: "read", recordType: "HeartRateVariabilityRmssd" },
  BasalBodyTemperature: { accessType: "read", recordType: "BasalBodyTemperature" },
  BasalMetabolicRate: { accessType: "read", recordType: "BasalMetabolicRate" },
  BloodGlucose: { accessType: "read", recordType: "BloodGlucose" },
  BloodPressure: { accessType: "read", recordType: "BloodPressure" },
  BodyTemperature: { accessType: "read", recordType: "BodyTemperature" },
  Height: { accessType: "read", recordType: "Height" },
  Vo2Max: { accessType: "read", recordType: "Vo2Max" },
  Weight: { accessType: "read", recordType: "Weight" },
  ExerciseSession: { accessType: "read", recordType: "ExerciseSession" },
  Distance: { accessType: "read", recordType: "Distance" },
  FloorsClimbed: { accessType: "read", recordType: "FloorsClimbed" },
  ActiveCaloriesBurned: { accessType: "read", recordType: "ActiveCaloriesBurned" },
  TotalCaloriesBurned: { accessType: "read", recordType: "TotalCaloriesBurned" },
  SleepSession: { accessType: "read", recordType: "SleepSession" },
  BodyFat: { accessType: "read", recordType: "BodyFat" },
  LeanBodyMass: { accessType: "read", recordType: "LeanBodyMass" },
  BodyWaterMass: { accessType: "read", recordType: "BodyWaterMass" },
  BoneMass: { accessType: "read", recordType: "BoneMass" }
};

export async function syncHealthConnect(
  endpointUrl: string,
  companionToken: string | null | undefined,
  profileId: string | null | undefined,
  publicKeyHash: string | null | undefined,
  options: SyncOptions
): Promise<SyncResult> {
  if (Platform.OS !== "android") throw new Error("This app only supports Android Health Connect.");
  if (!__DEV__ && !endpointUrl.startsWith("https://")) throw new Error("Production sync requires an HTTPS endpoint.");
  if (!companionToken) throw new Error("A paired device token is required. Pair this device before syncing.");

  const sdkStatus = await getSdkStatus();
  if (sdkStatus !== SdkAvailabilityStatus.SDK_AVAILABLE) {
    throw new Error(
      sdkStatus === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED
        ? "Health Connect needs an update from the Play Store before syncing."
        : "Health Connect is unavailable on this device."
    );
  }
  try {
    if (!(await initialize())) throw new Error("returned false");
  } catch (error) {
    throw new Error(`Health Connect initialization error: ${error instanceof Error ? error.message : "Unknown error"}`);
  }

  const selectedCategories = HEALTH_CONNECT_CATEGORIES.filter((category) => options.categories?.includes(category) ?? true);
  if (selectedCategories.length === 0) throw new Error("Select at least one Health Connect data category to sync.");
  const unsupportedCategories = selectedCategories.filter((category) => !permissionsByCategory[category]);
  const requestedPermissions = selectedCategories
    .map((category) => permissionsByCategory[category])
    .filter((permission): permission is Permission => Boolean(permission));
  if (requestedPermissions.length === 0) {
    throw new Error("Selected categories are not supported by the installed Health Connect SDK version.");
  }
  const grantedPermissions = await requestPermission(requestedPermissions);
  const grantedCategories = selectedCategories.filter((category) => {
    const permission = permissionsByCategory[category];
    return permission
      ? grantedPermissions.some((granted) => granted.accessType === "read" && granted.recordType === permission.recordType)
      : false;
  });
  if (grantedCategories.length === 0) {
    throw new Error("No selected Health Connect permissions were granted. Choose at least one category in Health Connect to sync.");
  }
  const omittedCategories = [
    ...selectedCategories.filter((category) => !grantedCategories.includes(category)),
    ...unsupportedCategories
  ];

  const rangeEnd = new Date();
  const windowDays = normalizeSyncWindowDays(options.syncWindowDays);
  const initialStart = new Date(rangeEnd.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const cursor = parseCursor(options.syncCursor);
  const rangeStart = cursor && cursor > initialStart ? new Date(cursor.getTime() - OVERLAP_MS) : initialStart;
  const readOptions: ReadRecordsOptions = {
    timeRangeFilter: { operator: "between", startTime: rangeStart.toISOString(), endTime: rangeEnd.toISOString() },
    pageSize: 1000,
    ascendingOrder: true
  };

  const records = await readGrantedRecords(grantedCategories, readOptions);
  const payload: HealthConnectImportPayload = {
    ...(profileId ? { profileId } : {}),
    syncedAt: new Date().toISOString(),
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
    deviceLabel: `android-companion:${options.deviceId}`,
    steps: records.steps.map((record) => ({
      startTime: record.startTime,
      endTime: record.endTime,
      count: record.count,
      provenance: extractProvenance(record)
    })).filter((record) => Number.isFinite(record.count)),
    heartRate: records.heartRate.flatMap((record) =>
      record.samples.map((sample) => ({ time: sample.time, value: sample.beatsPerMinute, provenance: extractProvenance(record) }))
        .filter((sample) => Number.isFinite(sample.value))
    ),
    oxygenSaturation: records.oxygenSaturation.map((record) => ({
      time: record.time, value: record.percentage * 100, provenance: extractProvenance(record)
    })).filter((record) => Number.isFinite(record.value)),
    respiratoryRate: (records.respiratoryRate as unknown[]).flatMap((record) => {
      const time = stringValue((record as Record<string, unknown>).time);
      const value = extractRespiratoryRateBreathsPerMinute(record);
      if (!time || value === undefined || !Number.isFinite(value)) return [];
      return [{ time, value, provenance: extractProvenance(record) }];
    }),
    hrvRmssd: records.hrvRmssd.map((record) => ({
      time: record.time, value: record.heartRateVariabilityMillis, provenance: extractProvenance(record)
    })).filter((record) => Number.isFinite(record.value)),
    hrvSdnn: toPointSamples(records.hrvRmssd, (record) => ({
      time: record.time,
      value: extractHrvSdnnMillis(record),
      provenance: extractProvenance(record)
    })),
    basalBodyTemperatureC: toPointSamples(records.basalBodyTemperature, (record) => ({
      time: record.time,
      value: extractTemperatureInCelsius(record),
      provenance: extractProvenance(record)
    })),
    basalMetabolicRateKcalDay: toPointSamples(records.basalMetabolicRate, (record) => ({
      time: record.time,
      value: extractBasalMetabolicRateKcalDay(record),
      provenance: extractProvenance(record)
    })),
    bloodGlucoseMgDl: toPointSamples(records.bloodGlucose, (record) => ({
      time: record.time,
      value: extractBloodGlucoseMgDl(record),
      provenance: extractProvenance(record)
    })),
    bloodPressureSystolicMmHg: toPointSamples(records.bloodPressure, (record) => ({
      time: record.time,
      value: extractBloodPressureSystolicMmHg(record),
      provenance: extractProvenance(record)
    })),
    bloodPressureDiastolicMmHg: toPointSamples(records.bloodPressure, (record) => ({
      time: record.time,
      value: extractBloodPressureDiastolicMmHg(record),
      provenance: extractProvenance(record)
    })),
    bodyTemperatureC: toPointSamples(records.bodyTemperature, (record) => ({
      time: record.time,
      value: extractTemperatureInCelsius(record),
      provenance: extractProvenance(record)
    })),
    heightCm: toPointSamples(records.height, (record) => ({
      time: record.time,
      value: extractHeightInCm(record),
      provenance: extractProvenance(record)
    })),
    // Skin temperature reads are not yet exposed by this react-native-health-connect version.
    skinTemperatureC: [],
    vo2MaxMlKgMin: toPointSamples(records.vo2Max, (record) => ({
      time: record.time,
      value: extractVo2MaxMlKgMin(record),
      provenance: extractProvenance(record)
    })),
    weightKg: records.weight.map((record) => ({
      time: record.time, value: record.weight.inKilograms, provenance: extractProvenance(record)
    })).filter((record) => Number.isFinite(record.value)),
    exerciseSessions: records.exerciseSessions.map((record) => {
      const details = extractExerciseDetails(record);
      return {
        startTime: record.startTime,
        endTime: record.endTime,
        activityType: stringValue(details.exerciseType) ?? `exercise_type_${record.exerciseType}`,
        energyKcal: numberValue(details.energyKcal),
        distanceMeters: numberValue(details.distanceMeters),
        title: stringValue(details.title),
        notes: stringValue(details.notes),
        details,
        provenance: extractProvenance(record)
      };
    }),
    distanceMeters: records.distance.map((record) => ({
      startTime: record.startTime,
      endTime: record.endTime,
      value: record.distance.inMeters,
      provenance: extractProvenance(record)
    })).filter((record) => Number.isFinite(record.value)),
    floorsClimbed: records.floorsClimbed.map((record) => ({
      startTime: record.startTime,
      endTime: record.endTime,
      value: record.floors,
      provenance: extractProvenance(record)
    })).filter((record) => Number.isFinite(record.value)),
    activeCaloriesKcal: records.activeCaloriesBurned.map((record) => ({
      startTime: record.startTime,
      endTime: record.endTime,
      value: record.energy.inCalories,
      provenance: extractProvenance(record)
    })).filter((record) => Number.isFinite(record.value)),
    totalCaloriesKcal: records.totalCaloriesBurned.map((record) => ({
      startTime: record.startTime,
      endTime: record.endTime,
      value: record.energy.inCalories,
      provenance: extractProvenance(record)
    })).filter((record) => Number.isFinite(record.value)),
    sleepSessions: records.sleepSessions.map((record) => ({
      startTime: record.startTime,
      endTime: record.endTime,
      durationMinutes: Math.max(0, Math.round((new Date(record.endTime).getTime() - new Date(record.startTime).getTime()) / 60_000)),
      stages: record.stages,
      title: record.title,
      notes: record.notes,
      provenance: extractProvenance(record)
    })),
    bodyFatPct: records.bodyFat.map((record) => ({
      time: record.time,
      value: record.percentage * 100,
      provenance: extractProvenance(record)
    })).filter((record) => Number.isFinite(record.value)),
    leanBodyMassKg: records.leanBodyMass.map((record) => ({
      time: record.time,
      value: record.mass.inKilograms,
      provenance: extractProvenance(record)
    })).filter((record) => Number.isFinite(record.value)),
    bodyWaterMassKg: records.bodyWaterMass.map((record) => ({
      time: record.time,
      value: record.mass.inKilograms,
      provenance: extractProvenance(record)
    })).filter((record) => Number.isFinite(record.value)),
    boneMassKg: records.boneMass.map((record) => ({
      time: record.time,
      value: record.mass.inKilograms,
      provenance: extractProvenance(record)
    })).filter((record) => Number.isFinite(record.value))
  };

  const uploadResults = [];
  for (const chunk of chunkPayload(payload)) {
    uploadResults.push(await uploadChunk(endpointUrl, publicKeyHash, companionToken, chunk));
  }

  const importedRows = countRows(payload);
  const lastResponse = uploadResults.at(-1);
  return {
    status: "Sync complete.",
    syncCursor: rangeEnd.toISOString(),
    canAdvanceCursor: omittedCategories.length === 0,
    details: [
      `Synced ${importedRows} Health Connect records from ${rangeStart.toLocaleDateString()} to ${rangeEnd.toLocaleDateString()} in ${uploadResults.length} upload${uploadResults.length === 1 ? "" : "s"}.`,
      omittedCategories.length ? `Not synced (permission not granted): ${omittedCategories.join(", ")}.` : "",
      `Store counts: observations ${lastResponse?.counts?.observations ?? "n/a"}, samples ${lastResponse?.counts?.timeSeriesSamples ?? "n/a"}, activities ${lastResponse?.counts?.activitySessions ?? "n/a"}.`
    ].filter(Boolean).join("\n")
  };
}

async function readGrantedRecords(categories: HealthConnectCategory[], options: ReadRecordsOptions) {
  return {
    steps: categories.includes("Steps") ? await readAllRecords("Steps", options) : [],
    heartRate: categories.includes("HeartRate") ? await readAllRecords("HeartRate", options) : [],
    oxygenSaturation: categories.includes("OxygenSaturation") ? await readAllRecords("OxygenSaturation", options) : [],
    respiratoryRate: categories.includes("RespiratoryRate") ? await readAllRecords("RespiratoryRate" as RecordType, options) : [],
    hrvRmssd: categories.includes("HeartRateVariabilityRmssd") ? await readAllRecords("HeartRateVariabilityRmssd", options) : [],
    basalBodyTemperature: categories.includes("BasalBodyTemperature") ? await readAllRecords("BasalBodyTemperature", options) : [],
    basalMetabolicRate: categories.includes("BasalMetabolicRate") ? await readAllRecords("BasalMetabolicRate", options) : [],
    bloodGlucose: categories.includes("BloodGlucose") ? await readAllRecords("BloodGlucose", options) : [],
    bloodPressure: categories.includes("BloodPressure") ? await readAllRecords("BloodPressure", options) : [],
    bodyTemperature: categories.includes("BodyTemperature") ? await readAllRecords("BodyTemperature", options) : [],
    height: categories.includes("Height") ? await readAllRecords("Height", options) : [],
    vo2Max: categories.includes("Vo2Max") ? await readAllRecords("Vo2Max", options) : [],
    weight: categories.includes("Weight") ? await readAllRecords("Weight", options) : [],
    exerciseSessions: categories.includes("ExerciseSession") ? await readAllRecords("ExerciseSession", options) : [],
    distance: categories.includes("Distance") ? await readAllRecords("Distance", options) : [],
    floorsClimbed: categories.includes("FloorsClimbed") ? await readAllRecords("FloorsClimbed", options) : [],
    activeCaloriesBurned: categories.includes("ActiveCaloriesBurned") ? await readAllRecords("ActiveCaloriesBurned", options) : [],
    totalCaloriesBurned: categories.includes("TotalCaloriesBurned") ? await readAllRecords("TotalCaloriesBurned", options) : [],
    sleepSessions: categories.includes("SleepSession") ? await readAllRecords("SleepSession", options) : [],
    bodyFat: categories.includes("BodyFat") ? await readAllRecords("BodyFat", options) : [],
    leanBodyMass: categories.includes("LeanBodyMass") ? await readAllRecords("LeanBodyMass", options) : [],
    bodyWaterMass: categories.includes("BodyWaterMass") ? await readAllRecords("BodyWaterMass", options) : [],
    boneMass: categories.includes("BoneMass") ? await readAllRecords("BoneMass", options) : []
  };
}

export function chunkPayload(
  payload: HealthConnectImportPayload,
  maxUploadBytes = MAX_UPLOAD_BYTES
): HealthConnectImportPayload[] {
  const rows = [
    ...payload.steps.map((value) => ["steps", value] as const),
    ...payload.heartRate.map((value) => ["heartRate", value] as const),
    ...payload.oxygenSaturation.map((value) => ["oxygenSaturation", value] as const),
    ...payload.respiratoryRate.map((value) => ["respiratoryRate", value] as const),
    ...payload.hrvRmssd.map((value) => ["hrvRmssd", value] as const),
    ...payload.hrvSdnn.map((value) => ["hrvSdnn", value] as const),
    ...payload.basalBodyTemperatureC.map((value) => ["basalBodyTemperatureC", value] as const),
    ...payload.basalMetabolicRateKcalDay.map((value) => ["basalMetabolicRateKcalDay", value] as const),
    ...payload.bloodGlucoseMgDl.map((value) => ["bloodGlucoseMgDl", value] as const),
    ...payload.bloodPressureSystolicMmHg.map((value) => ["bloodPressureSystolicMmHg", value] as const),
    ...payload.bloodPressureDiastolicMmHg.map((value) => ["bloodPressureDiastolicMmHg", value] as const),
    ...payload.bodyTemperatureC.map((value) => ["bodyTemperatureC", value] as const),
    ...payload.heightCm.map((value) => ["heightCm", value] as const),
    ...payload.skinTemperatureC.map((value) => ["skinTemperatureC", value] as const),
    ...payload.vo2MaxMlKgMin.map((value) => ["vo2MaxMlKgMin", value] as const),
    ...payload.weightKg.map((value) => ["weightKg", value] as const),
    ...payload.exerciseSessions.map((value) => ["exerciseSessions", value] as const),
    ...payload.distanceMeters.map((value) => ["distanceMeters", value] as const),
    ...payload.floorsClimbed.map((value) => ["floorsClimbed", value] as const),
    ...payload.activeCaloriesKcal.map((value) => ["activeCaloriesKcal", value] as const),
    ...payload.totalCaloriesKcal.map((value) => ["totalCaloriesKcal", value] as const),
    ...payload.sleepSessions.map((value) => ["sleepSessions", value] as const),
    ...payload.bodyFatPct.map((value) => ["bodyFatPct", value] as const),
    ...payload.leanBodyMassKg.map((value) => ["leanBodyMassKg", value] as const),
    ...payload.bodyWaterMassKg.map((value) => ["bodyWaterMassKg", value] as const),
    ...payload.boneMassKg.map((value) => ["boneMassKg", value] as const)
  ];

  if (rows.length === 0) {
    return [{ ...makeChunkSkeleton(payload), batchId: `${payload.rangeEnd}:1/1` }];
  }

  const chunks: HealthConnectImportPayload[] = [];
  let current = makeChunkSkeleton(payload);
  let currentRows = 0;
  const batchIdDigits = String(Math.max(1, rows.length)).length;
  const batchIdReserve = utf8ByteLength(JSON.stringify({
    batchId: `${payload.rangeEnd}:${"9".repeat(batchIdDigits)}/${"9".repeat(batchIdDigits)}`
  })) - 1;
  let currentSize = utf8ByteLength(JSON.stringify(current)) + batchIdReserve;

  for (const [category, value] of rows) {
    const valueSize = utf8ByteLength(JSON.stringify(value));
    const addedSize = valueSize + (current[category].length > 0 ? 1 : 0);
    if (currentRows > 0 && currentSize + addedSize > maxUploadBytes) {
      chunks.push(current);
      current = makeChunkSkeleton(payload);
      currentRows = 0;
      currentSize = utf8ByteLength(JSON.stringify(current)) + batchIdReserve;
    }
    current[category].push(value as never);
    currentRows += 1;
    currentSize += valueSize + (current[category].length > 1 ? 1 : 0);
  }

  if (currentRows > 0) chunks.push(current);

  return chunks.map((chunk, index) => ({
    ...chunk,
    batchId: `${payload.rangeEnd}:${index + 1}/${chunks.length}`
  }));
}

async function uploadChunk(endpointUrl: string, publicKeyHash: string | null | undefined, token: string, payload: HealthConnectImportPayload) {
  const importUrl = `${endpointUrl.replace(/\/+$/, "")}/api/import/health-connect`;
  let response: Awaited<ReturnType<typeof pinnedFetch>> | null = null;
  let lastNetworkError: string | null = null;

  for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt++) {
    try {
      response = await pinnedFetch(importUrl, publicKeyHash ?? null, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", "x-companion-token": token },
        body: JSON.stringify(payload)
      });
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown network error";
      lastNetworkError = message;
      const retryable = /network i\/o error|timed out|could not connect|connection abort|connection reset/i.test(message);
      if (!retryable || attempt === MAX_UPLOAD_ATTEMPTS) {
        throw new Error(`Sync request failed before the API could respond: ${message}`);
      }
      await sleep(attempt * 1000);
    }
  }

  if (!response) {
    throw new Error(`Sync request failed before the API could respond: ${lastNetworkError ?? "Unknown network error"}`);
  }

  const body = (await response.json().catch(() => ({}))) as { error?: unknown; counts?: { observations?: number; timeSeriesSamples?: number; activitySessions?: number } };
  if (!response.ok) {
    if (response.status === 413) {
      throw new Error("Sync payload exceeded API size limits. Reduce selected categories or sync window and try again.");
    }
    throw new Error(typeof body.error === "string" ? body.error : `Sync endpoint returned ${response.status}.`);
  }
  return body;
}

function makeChunkSkeleton(payload: HealthConnectImportPayload): HealthConnectImportPayload {
  return {
    ...payload,
    batchId: undefined,
    steps: [],
    heartRate: [],
    oxygenSaturation: [],
    respiratoryRate: [],
    hrvRmssd: [],
    hrvSdnn: [],
    basalBodyTemperatureC: [],
    basalMetabolicRateKcalDay: [],
    bloodGlucoseMgDl: [],
    bloodPressureSystolicMmHg: [],
    bloodPressureDiastolicMmHg: [],
    bodyTemperatureC: [],
    heightCm: [],
    skinTemperatureC: [],
    vo2MaxMlKgMin: [],
    weightKg: [],
    exerciseSessions: [],
    distanceMeters: [],
    floorsClimbed: [],
    activeCaloriesKcal: [],
    totalCaloriesKcal: [],
    sleepSessions: [],
    bodyFatPct: [],
    leanBodyMassKg: [],
    bodyWaterMassKg: [],
    boneMassKg: []
  };
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractProvenance(record: unknown): HealthConnectProvenance | undefined {
  const metadata = (record as { metadata?: Record<string, unknown> }).metadata;
  if (!metadata) return undefined;
  const dataOrigin = metadata.dataOrigin;
  const origin = typeof dataOrigin === "object" && dataOrigin ? stringValue((dataOrigin as Record<string, unknown>).packageName) : stringValue(dataOrigin);
  const provenance = {
    recordId: stringValue(metadata.id),
    dataOrigin: origin,
    clientRecordId: stringValue(metadata.clientRecordId),
    lastModifiedTime: stringValue(metadata.lastModifiedTime),
    recordingMethod: metadata.recordingMethod === undefined ? undefined : String(metadata.recordingMethod),
    device: objectValue(metadata.device)
  };
  return Object.values(provenance).some(Boolean) ? provenance : undefined;
}

function extractExerciseDetails(record: unknown): Record<string, unknown> {
  const { metadata: _metadata, startTime: _startTime, endTime: _endTime, ...details } = record as Record<string, unknown>;
  return details;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function hasFinitePointValue(
  point: Omit<HealthConnectPointValue, "value"> & { value: number | undefined }
): point is HealthConnectPointValue {
  return Number.isFinite(point.value);
}

function toPointSamples<T>(
  rows: T[],
  mapper: (row: T) => Omit<HealthConnectPointValue, "value"> & { value: number | undefined }
): HealthConnectPointValue[] {
  return rows.map(mapper).filter(hasFinitePointValue);
}

function nestedNumber(source: unknown, ...paths: string[]): number | undefined {
  for (const path of paths) {
    const value = path.split(".").reduce<unknown>((current, key) => {
      if (typeof current !== "object" || current === null) return undefined;
      return (current as Record<string, unknown>)[key];
    }, source);
    const numeric = numberValue(value);
    if (numeric !== undefined) return numeric;
  }
  return undefined;
}

function extractTemperatureInCelsius(record: unknown): number | undefined {
  return nestedNumber(record, "temperature.inCelsius", "temperature.inDegreesCelsius", "value.inCelsius");
}

function extractBasalMetabolicRateKcalDay(record: unknown): number | undefined {
  return nestedNumber(record, "basalMetabolicRate.inKilocaloriesPerDay", "power.inKilocaloriesPerDay", "value.inKilocaloriesPerDay");
}

function extractBloodGlucoseMgDl(record: unknown): number | undefined {
  return nestedNumber(record, "level.inMilligramsPerDeciliter", "bloodGlucose.inMilligramsPerDeciliter", "value.inMilligramsPerDeciliter");
}

function extractBloodPressureSystolicMmHg(record: unknown): number | undefined {
  return nestedNumber(record, "systolic.inMillimetersOfMercury", "systolic.inMmHg");
}

function extractBloodPressureDiastolicMmHg(record: unknown): number | undefined {
  return nestedNumber(record, "diastolic.inMillimetersOfMercury", "diastolic.inMmHg");
}

function extractHeightInCm(record: unknown): number | undefined {
  const centimeters = nestedNumber(record, "height.inCentimeters", "value.inCentimeters");
  if (centimeters !== undefined) return centimeters;
  const meters = nestedNumber(record, "height.inMeters", "value.inMeters");
  return meters !== undefined ? meters * 100 : undefined;
}

function extractVo2MaxMlKgMin(record: unknown): number | undefined {
  return nestedNumber(record, "vo2MillilitersPerMinuteKilogram", "vo2.inMillilitersPerMinuteKilogram", "value.inMillilitersPerMinuteKilogram");
}

function extractHrvSdnnMillis(record: unknown): number | undefined {
  return nestedNumber(record, "heartRateVariabilitySdnnMillis", "sdnn.inMilliseconds", "sdnnMillis");
}

function extractRespiratoryRateBreathsPerMinute(record: unknown): number | undefined {
  return nestedNumber(record, "rate", "respiratoryRate", "value.inBreathsPerMinute", "respiratoryRate.inBreathsPerMinute");
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function countRows(payload: HealthConnectImportPayload): number {
  return payload.steps.length +
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
}

function parseCursor(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function normalizeSyncWindowDays(value: number | undefined): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 3650
    ? value
    : DEFAULT_HEALTH_CONNECT_SYNC_WINDOW_DAYS;
}

async function readAllRecords<T extends RecordType>(recordType: T, options: ReadRecordsOptions) {
  const records: Array<Awaited<ReturnType<typeof readRecords<T>>>["records"][number]> = [];
  let pageToken: string | undefined;
  do {
    const page = await readRecords(recordType, { ...options, pageToken });
    records.push(...page.records);
    pageToken = page.pageToken;
  } while (pageToken);
  return records;
}
