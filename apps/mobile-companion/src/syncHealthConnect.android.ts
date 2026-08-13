import {
  ExerciseType,
  SdkAvailabilityStatus,
  aggregateGroupByDuration,
  aggregateGroupByPeriod,
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
  HEALTH_CONNECT_SYNC_PROTOCOL_VERSION,
  type HealthConnectSyncBatchAcknowledgement,
  type HealthConnectSyncSessionResponse
} from "@vitana/shared";
import {
  DEFAULT_HEALTH_CONNECT_SYNC_WINDOW_DAYS,
  HEALTH_CONNECT_CATEGORIES,
  type HealthConnectCategory
} from "./endpointStore";
import { LONG_RUNNING_PINNED_REQUEST_TIMEOUT_MS, pinnedFetch } from "./pinnedFetch";
import { retryPinnedRequest } from "./retryPinnedRequest";

const OVERLAP_MS = 5 * 60 * 1000;
const MAX_UPLOAD_BYTES = 2_000_000;
interface HealthConnectProvenance {
  recordId?: string;
  dataOrigin?: string;
  clientRecordId?: string;
  lastModifiedTime?: string;
  recordingMethod?: string;
  device?: Record<string, unknown>;
  aggregation?: "health-connect-daily" | "health-connect-15m" | "companion-daily" | "companion-15m";
  dataOrigins?: string[];
}

interface HealthConnectPointValue {
  time: string;
  value: number;
  provenance?: HealthConnectProvenance;
}

interface HealthConnectMeasurementAggregate {
  startTime: string;
  endTime: string;
  granularity: "15m" | "day";
  average: number;
  minimum: number;
  maximum: number;
  count: number;
  calendarDate?: string;
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
  heartRate: HealthConnectMeasurementAggregate[];
  restingHeartRate: HealthConnectMeasurementAggregate[];
  oxygenSaturation: HealthConnectPointValue[];
  hrvRmssd: HealthConnectMeasurementAggregate[];
  respiratoryRate: HealthConnectMeasurementAggregate[];
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
  ) => Pick<HealthConnectPayloadCollections, Keys[number]>,
  readPagesOverride?: (
    options: ReadRecordsOptions
  ) => AsyncGenerator<Pick<HealthConnectPayloadCollections, Keys[number]>>
) {
  return {
    category,
    recordType,
    payloadKeys,
    available: true as const,
    permission: { accessType: "read", recordType } satisfies Permission,
    toPayload,
    /**
     * Yields one converted page at a time. Holding only the page under conversion is what keeps
     * a multi-year backfill inside a phone's memory budget - the previous `readAllRecords` built
     * one array containing every record of every type before anything was uploaded.
     */
    readPages: async function* (options: ReadRecordsOptions) {
      if (readPagesOverride) {
        yield* readPagesOverride(options);
        return;
      }
      for await (const records of readRecordPages(recordType, options)) {
        yield toPayload(records);
      }
    }
  };
}

