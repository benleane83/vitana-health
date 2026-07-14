import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  async: new Map<string, string>(),
  secure: new Map<string, string>(),
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  getSecureItem: vi.fn(),
  setSecureItem: vi.fn(),
  deleteSecureItem: vi.fn()
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: storage.getItem,
    setItem: storage.setItem,
    removeItem: storage.removeItem
  }
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: storage.getSecureItem,
  setItemAsync: storage.setSecureItem,
  deleteItemAsync: storage.deleteSecureItem
}));

import {
  clearConnection,
  loadConnection,
  saveConnection,
  updateHealthConnectSyncCursor
} from "./endpointStore";

const connectionKey = "local-fitness-advisor.connection";
const deviceIdKey = "local-fitness-advisor.deviceId";
const tokenKey = "local-fitness-advisor.companionToken";

beforeEach(() => {
  storage.getItem.mockImplementation(async (key: string) => storage.async.get(key) ?? null);
  storage.setItem.mockImplementation(async (key: string, value: string) => { storage.async.set(key, value); });
  storage.removeItem.mockImplementation(async (key: string) => { storage.async.delete(key); });
  storage.getSecureItem.mockImplementation(async (key: string) => storage.secure.get(key) ?? null);
  storage.setSecureItem.mockImplementation(async (key: string, value: string) => { storage.secure.set(key, value); });
  storage.deleteSecureItem.mockImplementation(async (key: string) => { storage.secure.delete(key); });
});

afterEach(() => {
  storage.async.clear();
  storage.secure.clear();
  vi.clearAllMocks();
});

describe("connection storage", () => {
  it("migrates legacy connection records with safe sync defaults and separate secure credentials", async () => {
    storage.async.set(connectionKey, JSON.stringify({
      url: "https://desktop.test",
      publicKeyHash: "pin",
      name: "Desktop",
      pairedAt: "2026-01-01T00:00:00.000Z",
      lastSyncAt: null
    }));
    storage.secure.set(deviceIdKey, "device-1");
    storage.secure.set(tokenKey, "companion-token");

    await expect(loadConnection()).resolves.toMatchObject({
      url: "https://desktop.test",
      deviceId: "device-1",
      token: "companion-token",
      healthConnectSyncCursor: null,
      healthConnectSyncWindowDays: 30,
      healthConnectCategories: [],
      healthConnectDisclosureAcknowledged: false
    });
  });

  it("limits the initial sync window to 30–365 days", async () => {
    storage.secure.set(deviceIdKey, "device-1");

    await expect(saveConnection({ url: "https://desktop.test", healthConnectSyncWindowDays: 29 }))
      .resolves.toMatchObject({ healthConnectSyncWindowDays: 30 });
    await expect(saveConnection({ url: "https://desktop.test", healthConnectSyncWindowDays: 365 }))
      .resolves.toMatchObject({ healthConnectSyncWindowDays: 365 });
    await expect(saveConnection({ url: "https://desktop.test", healthConnectSyncWindowDays: 366 }))
      .resolves.toMatchObject({ healthConnectSyncWindowDays: 30 });
  });

  it("keeps tokens and device IDs out of AsyncStorage while advancing a cursor for the matching endpoint", async () => {
    storage.secure.set(deviceIdKey, "device-1");
    await saveConnection({
      url: "https://desktop.test",
      token: "companion-token",
      publicKeyHash: "pin",
      healthConnectSyncWindowDays: 30,
      healthConnectCategories: ["Steps"]
    });

    const persisted = storage.async.get(connectionKey)!;
    expect(persisted).not.toContain("companion-token");
    expect(persisted).not.toContain("device-1");
    expect(storage.secure.get(tokenKey)).toBe("companion-token");

    await updateHealthConnectSyncCursor("https://other.test", "2026-01-10T12:00:00.000Z");
    expect(JSON.parse(storage.async.get(connectionKey)!).healthConnectSyncCursor).toBeNull();

    await updateHealthConnectSyncCursor("https://desktop.test", "2026-01-10T12:00:00.000Z");
    expect(JSON.parse(storage.async.get(connectionKey)!).healthConnectSyncCursor).toBe("2026-01-10T12:00:00.000Z");
  });

  it("clears both the ordinary connection record and its secure companion token", async () => {
    storage.async.set(connectionKey, "{}");
    storage.secure.set(tokenKey, "companion-token");

    await clearConnection();

    expect(storage.async.has(connectionKey)).toBe(false);
    expect(storage.secure.has(tokenKey)).toBe(false);
  });
});