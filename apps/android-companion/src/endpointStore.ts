import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

const CONNECTION_KEY = "vitana.connection";
const CORRUPT_CONNECTION_KEY = "vitana.connection.corrupt";
const DEVICE_ID_KEY = "vitana.deviceId";
const TOKEN_KEY = "vitana.companionToken";
const PENDING_REVOCATION_KEY = "vitana.pendingRevocation";
const SELECTED_PROFILE_ID_KEY = "vitana.selectedProfileId";

export const HEALTH_CONNECT_CATEGORIES = [
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

export type HealthConnectCategory = (typeof HEALTH_CONNECT_CATEGORIES)[number];
export type HealthSourceCursors = Partial<Record<HealthConnectCategory, string>>;
export const DEFAULT_HEALTH_CONNECT_SYNC_WINDOW_DAYS = 30;
export const HEALTH_CONNECT_SYNC_WINDOW_OPTIONS = [30, 60, 90, 180, 365] as const;

export interface ConnectionDetails {
  url: string;
  deviceId: string;
  token: string | null;
  publicKeyHash: string | null;
  name: string | null;
  pairedAt: string | null;
  lastSyncAt: string | null;
  pairingId?: string | null;
  serverInstanceId?: string | null;
  profileId?: string | null;
  /** One cursor per category so enabling a category backfills only that category. */
  healthSourceCursors: HealthSourceCursors;
  /** Identity of an interrupted sync, so a killed app resumes instead of restarting. */
  healthSourceSessionKey: string | null;
  healthConnectSyncWindowDays: number;
  healthSourceCategories: HealthConnectCategory[];
  healthConnectDisclosureAcknowledged: boolean;
}

export type PendingRevocation = Pick<ConnectionDetails, "url" | "token" | "publicKeyHash">;

interface StoredConnection extends Omit<ConnectionDetails, "token" | "deviceId"> {
  /** Retired in favour of the per-category map; still read once so existing installs keep their place. */
  healthConnectSyncCursor?: string | null;
  /** Retired platform-specific name for the selected categories. */
  healthConnectCategories?: HealthConnectCategory[];
}

async function generateDeviceId(): Promise<string> {
  return Array.from(await Crypto.getRandomBytesAsync(16), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = await generateDeviceId();
  await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
  return id;
}

export async function loadConnection(): Promise<ConnectionDetails | null> {
  const raw = await AsyncStorage.getItem(CONNECTION_KEY);
  if (!raw) return null;
  let stored: StoredConnection;
  try {
    stored = JSON.parse(raw) as StoredConnection;
  } catch {
    // A record we cannot parse is not the same as "never paired". Preserve the original bytes so a
    // later save cannot silently destroy the pairing, and report it as unavailable rather than absent.
    await AsyncStorage.setItem(CORRUPT_CONNECTION_KEY, raw);
    throw new ConnectionRecordUnreadableError();
  }
  const [deviceId, token] = await Promise.all([getDeviceId(), SecureStore.getItemAsync(TOKEN_KEY)]);
  const healthSourceCategories = normalizeHealthConnectCategories(
    stored.healthSourceCategories ?? stored.healthConnectCategories
  );
  return {
    ...stored,
    deviceId,
    token,
    healthSourceCursors: migrateHealthSourceCursors(stored, healthSourceCategories),
    healthSourceSessionKey: stored.healthSourceSessionKey ?? null,
    pairingId: stored.pairingId ?? null,
    serverInstanceId: stored.serverInstanceId ?? null,
    profileId: stored.profileId ?? null,
    healthConnectSyncWindowDays: normalizeSyncWindowDays(stored.healthConnectSyncWindowDays),
    healthSourceCategories,
    healthConnectDisclosureAcknowledged: stored.healthConnectDisclosureAcknowledged === true
  };
}

/** The stored pairing exists but could not be decoded. Distinct from "this phone is not paired". */
export class ConnectionRecordUnreadableError extends Error {
  constructor() {
    super("The saved pairing could not be read. Re-pair this phone with your PC.");
    this.name = "ConnectionRecordUnreadableError";
  }
}

/**
 * Every mutation of the connection record is a read-modify-write across two stores, so they are
 * chained: a cursor update landing at the same time as a category save used to drop one of them.
 */
let connectionWrites: Promise<unknown> = Promise.resolve();

function withConnectionLock<T>(operation: () => Promise<T>): Promise<T> {
  const next = connectionWrites.then(operation, operation);
  connectionWrites = next.catch(() => undefined);
  return next;
}

export function saveConnection(patch: Partial<ConnectionDetails> & { url: string }): Promise<ConnectionDetails> {
  return withConnectionLock(() => writeConnection(patch));
}

async function writeConnection(patch: Partial<ConnectionDetails> & { url: string }): Promise<ConnectionDetails> {
  // Re-pairing over an unreadable record must still work; `loadConnection` has already preserved the
  // original bytes, so there is nothing left to lose by starting from a blank slate here.
  const existing = await loadConnection().catch((caught: unknown) => {
    if (caught instanceof ConnectionRecordUnreadableError) return null;
    throw caught;
  });
  const deviceId = await getDeviceId();
  const token = patch.token !== undefined ? patch.token : (existing?.token ?? null);
  const updated: ConnectionDetails = {
    url: patch.url,
    deviceId,
    token,
    publicKeyHash: patch.publicKeyHash !== undefined ? patch.publicKeyHash : (existing?.publicKeyHash ?? null),
    name: patch.name !== undefined ? patch.name : (existing?.name ?? null),
    pairedAt: patch.pairedAt !== undefined ? patch.pairedAt : (existing?.pairedAt ?? null),
    lastSyncAt: patch.lastSyncAt !== undefined ? patch.lastSyncAt : (existing?.lastSyncAt ?? null),
    pairingId: patch.pairingId !== undefined ? patch.pairingId : (existing?.pairingId ?? null),
    serverInstanceId: patch.serverInstanceId !== undefined ? patch.serverInstanceId : (existing?.serverInstanceId ?? null),
    profileId: patch.profileId !== undefined ? patch.profileId : (existing?.profileId ?? null),
    healthSourceCursors: patch.healthSourceCursors ?? existing?.healthSourceCursors ?? {},
    healthSourceSessionKey:
      patch.healthSourceSessionKey !== undefined ? patch.healthSourceSessionKey : (existing?.healthSourceSessionKey ?? null),
    healthConnectSyncWindowDays: normalizeSyncWindowDays(
      patch.healthConnectSyncWindowDays ?? existing?.healthConnectSyncWindowDays
    ),
    healthSourceCategories: normalizeHealthConnectCategories(
      patch.healthSourceCategories ?? existing?.healthSourceCategories
    ),
    healthConnectDisclosureAcknowledged:
      patch.healthConnectDisclosureAcknowledged ??
      existing?.healthConnectDisclosureAcknowledged ??
      false
  };
  const { token: _token, deviceId: _deviceId, ...stored } = updated;
  await AsyncStorage.setItem(CONNECTION_KEY, JSON.stringify(stored));
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
  return updated;
}

export function updateLastSyncAt(url: string): Promise<void> {
  return withConnectionLock(async () => {
    const existing = await loadConnection();
    if (!existing || existing.url !== url) return;
    await writeConnection({ ...existing, lastSyncAt: new Date().toISOString() });
  });
}

export function updateHealthSourceCursors(url: string, cursors: HealthSourceCursors): Promise<void> {
  return withConnectionLock(async () => {
    const existing = await loadConnection();
    if (!existing || existing.url !== url) return;
    await writeConnection({
      ...existing,
      healthSourceCursors: cursors,
      healthSourceSessionKey: null,
      lastSyncAt: new Date().toISOString()
    });
  });
}

export function updateHealthSourceSessionKey(url: string, sessionKey: string | null): Promise<void> {
  return withConnectionLock(async () => {
    const existing = await loadConnection();
    if (!existing || existing.url !== url) return;
    await writeConnection({ ...existing, healthSourceSessionKey: sessionKey });
  });
}

/**
 * Earlier builds tracked a single cursor across every category, which meant enabling a new category
 * silently skipped its history. Fan the old value out so migrated installs keep their position.
 */
function migrateHealthSourceCursors(
  stored: StoredConnection,
  categories: HealthConnectCategory[]
): HealthSourceCursors {
  if (stored.healthSourceCursors && typeof stored.healthSourceCursors === "object") return stored.healthSourceCursors;
  const legacy = stored.healthConnectSyncCursor;
  if (!legacy) return {};
  return Object.fromEntries(categories.map((category) => [category, legacy])) as HealthSourceCursors;
}

export function clearConnection(): Promise<void> {
  return withConnectionLock(async () => {
    await Promise.all([
      AsyncStorage.removeItem(CONNECTION_KEY),
      AsyncStorage.removeItem(CORRUPT_CONNECTION_KEY),
      SecureStore.deleteItemAsync(TOKEN_KEY)
    ]);
  });
}

export async function loadPendingRevocation(): Promise<PendingRevocation | null> {
  const raw = await SecureStore.getItemAsync(PENDING_REVOCATION_KEY);
  if (!raw) return null;
  try {
    const pending = JSON.parse(raw) as Partial<PendingRevocation>;
    return typeof pending.url === "string" && typeof pending.token === "string"
      ? { url: pending.url, token: pending.token, publicKeyHash: pending.publicKeyHash ?? null }
      : null;
  } catch {
    return null;
  }
}

export async function savePendingRevocation(pending: PendingRevocation): Promise<void> {
  await SecureStore.setItemAsync(PENDING_REVOCATION_KEY, JSON.stringify(pending));
}

export async function clearPendingRevocation(): Promise<void> {
  await SecureStore.deleteItemAsync(PENDING_REVOCATION_KEY);
}

export async function loadSelectedProfileId(): Promise<string | null> {
  return AsyncStorage.getItem(SELECTED_PROFILE_ID_KEY);
}

export async function saveSelectedProfileId(profileId: string): Promise<void> {
  await AsyncStorage.setItem(SELECTED_PROFILE_ID_KEY, profileId);
}

export async function clearSelectedProfileId(): Promise<void> {
  await AsyncStorage.removeItem(SELECTED_PROFILE_ID_KEY);
}

function normalizeSyncWindowDays(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 30 || value > 365) {
    return DEFAULT_HEALTH_CONNECT_SYNC_WINDOW_DAYS;
  }
  return value;
}

function normalizeHealthConnectCategories(value: HealthConnectCategory[] | undefined): HealthConnectCategory[] {
  if (!value) return [];
  return HEALTH_CONNECT_CATEGORIES.filter((category) => value.includes(category));
}
