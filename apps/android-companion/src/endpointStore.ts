import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

const CONNECTION_KEY = "local-fitness-advisor.connection";
const DEVICE_ID_KEY = "local-fitness-advisor.deviceId";
const TOKEN_KEY = "local-fitness-advisor.companionToken";
const SELECTED_PROFILE_ID_KEY = "local-fitness-advisor.selectedProfileId";

export interface ConnectionDetails {
  url: string;
  deviceId: string;
  token: string | null;
  name: string | null;
  pairedAt: string | null;
  lastSyncAt: string | null;
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
    return { ...stored, deviceId, token };
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
    name: patch.name !== undefined ? patch.name : (existing?.name ?? null),
    pairedAt: patch.pairedAt !== undefined ? patch.pairedAt : (existing?.pairedAt ?? null),
    lastSyncAt: patch.lastSyncAt !== undefined ? patch.lastSyncAt : (existing?.lastSyncAt ?? null)
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
