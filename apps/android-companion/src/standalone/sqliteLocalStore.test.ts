import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@vitana/shared";
import * as SecureStore from "expo-secure-store";
import { openDatabaseAsync } from "expo-sqlite";

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
vi.mock("./migrations", () => ({ migrate: vi.fn() }));

import { LocalProfileRepository } from "./localRepository";
import { openSqliteLocalStore, SqliteLocalStore } from "./sqliteLocalStore";

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
      if (sql.startsWith("SELECT profile_id FROM datasets")) return { profile_id: persistedProfile.id };
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

  it("requires an explicit choice when multiple migrated datasets are unselected", async () => {
    const profiles = [
      profile("profile-a", "2026-07-20T10:00:00.000Z"),
      profile("profile-b", "2026-07-21T10:00:00.000Z")
    ];
    const runAsync = vi.fn().mockResolvedValue({ changes: 1 });
    const database = {
      getFirstAsync: vi.fn(async (sql: string, datasetId?: string) => {
        if (sql.startsWith("SELECT profile_id FROM datasets WHERE is_selected")) return null;
        if (sql.startsWith("SELECT profile_id FROM datasets WHERE dataset_id")) {
          return datasetId === "profile-b" ? { profile_id: "profile-b" } : null;
        }
        return null;
      }),
      getAllAsync: vi.fn(async () => profiles.map((entry) => ({
        dataset_id: entry.id,
        profile_id: entry.id,
        profile_json: JSON.stringify(entry),
        dataset_kind: "standalone",
        lifecycle_state: "active",
        is_selected: 0
      }))),
      runAsync,
      withTransactionAsync: vi.fn(async (task: () => Promise<void>) => task())
    };
    const store = new SqliteLocalStore(database as never);

    await expect(store.initialize(profile("new-profile", "2026-07-22T10:00:00.000Z")))
      .rejects.toThrow("Choose a local dataset");
    expect(await store.listDatasets()).toEqual([
      expect.objectContaining({ datasetId: "profile-a", displayName: "My profile", selected: false }),
      expect.objectContaining({ datasetId: "profile-b", displayName: "My profile", selected: false })
    ]);

    await store.selectDataset("profile-b");
    expect(runAsync).toHaveBeenCalledWith("UPDATE datasets SET is_selected = 1 WHERE dataset_id = ?", "profile-b");
  });
});

describe("SQLite local store connection ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shares one database connection until the final store lease closes", async () => {
    const closeAsync = vi.fn();
    const database = {
      closeAsync,
      execAsync: vi.fn(),
      getFirstAsync: vi.fn(async (sql: string) =>
        sql === "PRAGMA cipher_version" ? { cipher_version: "4.6.1" } : null)
    };
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue("a".repeat(64));
    vi.mocked(openDatabaseAsync).mockResolvedValue(database as never);

    const standaloneStore = await openSqliteLocalStore();
    const connectedStore = await openSqliteLocalStore();

    expect(openDatabaseAsync).toHaveBeenCalledTimes(1);
    await standaloneStore.close();
    await standaloneStore.close();
    expect(closeAsync).not.toHaveBeenCalled();

    await connectedStore.close();
    expect(closeAsync).toHaveBeenCalledTimes(1);
  });
});