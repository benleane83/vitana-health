import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

const CONNECTION_KEY = "local-fitness-advisor.connection";
const DEVICE_ID_KEY = "local-fitness-advisor.deviceId";
const TOKEN_KEY = "local-fitness-advisor.companionToken";
const SELECTED_PROFILE_ID_KEY = "local-fitness-advisor.selectedProfileId";

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
  healthConnectSyncCursor: string | null;
  healthConnectSyncWindowDays: number;
  healthConnectCategories: HealthConnectCategory[];
  healthConnectDisclosureAcknowledged: boolean;
}

interface StoredConnection extends Omit<ConnectionDetails, "token" | "deviceId"> {}

function generateDeviceId(): string {
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

export async function getDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = generateDeviceId();
  await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
  return id;
}

export async function loadConnection(): Promise<ConnectionDetails | null> {
  const raw = await AsyncStorage.getItem(CONNECTION_KEY);
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as StoredConnection;
    const [deviceId, token] = await Promise.all([getDeviceId(), SecureStore.getItemAsync(TOKEN_KEY)]);
    return {
      ...stored,
      deviceId,
      token,
      healthConnectSyncCursor: stored.healthConnectSyncCursor ?? null,
      healthConnectSyncWindowDays: normalizeSyncWindowDays(stored.healthConnectSyncWindowDays),
      healthConnectCategories: normalizeHealthConnectCategories(stored.healthConnectCategories),
      healthConnectDisclosureAcknowledged: stored.healthConnectDisclosureAcknowledged === true
    };
  } catch {
    return null;
  }
}

export async function saveConnection(patch: Partial<ConnectionDetails> & { url: string }): Promise<ConnectionDetails> {
  const existing = await loadConnection();
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
    healthConnectSyncCursor:
      patch.healthConnectSyncCursor !== undefined ? patch.healthConnectSyncCursor : (existing?.healthConnectSyncCursor ?? null),
    healthConnectSyncWindowDays: normalizeSyncWindowDays(
      patch.healthConnectSyncWindowDays ?? existing?.healthConnectSyncWindowDays
    ),
    healthConnectCategories: normalizeHealthConnectCategories(
      patch.healthConnectCategories ?? existing?.healthConnectCategories
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

export async function updateLastSyncAt(url: string): Promise<void> {
  const existing = await loadConnection();
  if (!existing || existing.url !== url) return;
  await saveConnection({ ...existing, lastSyncAt: new Date().toISOString() });
}

export async function updateHealthConnectSyncCursor(url: string, cursor: string): Promise<void> {
  const existing = await loadConnection();
  if (!existing || existing.url !== url) return;
  await saveConnection({ ...existing, healthConnectSyncCursor: cursor, lastSyncAt: new Date().toISOString() });
}

export async function clearConnection(): Promise<void> {
  await Promise.all([AsyncStorage.removeItem(CONNECTION_KEY), SecureStore.deleteItemAsync(TOKEN_KEY)]);
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
