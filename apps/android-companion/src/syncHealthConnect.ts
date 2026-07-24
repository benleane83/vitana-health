import {
  SdkAvailabilityStatus,
  getSdkStatus,
  initialize,
  readRecords,
  requestPermission,
  type Permission,
  type ReadHealthDataHistoryPermission,
  type ReadRecordsOptions,
  type RecordType
} from "react-native-health-connect";
import { Platform } from "react-native";
import {
  DEFAULT_HEALTH_CONNECT_SYNC_WINDOW_DAYS,
  HEALTH_CONNECT_CATEGORIES,
  type HealthConnectCategory
} from "./endpointStore";
import { LONG_RUNNING_PINNED_REQUEST_TIMEOUT_MS, pinnedFetch } from "./pinnedFetch";

const OVERLAP_MS = 5 * 60 * 1000;
const MAX_UPLOAD_BYTES = 2_000_000;
const MAX_UPLOAD_ATTEMPTS = 3;
const DAILY_AGGREGATE_MIN_DURATION_MS = 23 * 60 * 60 * 1000;

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
  hrvRmssd: HealthConnectPointValue[];
  basalMetabolicRateKcalDay: HealthConnectPointValue[];
  heightCm: HealthConnectPointValue[];
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
}

type PayloadMetadataKey = "profileId" | "syncedAt" | "rangeStart" | "rangeEnd" | "deviceLabel" | "batchId";
type HealthConnectPayloadCollections = Omit<HealthConnectImportPayload, PayloadMetadataKey>;
type PayloadCollectionKey = keyof HealthConnectPayloadCollections;

function defineHealthConnectDescriptor<
  const Category extends HealthConnectCategory,
  const HealthRecordType extends RecordType,
  const Keys extends readonly PayloadCollectionKey[]
>(
  category: Category,
  recordType: HealthRecordType,
  payloadKeys: Keys,
  toPayload: (
    records: Array<Awaited<ReturnType<typeof readRecords<HealthRecordType>>>["records"][number]>
  ) => Pick<HealthConnectPayloadCollections, Keys[number]>
) {
  return {
    category,
    recordType,
    payloadKeys,
    available: true as const,
    permission: { accessType: "read", recordType } satisfies Permission,
    toPayload,
    read: async (options: ReadRecordsOptions) => toPayload(await readAllRecords(recordType, options))
  };
}