export const HEALTH_CONNECT_DESCRIPTORS = [
  defineHealthConnectDescriptor("Steps", "Steps", ["steps"], (records) => ({
    steps: records.map((record) => ({
      startTime: record.startTime,
      endTime: record.endTime,
      count: record.count,
      provenance: extractProvenance(record)
    })).filter((record) => Number.isFinite(record.count))
  }), readDailyStepAggregates),
  defineHealthConnectDescriptor("HeartRate", "HeartRate", ["heartRate"], () => ({ heartRate: [] }), readHeartRateAggregates),
  defineHealthConnectDescriptor("RestingHeartRate", "RestingHeartRate", ["restingHeartRate"], () => ({ restingHeartRate: [] }), readRestingHeartRateAggregates),
  defineHealthConnectDescriptor("OxygenSaturation", "OxygenSaturation", ["oxygenSaturation"], (records) => ({
    oxygenSaturation: records.map((record) => ({
      time: record.time, value: record.percentage, provenance: extractProvenance(record)
    })).filter((record) => Number.isFinite(record.value))
  })),
  defineHealthConnectDescriptor("HeartRateVariabilityRmssd", "HeartRateVariabilityRmssd", ["hrvRmssd"], () => ({ hrvRmssd: [] }), readHrvRmssdAggregates),
  defineHealthConnectDescriptor("RespiratoryRate", "RespiratoryRate", ["respiratoryRate"], () => ({ respiratoryRate: [] }), readRespiratoryRateAggregates),
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
        activityType: exerciseTypeDisplayName(record.exerciseType),
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
      ...(Array.isArray(record.stages) ? { stages: record.stages } : {}),
      ...(stringValue(record.title) ? { title: stringValue(record.title) } : {}),
      ...(stringValue(record.notes) ? { notes: stringValue(record.notes) } : {}),
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

export type HealthConnectSyncCursors = Partial<Record<HealthConnectCategory, string>>;

export interface SyncOptions {
  deviceId: string;
  /** One cursor per category, so enabling a new category backfills it without rewinding the rest. */
  syncCursors?: HealthConnectSyncCursors | null;
  /**
   * Identity of an interrupted sync. Reusing it lets the PC skip the chunks it already applied,
   * which is why cursors must not advance until the whole session finishes.
   */
  sessionKey?: string | null;
  onSessionKey?: (sessionKey: string | null) => void | Promise<void>;
  syncWindowDays?: number;
  categories?: HealthConnectCategory[];
  onProgress?: (progress: HealthConnectSyncProgress) => void;
  signal?: AbortSignal;
}

export interface HealthConnectSyncProgress {
  stage: "preparing" | "permissions" | "reading" | "uploading" | "finalizing";
  detail: string;
}

export interface SyncResult {
  status: string;
  details: string;
  syncCursors: HealthConnectSyncCursors;
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
  const cursors = options.syncCursors ?? {};
  const rangeStartFor = (category: HealthConnectCategory) => {
    const cursor = parseCursor(cursors[category]);
    return cursor && cursor > initialStart ? new Date(cursor.getTime() - OVERLAP_MS) : initialStart;
  };
  const earliestStart = grantedDescriptors.reduce(
    (earliest, descriptor) => {
      const start = rangeStartFor(descriptor.category);
      return start < earliest ? start : earliest;
    },
    rangeEnd
  );

  const sessionKey = options.sessionKey ?? `${options.deviceId}:${rangeEnd.toISOString()}`;
  const deviceLabel = `android-companion:${options.deviceId}`;
  const transport = {
    endpointUrl: endpointUrl.replace(/\/+$/, ""),
    publicKeyHash: publicKeyHash ?? null,
    token: companionToken,
    signal: options.signal
  };
  await options.onSessionKey?.(sessionKey);

  const session = await startSyncSession(transport, {
    protocolVersion: HEALTH_CONNECT_SYNC_PROTOCOL_VERSION,
    sessionKey,
    deviceLabel,
    rangeStart: earliestStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
    ...(profileId ? { profileId } : {})
  });
  const alreadyProcessed = new Set(session.processedBatchIds);

  const builder = new ChunkBuilder(
    {
      ...(profileId ? { profileId } : {}),
      syncedAt: new Date().toISOString(),
      rangeStart: earliestStart.toISOString(),
      rangeEnd: rangeEnd.toISOString(),
      deviceLabel
    },
    sessionKey
  );
  let uploads = 0;
  const categoriesWithRecords = new Set<HealthConnectCategory>();
  const upload = async (chunk: HealthConnectImportPayload) => {
    if (alreadyProcessed.has(chunk.batchId!)) return;
    options.onProgress?.({ stage: "uploading", detail: `Uploading batch ${uploads + 1} to your paired PC…` });
    await uploadChunk(transport, session.sessionId, chunk);
    uploads += 1;
  };

  for (const [index, descriptor] of grantedDescriptors.entries()) {
    throwIfAborted(options.signal);
    options.onProgress?.({
      stage: "reading",
      detail: `Reading ${descriptor.category} (${index + 1} of ${grantedDescriptors.length})…`
    });
    const readOptions: ReadRecordsOptions = {
      timeRangeFilter: {
        operator: "between",
        startTime: rangeStartFor(descriptor.category).toISOString(),
        endTime: rangeEnd.toISOString()
      },
      pageSize: 1000,
      ascendingOrder: true
    };
    let foundRecord = false;
    for await (const page of descriptor.readPages(readOptions)) {
      throwIfAborted(options.signal);
      for (const key of descriptor.payloadKeys) {
        const values = (page as HealthConnectPayloadCollections)[key];
        if (values.length > 0) foundRecord = true;
        for (const value of values) {
          const completed = builder.add(key, value);
          if (completed) await upload(completed);
        }
      }
    }
    if (foundRecord) categoriesWithRecords.add(descriptor.category);
  }
  await upload(builder.flush());

  options.onProgress?.({ stage: "finalizing", detail: "Finalizing sync…" });
  await options.onSessionKey?.(null);
  const advanced: HealthConnectSyncCursors = { ...cursors };
  const advancedEmptyCategories: HealthConnectCategory[] = [];
  const retainedEmptyCategories: HealthConnectCategory[] = [];
  for (const descriptor of grantedDescriptors) {
    if (categoriesWithRecords.has(descriptor.category)) {
      advanced[descriptor.category] = rangeEnd.toISOString();
    } else if (parseCursor(cursors[descriptor.category])) {
      advanced[descriptor.category] = rangeEnd.toISOString();
      advancedEmptyCategories.push(descriptor.category);
    } else {
      retainedEmptyCategories.push(descriptor.category);
    }
  }

  return {
    status: "Sync complete.",
    syncCursors: advanced,
    details: [
      `Synced ${builder.totalRows} records from ${earliestStart.toLocaleDateString()} to ${rangeEnd.toLocaleDateString()} in ${uploads} upload${uploads === 1 ? "" : "s"}.`,
      builder.oldestTimestamp
        ? `Oldest record returned by Health Connect: ${localDateKey(builder.oldestTimestamp)}.`
        : "Health Connect returned no records in this window.",
      advancedEmptyCategories.length
        ? `No records returned: ${advancedEmptyCategories.join(", ")}. Existing sync start dates advanced after the successful read.`
        : "",
      retainedEmptyCategories.length
        ? `No records returned: ${retainedEmptyCategories.join(", ")}. First-sync backfill was kept because no valid prior cursor exists.`
        : "",
      windowDays > 30 ? "Extended Health Connect history access was requested for this sync." : "",
      omittedCategories.length ? `Not synced (permission not granted): ${omittedCategories.join(", ")}.` : ""
    ].filter(Boolean).join("\n")
  };
}

function localDateKey(value: string): string {
  const date = new Date(value);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

type ChunkBase = Pick<HealthConnectImportPayload, "syncedAt" | "rangeStart" | "rangeEnd" | "deviceLabel"> & { profileId?: string };

/**
 * Accumulates converted rows into exactly one in-flight chunk, handing it back the moment it would
 * exceed the upload limit. Batch ids are `<sessionKey>:<ordinal>` rather than `n/total` because a
 * streaming producer cannot know the total - and because a resumed sync replays the same read order
 * and therefore mints the same ids, which is what lets the PC skip what it already has.
 */
export class ChunkBuilder {
  private current!: HealthConnectImportPayload;
  private rows = 0;
  private size = 0;
  private index = 0;
  private readonly envelopeBytes: number;
  totalRows = 0;
  oldestTimestamp: string | undefined;

  constructor(
    private readonly base: ChunkBase,
    private readonly batchIdPrefix: string,
    private readonly maxUploadBytes = MAX_UPLOAD_BYTES
  ) {
    const emptyPayload = {
      ...this.base,
      batchId: "",
      ...makeEmptyPayloadCollections()
    };
    this.envelopeBytes = utf8ByteLength(JSON.stringify(emptyPayload)) - utf8ByteLength(JSON.stringify(""));
    this.reset();
  }

  add<Key extends PayloadCollectionKey>(key: Key, value: HealthConnectPayloadCollections[Key][number]): HealthConnectImportPayload | undefined {
    const serializedValue = JSON.stringify(value);
    const valueSize = utf8ByteLength(serializedValue);
    let addedSize = valueSize + (this.current[key].length > 0 ? 1 : 0);
    let completed: HealthConnectImportPayload | undefined;
    if (this.rows > 0 && this.size + addedSize > this.maxUploadBytes) {
      completed = this.current;
      this.reset();
      addedSize = valueSize;
    }
    if (this.size + addedSize > this.maxUploadBytes) {
      throw new Error(
        `A single Health Connect ${key} record is ${this.size + addedSize} UTF-8 bytes and exceeds the ${this.maxUploadBytes}-byte upload limit.`
      );
    }
    this.current[key].push(value as never);
    this.rows += 1;
    this.totalRows += 1;
    this.size += addedSize;
    this.trackOldest(value);
    return completed;
  }

  /** Always returns the trailing chunk, so a sync that found nothing still records an attempt. */
  flush(): HealthConnectImportPayload {
    return this.current;
  }

  private reset(): void {
    this.index += 1;
    this.current = {
      ...this.base,
      batchId: `${this.batchIdPrefix}:${this.index}`,
      ...makeEmptyPayloadCollections()
    };
    this.rows = 0;
    this.size = this.envelopeBytes + utf8ByteLength(JSON.stringify(this.current.batchId));
  }

  private trackOldest(value: unknown): void {
    const row = value as Record<string, unknown>;
    for (const field of ["time", "startTime", "endTime"] as const) {
      const candidate = row[field];
      if (typeof candidate === "string" && (!this.oldestTimestamp || candidate < this.oldestTimestamp)) {
        this.oldestTimestamp = candidate;
      }
    }
  }
}

/** Retained for tests and for callers holding a materialised payload; the sync path streams instead. */
export function chunkPayload(
  payload: HealthConnectImportPayload,
  maxUploadBytes = MAX_UPLOAD_BYTES
): HealthConnectImportPayload[] {
  const builder = new ChunkBuilder(payload, payload.rangeEnd, maxUploadBytes);
  const chunks: HealthConnectImportPayload[] = [];
  for (const key of PAYLOAD_COLLECTION_KEYS) {
    for (const value of payload[key]) {
      const completed = builder.add(key, value as never);
      if (completed) chunks.push(completed);
    }
  }
  chunks.push(builder.flush());
  return chunks;
}

interface SyncTransport {
  endpointUrl: string;
  publicKeyHash: string | null;
  token: string;
  signal?: AbortSignal;
}

async function startSyncSession(transport: SyncTransport, request: unknown): Promise<HealthConnectSyncSessionResponse> {
  return postJson<HealthConnectSyncSessionResponse>(transport, "/api/import/health-connect/sessions", request);
}

async function uploadChunk(
  transport: SyncTransport,
  sessionId: string,
  chunk: HealthConnectImportPayload
): Promise<HealthConnectSyncBatchAcknowledgement> {
  return postJson<HealthConnectSyncBatchAcknowledgement>(
    transport,
    `/api/import/health-connect/sessions/${encodeURIComponent(sessionId)}/chunks`,
    { ...chunk, protocolVersion: HEALTH_CONNECT_SYNC_PROTOCOL_VERSION, sessionId, batchId: chunk.batchId }
  );
}

async function postJson<T>(transport: SyncTransport, path: string, request: unknown): Promise<T> {
  const body = JSON.stringify(request);
  return retryPinnedRequest(async () => {
    throwIfAborted(transport.signal);
    const response = await pinnedFetch(`${transport.endpointUrl}${path}`, transport.publicKeyHash, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "x-companion-token": transport.token },
      body,
      timeoutMs: LONG_RUNNING_PINNED_REQUEST_TIMEOUT_MS,
      signal: transport.signal
    });
    const parsed = (await response.json().catch(() => ({}))) as { error?: unknown };
    if (!response.ok) {
      if (response.status === 413) {
        throw new Error("Sync payload exceeded API size limits. Reduce selected categories or sync window and try again.");
      }
      throw new Error(typeof parsed.error === "string" ? parsed.error : "Your paired PC could not complete the sync. Try again.");
    }
    return parsed as T;
  }, { signal: transport.signal });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw Object.assign(new Error("Sync was cancelled."), { name: "AbortError", code: "cancelled" });
  }
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

