import { afterEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  values: new Map<string, string>(),
  getItem: vi.fn(async (key: string) => storage.values.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { storage.values.set(key, value); }),
  removeItem: vi.fn(async (key: string) => { storage.values.delete(key); })
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: storage.getItem,
    setItem: storage.setItem,
    removeItem: storage.removeItem
  }
}));

import { loadDemoMode, saveDemoMode } from "./demoModeStore";

afterEach(() => {
  storage.values.clear();
  vi.clearAllMocks();
});

describe("demo mode storage", () => {
  it("persists and clears the preference independently", async () => {
    await expect(loadDemoMode()).resolves.toBe(false);
    await saveDemoMode(true);
    await expect(loadDemoMode()).resolves.toBe(true);
    await saveDemoMode(false);
    await expect(loadDemoMode()).resolves.toBe(false);
  });
});