export const HEALTH_CONNECT_DESCRIPTORS = [
  defineHealthConnectDescriptor("Steps", "Steps", ["steps"], (records) => ({
    steps: records.map((record) => ({
      startTime: record.startTime,
      endTime: record.endTime,
      count: record.count,
      provenance: extractProvenance(record)
    })).filter((record) => Number.isFinite(record.count) && !isDailyAggregateInterval(record.startTime, record.endTime))
  })),
  defineHealthConnectDescriptor("HeartRate", "HeartRate", ["heartRate"], (records) => ({
    heartRate: records.flatMap((record) =>
      record.samples.map((sample) => ({ time: sample.time, value: sample.beatsPerMinute, provenance: extractProvenance(record) }))
        .filter((sample) => Number.isFinite(sample.value))
    )
  })),
  defineHealthConnectDescriptor("OxygenSaturation", "OxygenSaturation", ["oxygenSaturation"], (records) => ({
    oxygenSaturation: records.map((record) => ({
      time: record.time, value: record.percentage, provenance: extractProvenance(record)
    })).filter((record) => Number.isFinite(record.value))
  })),
  defineHealthConnectDescriptor("HeartRateVariabilityRmssd", "HeartRateVariabilityRmssd", ["hrvRmssd"], (records) => ({
    hrvRmssd: records.map((record) => ({
      time: record.time, value: record.heartRateVariabilityMillis, provenance: extractProvenance(record)
    })).filter((record) => Number.isFinite(record.value))
  })),
  defineHealthConnectDescriptor("BasalMetabolicRate", "BasalMetabolicRate", ["basalMetabolicRateKcalDay"], (records) => ({
    basalMetabolicRateKcalDay: toPointSamples(records, (record) => ({
      time: record.time, value: extractBasalMetabolicRateKcalDay(record), provenance: extractProvenance(record)
    }))
  })),
  defineHealthConnectDescriptor("Height", "Height", ["heightCm"], (records) => ({
    heightCm: toPointSamples(records, (record) => ({
      time: record.time, value: extractHeightInCm(record), provenance: extractProvenance(record)
    }))
  })),
  defineHealthConnectDescriptor("Vo2Max", "Vo2Max", ["vo2MaxMlKgMin"], (records) => ({
    vo2MaxMlKgMin: toPointSamples(records, (record) => ({
      time: record.time, value: extractVo2MaxMlKgMin(record), provenance: extractProvenance(record)
    }))
  })),
  defineHealthConnectDescriptor("Weight", "Weight", ["weightKg"], (records) => ({
    weightKg: records.map((record) => ({
      time: record.time, value: record.weight.inKilograms, provenance: extractProvenance(record)
    })).filter((record) => Number.isFinite(record.value))
  })),
  defineHealthConnectDescriptor("ExerciseSession", "ExerciseSession", ["exerciseSessions"], (records) => ({
    exerciseSessions: records.map((record) => {
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
    })
  })),
  defineHealthConnectDescriptor("Distance", "Distance", ["distanceMeters"], (records) => ({
    distanceMeters: records.map((record) => ({
      startTime: record.startTime, endTime: record.endTime, value: record.distance.inMeters, provenance: extractProvenance(record)
    })).filter((record) => Number.isFinite(record.value))
  })),
  defineHealthConnectDescriptor("ActiveCaloriesBurned", "ActiveCaloriesBurned", ["activeCaloriesKcal"], (records) => ({
    activeCaloriesKcal: records.map((record) => ({
      startTime: record.startTime, endTime: record.endTime, value: record.energy.inKilocalories, provenance: extractProvenance(record)
    })).filter((record) => Number.isFinite(record.value))
  })),
  defineHealthConnectDescriptor("TotalCaloriesBurned", "TotalCaloriesBurned", ["totalCaloriesKcal"], (records) => ({
    totalCaloriesKcal: records.map((record) => ({
      startTime: record.startTime, endTime: record.endTime, value: record.energy.inKilocalories, provenance: extractProvenance(record)
    })).filter((record) => Number.isFinite(record.value))
  })),
  defineHealthConnectDescriptor("SleepSession", "SleepSession", ["sleepSessions"], (records) => ({
    sleepSessions: records.map((record) => ({
      startTime: record.startTime,
      endTime: record.endTime,
      durationMinutes: Math.max(0, Math.round((new Date(record.endTime).getTime() - new Date(record.startTime).getTime()) / 60_000)),
      stages: record.stages,
      title: record.title,
      notes: record.notes,
      provenance: extractProvenance(record)
    }))
  })),
  defineHealthConnectDescriptor("BodyFat", "BodyFat", ["bodyFatPct"], (records) => ({
    bodyFatPct: records.map((record) => ({
      time: record.time, value: record.percentage, provenance: extractProvenance(record)
    })).filter((record) => Number.isFinite(record.value))
  }))
] as const;

const PAYLOAD_COLLECTION_KEYS = HEALTH_CONNECT_DESCRIPTORS.flatMap((descriptor) => descriptor.payloadKeys) as PayloadCollectionKey[];

export interface SyncOptions {
  deviceId: string;
  syncCursor?: string | null;
  syncWindowDays?: number;
  categories?: HealthConnectCategory[];
  onProgress?: (progress: HealthConnectSyncProgress) => void;
}

export interface HealthConnectSyncProgress {
  stage: "preparing" | "permissions" | "reading" | "uploading" | "finalizing";
  detail: string;
}

export interface SyncResult {
  status: string;
  details: string;
  syncCursor: string;
  canAdvanceCursor: boolean;
}

