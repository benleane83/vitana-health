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

interface HealthConnectPointValue {
  time: string;
  value: number;
}

interface HealthConnectImportPayload {
  profileId?: string;
  syncedAt: string;
  rangeStart: string;
  rangeEnd: string;
  deviceLabel: string;
  steps: Array<{ startTime: string; endTime: string; count: number }>;
  heartRate: HealthConnectPointValue[];
  oxygenSaturation: HealthConnectPointValue[];
  hrvRmssd: HealthConnectPointValue[];
  weightKg: HealthConnectPointValue[];
  exerciseSessions: Array<{
    startTime: string;
    endTime: string;
    activityType: string;
    energyKcal?: number;
    distanceMeters?: number;
  }>;
}

export interface SyncResult {
  status: string;
  details: string;
}

const readPermissions: Permission[] = [
  { accessType: "read", recordType: "Steps" },
  { accessType: "read", recordType: "HeartRate" },
  { accessType: "read", recordType: "OxygenSaturation" },
  { accessType: "read", recordType: "HeartRateVariabilityRmssd" },
  { accessType: "read", recordType: "Weight" },
  { accessType: "read", recordType: "ExerciseSession" }
];

export async function syncHealthConnectLast30Days(
  endpointUrl: string,
  companionToken?: string | null,
  profileId?: string | null
): Promise<SyncResult> {
  if (Platform.OS !== "android") {
    throw new Error("This app only supports Android Health Connect.");
  }

  const sdkStatus = await getSdkStatus();
  if (sdkStatus !== SdkAvailabilityStatus.SDK_AVAILABLE) {
    if (sdkStatus === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) {
      throw new Error("Health Connect needs an update from the Play Store before syncing.");
    }
    throw new Error("Health Connect is unavailable on this device.");
  }

  let initialized = false;
  try {
    initialized = await initialize();
  } catch (error) {
    throw new Error(`Health Connect initialization error: ${error instanceof Error ? error.message : "Unknown error"}`);
  }

  if (!initialized) {
    throw new Error("Failed to initialize Health Connect (returned false).");
  }

  const grantedPermissions = await requestPermission(readPermissions);
  const missingPermissions = readPermissions.filter(
    (requiredPermission) =>
      !grantedPermissions.some(
        (grantedPermission) =>
          grantedPermission.accessType === requiredPermission.accessType &&
          grantedPermission.recordType === requiredPermission.recordType
      )
  );

  if (missingPermissions.length > 0) {
    throw new Error(`Missing Health Connect permissions: ${missingPermissions.map((permission) => permission.recordType).join(", ")}`);
  }

  const rangeEnd = new Date();
  const rangeStart = new Date(rangeEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
  const readOptions: ReadRecordsOptions = {
    timeRangeFilter: {
      operator: "between",
      startTime: rangeStart.toISOString(),
      endTime: rangeEnd.toISOString()
    },
    pageSize: 1000,
    ascendingOrder: true
  };

  const [stepsRecords, heartRateRecords, oxygenRecords, hrvRecords, weightRecords, exerciseRecords] = await Promise.all([
    readAllRecords("Steps", readOptions),
    readAllRecords("HeartRate", readOptions),
    readAllRecords("OxygenSaturation", readOptions),
    readAllRecords("HeartRateVariabilityRmssd", readOptions),
    readAllRecords("Weight", readOptions),
    readAllRecords("ExerciseSession", readOptions)
  ]);

  const payload: HealthConnectImportPayload = {
    ...(profileId ? { profileId } : {}),
    syncedAt: new Date().toISOString(),
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
    deviceLabel: "android-companion",
    steps: stepsRecords
      .map((record) => ({
        startTime: record.startTime,
        endTime: record.endTime,
        count: record.count
      }))
      .filter((record) => Number.isFinite(record.count)),
    heartRate: heartRateRecords.flatMap((record) =>
      record.samples
        .map((sample) => ({
          time: sample.time,
          value: sample.beatsPerMinute
        }))
        .filter((sample) => Number.isFinite(sample.value))
    ),
    oxygenSaturation: oxygenRecords
      .map((record) => ({
        time: record.time,
        value: record.percentage * 100
      }))
      .filter((record) => Number.isFinite(record.value)),
    hrvRmssd: hrvRecords
      .map((record) => ({
        time: record.time,
        value: record.heartRateVariabilityMillis
      }))
      .filter((record) => Number.isFinite(record.value)),
    weightKg: weightRecords
      .map((record) => ({
        time: record.time,
        value: record.weight.inKilograms
      }))
      .filter((record) => Number.isFinite(record.value)),
    exerciseSessions: exerciseRecords.map((record) => ({
      startTime: record.startTime,
      endTime: record.endTime,
      activityType: record.title?.trim() ? record.title : `exercise_type_${record.exerciseType}`
    }))
  };

  const response = await fetch(`${endpointUrl.replace(/\/+$/, "")}/api/import/health-connect`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(companionToken ? { "x-companion-token": companionToken } : {})
    },
    body: JSON.stringify(payload)
  });

  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    const issueDetails = Array.isArray(responseBody.issues)
      ? responseBody.issues
          .slice(0, 5)
          .map((issue: { path?: string[]; message?: string }) => `${issue.path?.join(".") || "body"}: ${issue.message || "Invalid value"}`)
          .join("; ")
      : "";
    throw new Error(
      typeof responseBody.error === "string"
        ? issueDetails && !responseBody.error.includes(issueDetails)
          ? `${responseBody.error}: ${issueDetails}`
          : responseBody.error
        : `Sync endpoint returned ${response.status}.`
    );
  }

  const importedRows =
    payload.steps.length +
    payload.heartRate.length +
    payload.oxygenSaturation.length +
    payload.hrvRmssd.length +
    payload.weightKg.length +
    payload.exerciseSessions.length;

  return {
    status: "Sync complete.",
    details: [
      `Synced ${importedRows} Health Connect records from the last 30 days.`,
      `Store counts: observations ${responseBody?.counts?.observations ?? "n/a"}, samples ${responseBody?.counts?.timeSeriesSamples ?? "n/a"}, activities ${responseBody?.counts?.activitySessions ?? "n/a"}.`,
      `Import status: ${responseBody?.import?.status ?? "unknown"}.`
    ].join("\n")
  };
}

async function readAllRecords<T extends RecordType>(recordType: T, options: ReadRecordsOptions) {
  const records: Array<Awaited<ReturnType<typeof readRecords<T>>>["records"][number]> = [];
  let pageToken: string | undefined;
  do {
    const page = await readRecords(recordType, {
      ...options,
      pageToken
    });
    records.push(...page.records);
    pageToken = page.pageToken;
  } while (pageToken);
  return records;
}