function exerciseTypeDisplayName(exerciseType: number): string {
  const typeName = Object.entries(ExerciseType).find(([, value]) => value === exerciseType)?.[0];
  return typeName
    ? typeName.split("_").map((word) => `${word[0]}${word.slice(1).toLowerCase()}`).join(" ")
    : `exercise_type_${exerciseType}`;
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

async function* readDailyStepAggregates(
  options: ReadRecordsOptions
): AsyncGenerator<Pick<HealthConnectPayloadCollections, "steps">> {
  if (!options.timeRangeFilter || options.timeRangeFilter.operator !== "between") {
    throw new Error("A bounded time range is required to aggregate Steps.");
  }
  const timeRangeFilter = completedLocalDayRange(options.timeRangeFilter.startTime, options.timeRangeFilter.endTime);
  if (!timeRangeFilter) {
    yield { steps: [] };
    return;
  }
  const groups = await aggregateGroupByPeriod({
    recordType: "Steps",
    timeRangeFilter,
    timeRangeSlicer: { period: "DAYS", length: 1 }
  });
  yield {
    steps: groups.map((group) => ({
      startTime: localDateTimeToIso(group.startTime),
      endTime: localDateTimeToIso(group.endTime, -1),
      count: group.result.COUNT_TOTAL,
      provenance: {
        aggregation: "health-connect-daily" as const,
        calendarDate: group.startTime.slice(0, 10),
        dataOrigins: group.result.dataOrigins
      }
    })).filter((record) => Number.isFinite(record.count))
  };
}

async function* readHeartRateAggregates(
  options: ReadRecordsOptions
): AsyncGenerator<Pick<HealthConnectPayloadCollections, "heartRate">> {
  if (!options.timeRangeFilter || options.timeRangeFilter.operator !== "between") {
    throw new Error("A bounded time range is required to aggregate Heart Rate.");
  }

  const dailyRange = completedLocalDayRange(options.timeRangeFilter.startTime, options.timeRangeFilter.endTime);
  if (dailyRange) {
    const groups = await aggregateGroupByDuration({
      recordType: "HeartRate",
      timeRangeFilter: dailyRange,
      timeRangeSlicer: { duration: "DAYS", length: 1 }
    });
    yield {
      heartRate: groups.flatMap((group) => {
        const aggregate = heartRateAggregateValues(group.result);
        return aggregate ? [{
          startTime: new Date(group.startTime).toISOString(),
          endTime: new Date(group.endTime).toISOString(),
          granularity: "day" as const,
          calendarDate: localCalendarDate(group.startTime),
          ...aggregate,
          provenance: {
            aggregation: "health-connect-daily" as const,
            dataOrigins: group.result.dataOrigins
          }
        }] : [];
      })
    };
  }

  const durationRange = completedQuarterHourRange(
    options.timeRangeFilter.startTime,
    options.timeRangeFilter.endTime
  );
  if (!durationRange) return;
  for (const timeRangeFilter of splitTimeRange(durationRange, 7)) {
    const groups = await aggregateGroupByDuration({
      recordType: "HeartRate",
      timeRangeFilter,
      timeRangeSlicer: { duration: "MINUTES", length: 15 }
    });
    yield {
      heartRate: groups.flatMap((group) => {
        const aggregate = heartRateAggregateValues(group.result);
        return aggregate ? [{
          startTime: new Date(group.startTime).toISOString(),
          endTime: new Date(group.endTime).toISOString(),
          granularity: "15m" as const,
          ...aggregate,
          provenance: {
            aggregation: "health-connect-15m" as const,
            dataOrigins: group.result.dataOrigins
          }
        }] : [];
      })
    };
  }
}

function heartRateAggregateValues(result: {
  BPM_AVG: number;
  BPM_MIN: number;
  BPM_MAX: number;
  MEASUREMENTS_COUNT: number;
}) {
  if (
    !Number.isFinite(result.BPM_AVG) ||
    !Number.isFinite(result.BPM_MIN) ||
    !Number.isFinite(result.BPM_MAX) ||
    !Number.isInteger(result.MEASUREMENTS_COUNT) ||
    result.MEASUREMENTS_COUNT <= 0
  ) {
    return undefined;
  }
  return {
    average: result.BPM_AVG,
    minimum: result.BPM_MIN,
    maximum: result.BPM_MAX,
    count: result.MEASUREMENTS_COUNT
  };
}

interface VitalAggregateBucket {
  startTime: string;
  endTime: string;
  granularity: HealthConnectMeasurementAggregate["granularity"];
  calendarDate?: string;
  sum: number;
  minimum: number;
  maximum: number;
  count: number;
  dataOrigins: Set<string>;
}

/**
 * Health Connect does not expose aggregate metrics for every instantaneous vital. Fold raw records
 * into the same bounded day and 15-minute buckets before upload.
 */
async function* readHrvRmssdAggregates(
  options: ReadRecordsOptions
): AsyncGenerator<Pick<HealthConnectPayloadCollections, "hrvRmssd">> {
  for await (const aggregates of readInstantaneousVitalAggregates(
    "HeartRateVariabilityRmssd", "heartRateVariabilityMillis", options
  )) {
    yield { hrvRmssd: aggregates };
  }
}

async function* readRestingHeartRateAggregates(
  options: ReadRecordsOptions
): AsyncGenerator<Pick<HealthConnectPayloadCollections, "restingHeartRate">> {
  for await (const aggregates of readInstantaneousVitalAggregates("RestingHeartRate", "beatsPerMinute", options)) {
    yield { restingHeartRate: aggregates };
  }
}

async function* readRespiratoryRateAggregates(
  options: ReadRecordsOptions
): AsyncGenerator<Pick<HealthConnectPayloadCollections, "respiratoryRate">> {
  for await (const aggregates of readInstantaneousVitalAggregates("RespiratoryRate", "rate", options)) {
    yield { respiratoryRate: aggregates };
  }
}

async function* readInstantaneousVitalAggregates(
  recordType: RecordType,
  valueField: string,
  options: ReadRecordsOptions
): AsyncGenerator<HealthConnectMeasurementAggregate[]> {
  if (!options.timeRangeFilter || options.timeRangeFilter.operator !== "between") {
    throw new Error(`A bounded time range is required to aggregate ${recordType}.`);
  }

  const dailyRange = completedLocalDayRange(options.timeRangeFilter.startTime, options.timeRangeFilter.endTime);
  const quarterHourRange = completedQuarterHourRange(options.timeRangeFilter.startTime, options.timeRangeFilter.endTime);
  const dailyBuckets = new Map<string, VitalAggregateBucket>();
  const quarterHourBuckets = new Map<string, VitalAggregateBucket>();

  for await (const records of readRecordPages(recordType, options)) {
    for (const record of records) {
      const fields = record as unknown as Record<string, unknown>;
      const time = stringValue(fields.time);
      const timestamp = time ? new Date(time).getTime() : Number.NaN;
      const value = numberValue(fields[valueField]);
      if (value === undefined || !Number.isFinite(timestamp)) continue;
      const provenance = extractProvenance(record);
      if (dailyRange && isWithinTimeRange(timestamp, dailyRange)) {
        const bounds = localDayBounds(time!);
        addVitalAggregateValue(dailyBuckets, bounds.startTime, {
          ...bounds,
          granularity: "day",
          calendarDate: localCalendarDate(time!)
        }, value, provenance?.dataOrigin);
      }
      if (quarterHourRange && isWithinTimeRange(timestamp, quarterHourRange)) {
        const bounds = quarterHourBounds(timestamp);
        addVitalAggregateValue(quarterHourBuckets, bounds.startTime, {
          ...bounds,
          granularity: "15m"
        }, value, provenance?.dataOrigin);
      }
    }
  }

  yield [...dailyBuckets.values()].map(toVitalAggregate);
  yield [...quarterHourBuckets.values()].map(toVitalAggregate);
}

function isWithinTimeRange(
  timestamp: number,
  range: { operator: "between"; startTime: string; endTime: string }
): boolean {
  const start = new Date(range.startTime).getTime();
  const end = new Date(range.endTime).getTime();
  return timestamp >= start && timestamp < end;
}

function localDayBounds(value: string): Pick<VitalAggregateBucket, "startTime" | "endTime"> {
  const start = new Date(value);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startTime: start.toISOString(), endTime: end.toISOString() };
}