export async function syncHealthConnect(
  endpointUrl: string,
  companionToken: string | null | undefined,
  profileId: string | null | undefined,
  publicKeyHash: string | null | undefined,
  options: SyncOptions
): Promise<SyncResult> {
  if (Platform.OS !== "android") throw new Error("Sync is currently available on Android only.");
  if (!__DEV__ && !endpointUrl.startsWith("https://")) throw new Error("Production sync requires an HTTPS endpoint.");
  if (!companionToken) throw new Error("A paired device token is required. Pair this device before syncing.");

  options.onProgress?.({ stage: "preparing", detail: "Checking Health Connect on this phone…" });
  const sdkStatus = await getSdkStatus();
  if (sdkStatus !== SdkAvailabilityStatus.SDK_AVAILABLE) {
    throw new Error(
      sdkStatus === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED
        ? "Your Android health data service needs an update from the Play Store before syncing."
        : "Health data sync is unavailable on this device."
    );
  }
  try {
    if (!(await initialize())) throw new Error("returned false");
  } catch (error) {
    throw new Error(`Could not start Sync: ${error instanceof Error ? error.message : "Unknown error"}`);
  }

  const selectedCategories = HEALTH_CONNECT_CATEGORIES.filter((category) => options.categories?.includes(category) ?? false);
  if (selectedCategories.length === 0) throw new Error("Select at least one data category to sync.");
  const selectedDescriptors = HEALTH_CONNECT_DESCRIPTORS.filter((descriptor) => selectedCategories.includes(descriptor.category));
  const availableDescriptors = selectedDescriptors.filter((descriptor) => descriptor.available);
  const windowDays = normalizeSyncWindowDays(options.syncWindowDays);
  const historyPermission: ReadHealthDataHistoryPermission = { accessType: "read", recordType: "ReadHealthDataHistory" };
  const requestedPermissions: Array<Permission | ReadHealthDataHistoryPermission> = [
    ...availableDescriptors.map((descriptor) => descriptor.permission),
    ...(windowDays > 30 ? [historyPermission] : [])
  ];
  if (requestedPermissions.length === 0) {
    throw new Error("Selected categories are not supported by the installed health data service.");
  }
  options.onProgress?.({ stage: "permissions", detail: "Confirming access to selected health data…" });
  const grantedPermissions = await requestPermission(requestedPermissions);
  const grantedDescriptors = availableDescriptors.filter((descriptor) =>
    grantedPermissions.some((granted) => granted.accessType === "read" && granted.recordType === descriptor.permission.recordType)
  );
  const grantedCategories: HealthConnectCategory[] = grantedDescriptors.map((descriptor) => descriptor.category);
  if (grantedCategories.length === 0) {
    throw new Error("No selected health data permissions were granted. Allow at least one category to sync.");
  }
  const omittedCategories = selectedCategories.filter((category) => !grantedCategories.includes(category));

  const rangeEnd = new Date();
  const initialStart = new Date(rangeEnd.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const cursor = parseCursor(options.syncCursor);
  const rangeStart = cursor && cursor > initialStart ? new Date(cursor.getTime() - OVERLAP_MS) : initialStart;
  const readOptions: ReadRecordsOptions = {
    timeRangeFilter: { operator: "between", startTime: rangeStart.toISOString(), endTime: rangeEnd.toISOString() },
    pageSize: 1000,
    ascendingOrder: true
  };

  const collections = await readGrantedCollections(grantedDescriptors, readOptions, options.onProgress);
  const payload: HealthConnectImportPayload = {
    ...(profileId ? { profileId } : {}),
    syncedAt: new Date().toISOString(),
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
    deviceLabel: `android-companion:${options.deviceId}`,
    ...collections
  };

  const chunks = chunkPayload(payload);
  const uploadResults = [];
  for (const [index, chunk] of chunks.entries()) {
    options.onProgress?.({ stage: "uploading", detail: `Uploading ${index + 1} of ${chunks.length} to your paired PC…` });
    uploadResults.push(await uploadChunk(endpointUrl, publicKeyHash, companionToken, chunk));
  }

  options.onProgress?.({ stage: "finalizing", detail: "Finalizing sync…" });
  const importedRows = countRows(payload);
  const oldestReturnedAt = oldestPayloadTimestamp(payload);
  return {
    status: "Sync complete.",
    syncCursor: rangeEnd.toISOString(),
    canAdvanceCursor: omittedCategories.length === 0,
    details: [
      `Synced ${importedRows} records from ${rangeStart.toLocaleDateString()} to ${rangeEnd.toLocaleDateString()} in ${uploadResults.length} upload${uploadResults.length === 1 ? "" : "s"}.`,
      oldestReturnedAt ? `Oldest record returned by Health Connect: ${oldestReturnedAt.slice(0, 10)}.` : "Health Connect returned no records in this window.",
      windowDays > 30 ? "Extended Health Connect history access was requested for this sync." : "",
      omittedCategories.length ? `Not synced (permission not granted): ${omittedCategories.join(", ")}.` : ""
    ].filter(Boolean).join("\n")
  };
}

async function readGrantedCollections(
  descriptors: Array<(typeof HEALTH_CONNECT_DESCRIPTORS)[number]>,
  options: ReadRecordsOptions,
  onProgress?: SyncOptions["onProgress"]
): Promise<HealthConnectPayloadCollections> {
  const collections = makeEmptyPayloadCollections();
  for (const [index, descriptor] of descriptors.entries()) {
    onProgress?.({ stage: "reading", detail: `Reading ${descriptor.category} (${index + 1} of ${descriptors.length})…` });
    Object.assign(collections, await descriptor.read(options));
  }
  return collections;
}

export function chunkPayload(
  payload: HealthConnectImportPayload,
  maxUploadBytes = MAX_UPLOAD_BYTES
): HealthConnectImportPayload[] {
  const rows = PAYLOAD_COLLECTION_KEYS.flatMap((key) => payload[key].map((value) => [key, value] as const));

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
        body: JSON.stringify(payload),
        timeoutMs: LONG_RUNNING_PINNED_REQUEST_TIMEOUT_MS
      });
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown network error";
      lastNetworkError = message;
      const retryable = /network i\/o error|timed out|could not connect|connection (?:abort|reset)|interrupted/i.test(message);
      if (!retryable || attempt === MAX_UPLOAD_ATTEMPTS) {
        throw new Error(message);
      }
      await sleep(attempt * 1000);
    }
  }

  if (!response) {
    throw new Error(lastNetworkError ?? "Could not reach your paired PC. Check the local network and try again.");
  }

  const body = (await response.json().catch(() => ({}))) as { error?: unknown; counts?: { observations?: number; timeSeriesSamples?: number; activitySessions?: number } };
  if (!response.ok) {
    if (response.status === 413) {
      throw new Error("Sync payload exceeded API size limits. Reduce selected categories or sync window and try again.");
    }
    throw new Error(typeof body.error === "string" ? body.error : "Your paired PC could not complete the sync. Try again.");
  }
  return body;
}

