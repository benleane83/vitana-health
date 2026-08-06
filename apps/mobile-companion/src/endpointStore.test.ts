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
const crypto = vi.hoisted(() => ({ getRandomBytesAsync: vi.fn() }));

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
vi.mock("expo-crypto", () => crypto);

import {
  clearConnection,
  loadConnection,
  saveConnection,
  updateHealthSourceCursors,
  updateHealthSourceSessionKey
} from "./endpointStore";

const connectionKey = "vitana.connection";
const deviceIdKey = "vitana.deviceId";
const tokenKey = "vitana.companionToken";

beforeEach(() => {
  crypto.getRandomBytesAsync.mockResolvedValue(Uint8Array.from({ length: 16 }, (_, index) => index));
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
      healthSourceCursors: {},
      healthSourceSessionKey: null,
      healthConnectSyncWindowDays: 30,
      healthSourceCategories: [],
      healthConnectDisclosureAcknowledged: false
    });
  });

  it("fans a legacy single cursor out across the categories it had already covered", async () => {
    storage.async.set(connectionKey, JSON.stringify({
      url: "https://desktop.test",
      healthConnectSyncCursor: "2026-01-10T12:00:00.000Z",
      healthConnectCategories: ["Steps", "Weight"]
    }));
    storage.secure.set(deviceIdKey, "device-1");

    await expect(loadConnection()).resolves.toMatchObject({
      healthSourceCategories: ["Steps", "Weight"],
      healthSourceCursors: { Steps: "2026-01-10T12:00:00.000Z", Weight: "2026-01-10T12:00:00.000Z" }
    });
  });

  it("generates first-run device identifiers from cryptographically secure random bytes", async () => {
    await saveConnection({ url: "https://desktop.test" });

    expect(crypto.getRandomBytesAsync).toHaveBeenCalledWith(16);
    expect(storage.secure.get(deviceIdKey)).toBe("000102030405060708090a0b0c0d0e0f");
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

  it("drops removed and unsupported categories from stored Health Connect selections", async () => {
    storage.async.set(connectionKey, JSON.stringify({
      url: "https://desktop.test",
      healthConnectCategories: ["Steps", "BloodGlucose", "LeanBodyMass", "FloorsClimbed", "SkinTemperature"]
    }));
    storage.secure.set(deviceIdKey, "device-1");

    await expect(loadConnection()).resolves.toMatchObject({
      healthSourceCategories: ["Steps"]
    });
  });

  it("keeps tokens and device IDs out of AsyncStorage while advancing cursors for the matching endpoint", async () => {
    storage.secure.set(deviceIdKey, "device-1");
    await saveConnection({
      url: "https://desktop.test",
      token: "companion-token",
      publicKeyHash: "pin",
      healthConnectSyncWindowDays: 30,
      healthSourceCategories: ["Steps"]
    });

    const persisted = storage.async.get(connectionKey)!;
    expect(persisted).not.toContain("companion-token");
    expect(persisted).not.toContain("device-1");
    expect(storage.secure.get(tokenKey)).toBe("companion-token");

    await updateHealthSourceCursors("https://other.test", { Steps: "2026-01-10T12:00:00.000Z" });
    expect(JSON.parse(storage.async.get(connectionKey)!).healthSourceCursors).toEqual({});

    await updateHealthSourceCursors("https://desktop.test", { Steps: "2026-01-10T12:00:00.000Z" });
    expect(JSON.parse(storage.async.get(connectionKey)!).healthSourceCursors).toEqual({ Steps: "2026-01-10T12:00:00.000Z" });
  });

  it("remembers an interrupted sync session and clears it once cursors advance", async () => {
    storage.secure.set(deviceIdKey, "device-1");
    await saveConnection({ url: "https://desktop.test", healthSourceCategories: ["Steps"] });

    await updateHealthSourceSessionKey("https://desktop.test", "device-1:2026-01-11T12:00:00.000Z");
    await expect(loadConnection()).resolves.toMatchObject({
      healthSourceSessionKey: "device-1:2026-01-11T12:00:00.000Z"
    });

    await updateHealthSourceCursors("https://desktop.test", { Steps: "2026-01-11T12:00:00.000Z" });
    await expect(loadConnection()).resolves.toMatchObject({ healthSourceSessionKey: null });
  });

  it("allows the local Health Connect cursors to be cleared without changing sync preferences", async () => {
    storage.secure.set(deviceIdKey, "device-1");
    await saveConnection({
      url: "https://desktop.test",
      token: "companion-token",
      publicKeyHash: "pin",
      healthSourceCursors: { Steps: "2026-01-10T12:00:00.000Z" },
      healthConnectSyncWindowDays: 90,
      healthSourceCategories: ["Steps", "HeartRate"],
      healthConnectDisclosureAcknowledged: true
    });

    await saveConnection({ url: "https://desktop.test", healthSourceCursors: {} });

    await expect(loadConnection()).resolves.toMatchObject({
      token: "companion-token",
      healthSourceCursors: {},
      healthConnectSyncWindowDays: 90,
      healthSourceCategories: ["Steps", "HeartRate"],
      healthConnectDisclosureAcknowledged: true
    });
  });

  it("clears both the ordinary connection record and its secure companion token", async () => {
    storage.async.set(connectionKey, "{}");
    storage.secure.set(tokenKey, "companion-token");

    await clearConnection();

    expect(storage.async.has(connectionKey)).toBe(false);
    expect(storage.secure.has(tokenKey)).toBe(false);
  });

  it("reports an unreadable record instead of pretending the phone was never paired", async () => {
    storage.secure.set(deviceIdKey, "device-1");
    storage.async.set(connectionKey, "{ this is not json");

    await expect(loadConnection()).rejects.toThrow(/could not be read/);
    // The original bytes survive, so a bad parse cannot quietly destroy the pairing.
    expect(storage.async.get("vitana.connection.corrupt")).toBe("{ this is not json");
    await expect(updateHealthSourceSessionKey("https://desktop.test", "session")).rejects.toThrow(/could not be read/);

    // Re-pairing still works and leaves a readable record behind.
    await saveConnection({ url: "https://desktop.test", token: "companion-token" });
    await expect(loadConnection()).resolves.toMatchObject({ url: "https://desktop.test", token: "companion-token" });
  });

  it("does not lose a cursor update that overlaps a category save", async () => {
    storage.secure.set(deviceIdKey, "device-1");
    await saveConnection({ url: "https://desktop.test", healthSourceCategories: ["Steps"] });

    await Promise.all([
      updateHealthSourceCursors("https://desktop.test", { Steps: "2026-01-12T12:00:00.000Z" }),
      saveConnection({ url: "https://desktop.test", healthSourceCategories: ["Steps", "HeartRate"] })
    ]);

    await expect(loadConnection()).resolves.toMatchObject({
      healthSourceCursors: { Steps: "2026-01-12T12:00:00.000Z" },
      healthSourceCategories: ["Steps", "HeartRate"]
    });
  });
});