function quarterHourBounds(timestamp: number): Pick<VitalAggregateBucket, "startTime" | "endTime"> {
  const quarterHourMs = 15 * 60 * 1000;
  const start = Math.floor(timestamp / quarterHourMs) * quarterHourMs;
  return { startTime: new Date(start).toISOString(), endTime: new Date(start + quarterHourMs).toISOString() };
}

function addVitalAggregateValue(
  buckets: Map<string, VitalAggregateBucket>,
  key: string,
  bounds: Pick<VitalAggregateBucket, "startTime" | "endTime" | "granularity" | "calendarDate">,
  value: number,
  dataOrigin: string | undefined
): void {
  const existing = buckets.get(key);
  if (existing) {
    existing.sum += value;
    existing.minimum = Math.min(existing.minimum, value);
    existing.maximum = Math.max(existing.maximum, value);
    existing.count += 1;
    if (dataOrigin) existing.dataOrigins.add(dataOrigin);
    return;
  }
  buckets.set(key, {
    ...bounds,
    sum: value,
    minimum: value,
    maximum: value,
    count: 1,
    dataOrigins: new Set(dataOrigin ? [dataOrigin] : [])
  });
}

function toVitalAggregate(bucket: VitalAggregateBucket): HealthConnectMeasurementAggregate {
  return {
    startTime: bucket.startTime,
    endTime: bucket.endTime,
    granularity: bucket.granularity,
    average: bucket.sum / bucket.count,
    minimum: bucket.minimum,
    maximum: bucket.maximum,
    count: bucket.count,
    ...(bucket.calendarDate ? { calendarDate: bucket.calendarDate } : {}),
    provenance: {
      aggregation: bucket.granularity === "day" ? "companion-daily" : "companion-15m",
      ...(bucket.dataOrigins.size ? { dataOrigins: [...bucket.dataOrigins].sort() } : {})
    }
  };
}