function makeChunkSkeleton(payload: HealthConnectImportPayload): HealthConnectImportPayload {
  return {
    ...payload,
    batchId: undefined,
    ...makeEmptyPayloadCollections()
  };
}

function makeEmptyPayloadCollections(): HealthConnectPayloadCollections {
  return Object.fromEntries(PAYLOAD_COLLECTION_KEYS.map((key) => [key, []])) as unknown as HealthConnectPayloadCollections;
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

function extractBasalMetabolicRateKcalDay(record: unknown): number | undefined {
  return nestedNumber(record, "basalMetabolicRate.inKilocaloriesPerDay", "power.inKilocaloriesPerDay", "value.inKilocaloriesPerDay");
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

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function countRows(payload: HealthConnectImportPayload): number {
  return PAYLOAD_COLLECTION_KEYS.reduce((total, key) => total + payload[key].length, 0);
}

function isDailyAggregateInterval(startAt: string, endAt: string): boolean {
  return new Date(endAt).getTime() - new Date(startAt).getTime() >= DAILY_AGGREGATE_MIN_DURATION_MS;
}

function oldestPayloadTimestamp(payload: HealthConnectImportPayload): string | undefined {
  let oldest: string | undefined;
  for (const key of PAYLOAD_COLLECTION_KEYS) {
    for (const row of payload[key] as Array<Record<string, unknown>>) {
      for (const field of ["time", "startTime", "endTime"] as const) {
        const value = row[field];
        if (typeof value === "string" && (!oldest || value < oldest)) oldest = value;
      }
    }
  }
  return oldest;
}

function parseCursor(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function normalizeSyncWindowDays(value: number | undefined): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 30 && value <= 365
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
