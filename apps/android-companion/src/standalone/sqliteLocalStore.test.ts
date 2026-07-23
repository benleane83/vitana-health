import { describe, expect, it, vi } from "vitest";
import type { Profile } from "@vitana/shared";

vi.mock("expo-crypto", () => ({ getRandomBytesAsync: vi.fn() }));
vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn()
}));
vi.mock("expo-sqlite", () => ({
  deleteDatabaseAsync: vi.fn(),
  openDatabaseAsync: vi.fn()
}));

import { LocalProfileRepository } from "./localRepository";
import { SqliteLocalStore } from "./sqliteLocalStore";

function profile(id: string, updatedAt: string): Profile {
  return {
    id,
    displayName: "My profile",
    subjectKind: "adult",
    units: "metric",
    updatedAt
  };
}

describe("SQLite local store profile selection", () => {
  it("reuses the persisted profile and its observations after repository recreation", async () => {
    const persistedProfile = profile("mobile-persisted", "2026-07-20T10:00:00.000Z");
    const runAsync = vi.fn();
    const getFirstAsync = vi.fn(async (sql: string, ...parameters: unknown[]) => {
      if (sql.startsWith("SELECT profiles.id")) return { id: persistedProfile.id };
      if (sql.startsWith("SELECT profile_json FROM profiles")) {
        return parameters[0] === persistedProfile.id
          ? { profile_json: JSON.stringify(persistedProfile) }
          : null;
      }
      if (sql.includes("SELECT COUNT(*) FROM observations")) {
        return parameters.every((value) => value === persistedProfile.id)
          ? { imports: 1, observations: 3 }
          : { imports: 0, observations: 0 };
      }
      return null;
    });
    const database = { getFirstAsync, runAsync };

    const reopened = new LocalProfileRepository(
      new SqliteLocalStore(database as never),
      profile("mobile-new-process-id", "2026-07-21T10:00:00.000Z")
    );

    expect(await reopened.bootstrap()).toMatchObject({
      profile: { id: persistedProfile.id },
      counts: { imports: 1, observations: 3 }
    });
    expect(runAsync).not.toHaveBeenCalled();
  });
});