function completedQuarterHourRange(
  startTime: string,
  endTime: string
): { operator: "between"; startTime: string; endTime: string } | undefined {
  const quarterHourMs = 15 * 60 * 1000;
  const retentionStart = new Date(endTime).getTime() - 90 * 24 * 60 * 60 * 1000;
  const requestedStart = Math.max(new Date(startTime).getTime(), retentionStart);
  const start = Math.ceil(requestedStart / quarterHourMs) * quarterHourMs;
  const end = Math.floor(new Date(endTime).getTime() / quarterHourMs) * quarterHourMs;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return undefined;
  return {
    operator: "between",
    startTime: new Date(start).toISOString(),
    endTime: new Date(end).toISOString()
  };
}

function splitTimeRange(
  range: { operator: "between"; startTime: string; endTime: string },
  maximumDays: number
): Array<{ operator: "between"; startTime: string; endTime: string }> {
  const ranges = [];
  const maximumDurationMs = maximumDays * 24 * 60 * 60 * 1000;
  const end = new Date(range.endTime).getTime();
  let start = new Date(range.startTime).getTime();
  while (start < end) {
    const sliceEnd = Math.min(start + maximumDurationMs, end);
    ranges.push({
      operator: "between" as const,
      startTime: new Date(start).toISOString(),
      endTime: new Date(sliceEnd).toISOString()
    });
    start = sliceEnd;
  }
  return ranges;
}

function completedLocalDayRange(
  startTime: string,
  endTime: string
): { operator: "between"; startTime: string; endTime: string } | undefined {
  // Health Connect day aggregates are defined by the companion device's local calendar day.
  // Preserve that boundary through travel and daylight-saving changes rather than rebucketing in UTC.
  const start = new Date(startTime);
  const end = new Date(endTime);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  if (end <= start) return undefined;
  return { operator: "between", startTime: start.toISOString(), endTime: end.toISOString() };
}

function localDateTimeToIso(value: string, offsetMs = 0): string {
  const parsed = new Date(new Date(value).getTime() + offsetMs);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Health Connect returned an invalid aggregate timestamp.");
  return parsed.toISOString();
}

function localCalendarDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Health Connect returned an invalid aggregate timestamp.");
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

async function* readRecordPages<T extends RecordType>(recordType: T, options: ReadRecordsOptions) {
  let pageToken: string | undefined;
  do {
    const page = await readRecords(recordType, { ...options, pageToken });
    yield page.records;
    pageToken = page.pageToken;
  } while (pageToken);
}
