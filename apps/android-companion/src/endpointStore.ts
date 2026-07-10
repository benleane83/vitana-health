import AsyncStorage from "@react-native-async-storage/async-storage";

const CONNECTION_KEY = "local-fitness-advisor.connection";
const DEVICE_ID_KEY = "local-fitness-advisor.deviceId";
const PROFILE_ID_KEY = "local-fitness-advisor.profileId";

export interface ConnectionDetails {
  url: string;
  deviceId: string;
  token: string | null;
  name: string | null;
  pairedAt: string | null;
  lastSyncAt: string | null;
}

function generateDeviceId(): string {
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

export async function getDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = generateDeviceId();
  await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

export async function loadConnection(): Promise<ConnectionDetails | null> {
  const raw = await AsyncStorage.getItem(CONNECTION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ConnectionDetails;
  } catch {
    return null;
  }
}

export async function saveConnection(patch: Partial<ConnectionDetails> & { url: string }): Promise<ConnectionDetails> {
  const existing = await loadConnection();
  const deviceId = await getDeviceId();
  const updated: ConnectionDetails = {
    url: patch.url,
    deviceId,
    token: patch.token !== undefined ? patch.token : (existing?.token ?? null),
    name: patch.name !== undefined ? patch.name : (existing?.name ?? null),
    pairedAt: patch.pairedAt !== undefined ? patch.pairedAt : (existing?.pairedAt ?? null),
    lastSyncAt: patch.lastSyncAt !== undefined ? patch.lastSyncAt : (existing?.lastSyncAt ?? null)
  };
  await AsyncStorage.setItem(CONNECTION_KEY, JSON.stringify(updated));
  return updated;
}

export async function updateLastSyncAt(url: string): Promise<void> {
  const existing = await loadConnection();
  if (!existing || existing.url !== url) return;
  await AsyncStorage.setItem(CONNECTION_KEY, JSON.stringify({ ...existing, lastSyncAt: new Date().toISOString() }));
}

export async function clearConnection(): Promise<void> {
  await AsyncStorage.removeItem(CONNECTION_KEY);
}

export async function loadSelectedProfileId(): Promise<string | null> {
  return AsyncStorage.getItem(PROFILE_ID_KEY);
}

export async function saveSelectedProfileId(profileId: string): Promise<void> {
  await AsyncStorage.setItem(PROFILE_ID_KEY, profileId);
}

export async function clearSelectedProfileId(): Promise<void> {
  await AsyncStorage.removeItem(PROFILE_ID_KEY);
}
