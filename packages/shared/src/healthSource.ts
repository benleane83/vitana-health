/**
 * Platform-neutral contract for a source of device health data.
 *
 * Today the only implementation is Android's Health Connect, and the sync path reaches straight
 * into it: the category list, the record descriptors, and `syncHealthConnect` are all imported by
 * name from screens. Adding Apple HealthKit that way means editing every one of those call sites.
 * The interface below is the seam - screens and coordinators depend on `HealthSourceProvider`, and
 * the descriptor list stays an implementation detail of the provider that owns it.
 *
 * This module deliberately contains no platform imports so it can be shared by the PC API, which
 * validates the same category vocabulary on the receiving end.
 */

/**
 * Canonical category vocabulary, shared by every provider and by the PC-side import validator.
 *
 * The names match Health Connect's record types because that is where they came from, but they are
 * the protocol's vocabulary now, not Android's: a HealthKit provider is expected to map
 * `HKQuantityTypeIdentifierStepCount` onto `Steps` rather than introduce a second spelling.
 */
export const HEALTH_SOURCE_CATEGORIES = [
  "Steps",
  "HeartRate",
  "OxygenSaturation",
  "HeartRateVariabilityRmssd",
  "BasalMetabolicRate",
  "Height",
  "Vo2Max",
  "Weight",
  "ExerciseSession",
  "Distance",
  "ActiveCaloriesBurned",
  "TotalCaloriesBurned",
  "SleepSession",
  "BodyFat"
] as const;

export type HealthSourceCategory = (typeof HEALTH_SOURCE_CATEGORIES)[number];

/** Which platform integration produced a sync. Persisted, so values must stay stable. */
export type HealthSourceId = "health-connect" | "healthkit";

/** One cursor per category, so enabling a new category backfills it without rewinding the rest. */
export type HealthSourceCursors = Partial<Record<HealthSourceCategory, string>>;

export interface HealthSourceSyncProgress {
  stage: "preparing" | "permissions" | "reading" | "uploading" | "finalizing";
  detail: string;
}

export interface HealthSourceSyncOptions {
  deviceId: string;
  syncCursors?: HealthSourceCursors | null;
  /**
   * Identity of an interrupted sync. Reusing it lets the PC skip the chunks it already applied,
   * which is why cursors must not advance until the whole session finishes.
   */
  sessionKey?: string | null;
  onSessionKey?: (sessionKey: string | null) => void | Promise<void>;
  syncWindowDays?: number;
  categories?: HealthSourceCategory[];
  onProgress?: (progress: HealthSourceSyncProgress) => void;
  signal?: AbortSignal;
}

export interface HealthSourceSyncResult {
  status: string;
  details: string;
  syncCursors: HealthSourceCursors;
}

export interface HealthSourceProvider {
  readonly id: HealthSourceId;
  /** Shown wherever the user is told where their readings come from. */
  readonly label: string;
  /**
   * The subset of `HEALTH_SOURCE_CATEGORIES` this provider can actually read. It is a subset
   * rather than the whole list because platforms differ - the picker renders from here, so an
   * unsupported category is never offered instead of being offered and then failing.
   */
  readonly categories: readonly HealthSourceCategory[];
  sync(
    endpointUrl: string,
    companionToken: string | null | undefined,
    profileId: string | null | undefined,
    publicKeyHash: string | null | undefined,
    options: HealthSourceSyncOptions
  ): Promise<HealthSourceSyncResult>;
}
