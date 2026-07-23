import { afterEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  values: new Map<string, string>(),
  getItem: vi.fn(async (key: string) => storage.values.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { storage.values.set(key, value); })
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: storage.getItem,
    setItem: storage.setItem
  }
}));

import {
  loadOperatingMode,
  resolveOperatingMode,
  saveOperatingMode,
  shouldCreateStandaloneSource
} from "./operatingModeStore";

afterEach(() => {
  storage.values.clear();
  vi.clearAllMocks();
});

describe("companion operating mode storage", () => {
  it("persists valid operating modes and ignores invalid values", async () => {
    await expect(loadOperatingMode()).resolves.toBeNull();
    await saveOperatingMode("standalone");
    await expect(loadOperatingMode()).resolves.toBe("standalone");
    await saveOperatingMode("connected");
    await expect(loadOperatingMode()).resolves.toBe("connected");

    storage.values.set("vitana.operatingMode", "unexpected");
    await expect(loadOperatingMode()).resolves.toBeNull();
  });

  it("preserves connected mode for paired upgrades and defaults unpaired installs to standalone", () => {
    expect(resolveOperatingMode(null, true)).toBe("connected");
    expect(resolveOperatingMode(null, false)).toBe("standalone");
    expect(resolveOperatingMode("standalone", true)).toBe("standalone");
    expect(resolveOperatingMode("connected", false)).toBe("connected");
  });

  it("recreates the standalone source after leaving Demo mode", () => {
    expect(shouldCreateStandaloneSource(true, "standalone", false)).toBe(true);
    expect(shouldCreateStandaloneSource(true, "standalone", true)).toBe(false);
    expect(shouldCreateStandaloneSource(true, "standalone", false)).toBe(true);
  });
});