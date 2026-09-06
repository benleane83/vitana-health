import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@vitana/shared";
import * as SecureStore from "expo-secure-store";
import { deleteDatabaseAsync, openDatabaseAsync } from "expo-sqlite";
import { LOCAL_SCHEMA_VERSION } from "./localStore";

vi.mock("expo-crypto", () => ({ getRandomBytesAsync: vi.fn() }));
vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn()
}));
vi.mock("expo-sqlite", () => ({
  deleteDatabaseAsync: vi.fn(async () => undefined),
  openDatabaseAsync: vi.fn()
}));
vi.mock("expo-file-system", () => ({
  Directory: class {},
  File: class {},
  Paths: { document: "document" }
}));
vi.mock("./migrations", () => ({
  migrate: vi.fn(async () => ({ schemaVersion: LOCAL_SCHEMA_VERSION, readOnly: false, appliedVersions: [] })),
  readSchemaVersion: vi.fn(async () => LOCAL_SCHEMA_VERSION),
  replicaSchemaSql: "CREATE TABLE IF NOT EXISTS connected_replicas (replica_id TEXT PRIMARY KEY);",
  replicaResetSql: "DROP TABLE IF EXISTS connected_replicas;"
}));

import { LocalProfileRepository } from "./localRepository";
import { openSqliteLocalStore, resetSqliteLocalStorage, SqliteLocalStore } from "./sqliteLocalStore";

function profile(id: string, updatedAt: string): Profile {
  return {
    id,
    displayName: "My profile",
    setupStatus: "complete",
    subjectKind: "adult",
    units: "metric",
    updatedAt
  };
}

function storedProfile(profile: Profile) {
  return {
    id: profile.id,
    display_name: profile.displayName,
    setup_status: profile.setupStatus,
    subject_kind: profile.subjectKind ?? "adult",
    birth_date: profile.birthDate ?? null,
    sex: profile.sex ?? null,
    height_cm: profile.heightCm ?? null,
    blood_type: profile.bloodType ?? null,
    goal_summary: profile.goalSummary ?? null,
    cloud_ai_consent_json: profile.cloudAiConsent ? JSON.stringify(profile.cloudAiConsent) : null,
    pet_json: profile.pet ? JSON.stringify(profile.pet) : null,
    units: profile.units,
    updated_at: profile.updatedAt
  };
}

describe("SQLite local store profile selection", () => {
  it("preserves the required legacy profile JSON when creating a typed profile row", async () => {
    const newProfile = profile("profile-new", "2026-07-21T10:00:00.000Z");
    const runAsync = vi.fn(async (_sql: string, ..._parameters: unknown[]) => ({ changes: 1 }));
    const database = {
      getFirstAsync: vi.fn(async () => null),
      getAllAsync: vi.fn(async () => []),
      runAsync,
      withTransactionAsync: vi.fn(async (task: () => Promise<void>) => task())
    };
    const store = new SqliteLocalStore(database as never);

    await store.initialize(newProfile);

    const profileInsert = runAsync.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO profiles"));
    expect(profileInsert).toBeDefined();
    expect(profileInsert?.[0]).toContain("profile_json");
    expect(profileInsert?.slice(1)).toEqual([
      newProfile.id,
      JSON.stringify(newProfile),
      newProfile.displayName,
      newProfile.setupStatus,
      newProfile.subjectKind,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      newProfile.units,
      newProfile.updatedAt
    ]);
  });

  it("reuses the persisted profile and its observations after repository recreation", async () => {
    const persistedProfile = profile("mobile-persisted", "2026-07-20T10:00:00.000Z");
    const runAsync = vi.fn();
    const getFirstAsync = vi.fn(async (sql: string, ...parameters: unknown[]) => {
      if (sql.startsWith("SELECT profile_id FROM datasets")) return { profile_id: persistedProfile.id };
      if (sql.includes("FROM profiles WHERE id = ?")) {
        return parameters[0] === persistedProfile.id
          ? storedProfile(persistedProfile)
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

  it("reads one profile-scoped observation group with source metadata", async () => {
    const persistedProfile = profile("mobile-persisted", "2026-07-20T10:00:00.000Z");
    const database = {
      getFirstAsync: vi.fn(async (sql: string) => {
        if (sql.startsWith("SELECT profile_id FROM datasets")) return { profile_id: persistedProfile.id };
        if (sql.includes("FROM profiles WHERE id = ?")) {
          return storedProfile(persistedProfile);
        }
        if (sql.includes("FROM observation_groups og")) {
          return {
            id: "group-1",
            kind: "manual_panel",
            label: "Body",
            sourceId: "source-1",
            importId: "import-1",
            startAt: null,
            endAt: null,
            collectedAt: "2026-07-20T09:00:00.000Z",
            metadataJson: null,
            sourceKind: "manual-entry",
            sourceLabel: "Manual observations: Body",
            sourceImportId: "import-1",
            sourceCreatedAt: "2026-07-20T09:01:00.000Z",
            sourceImportRecordId: "import-1",
            importSourceKind: "manual-entry",
            importFileName: "manual-entry.json",
            importedAt: "2026-07-20T09:01:00.000Z",
            parserVersion: "manual-v1",
            checksum: "checksum",
            rowCount: 1,
            importStatus: "processed",
            diagnosticsJson: "[]"
          };
        }
        return null;
      }),
      getAllAsync: vi.fn(async () => [{
        id: "observation-1",
        measurementCode: "weight",
        observedAt: "2026-07-20T09:00:00.000Z",
        effectiveStart: null,
        effectiveEnd: null,
        value: 72.5,
        unit: "kg",
        sourceId: "source-1",
        observationGroupId: "group-1",
        deviceId: null,
        note: null,
        sourceJson: null
      }]),
      runAsync: vi.fn()
    };
    const repository = new LocalProfileRepository(
      new SqliteLocalStore(database as never),
      profile("new-profile", "2026-07-21T10:00:00.000Z")
    );

    await expect(repository.observationGroup("group-1")).resolves.toMatchObject({
      id: "group-1",
      source: {
        kind: "manual-entry",
        label: "Manual observations: Body",
        importFileName: "manual-entry.json"
      },
      observations: [expect.objectContaining({ id: "observation-1", displayName: "Weight" })]
    });
    expect(database.getFirstAsync).toHaveBeenCalledWith(
      expect.stringContaining("WHERE og.profile_id = ? AND og.id = ?"),
      persistedProfile.id,
      "group-1"
    );
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
        display_name: entry.displayName,
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
    const closeAsync = vi.fn(async () => undefined);
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

    // Two files, one lease: the durable database and the disposable replica cache are opened and
    // torn down together, so callers never see a half-open pair.
    expect(vi.mocked(openDatabaseAsync).mock.calls.map(([name]) => name))
      .toEqual(["standalone-health.db", "replica.db"]);
    await standaloneStore.close();
    await standaloneStore.close();
    expect(closeAsync).not.toHaveBeenCalled();

    await connectedStore.close();
    expect(closeAsync).toHaveBeenCalledTimes(2);
  });

  it("does not close a shared connection while another store is acquiring it", async () => {
    const closeAsync = vi.fn(async () => undefined);
    const database = {
      closeAsync,
      execAsync: vi.fn(),
      getFirstAsync: vi.fn(async (sql: string) =>
        sql === "PRAGMA cipher_version" ? { cipher_version: "4.6.1" } : null)
    };
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue("a".repeat(64));
    vi.mocked(openDatabaseAsync).mockResolvedValue(database as never);

    const activeStore = await openSqliteLocalStore();
    const acquiringStore = openSqliteLocalStore();
    await activeStore.close();

    expect(closeAsync).not.toHaveBeenCalled();
    await (await acquiringStore).close();
    expect(closeAsync).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent acquires and commits their leases only after both databases open", async () => {
    let resolveReplica!: (database: unknown) => void;
    const replicaOpen = new Promise((resolve) => { resolveReplica = resolve; });
    const durableClose = vi.fn(async () => undefined);
    const replicaClose = vi.fn(async () => undefined);
    const durable = {
      closeAsync: durableClose,
      execAsync: vi.fn(),
      getFirstAsync: vi.fn(async (sql: string) =>
        sql === "PRAGMA cipher_version" ? { cipher_version: "4.6.1" } : null)
    };
    const replica = {
      closeAsync: replicaClose,
      execAsync: vi.fn(),
      getFirstAsync: vi.fn(async () => ({ user_version: 1 }))
    };
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue("a".repeat(64));
    vi.mocked(openDatabaseAsync).mockImplementation(async (name) =>
      name === "replica.db" ? replicaOpen as never : durable as never);

    const firstAcquire = openSqliteLocalStore();
    const secondAcquire = openSqliteLocalStore();
    await vi.waitFor(() => expect(openDatabaseAsync).toHaveBeenCalledTimes(2));
    await expect(resetSqliteLocalStorage()).rejects.toThrow("Close active local data operations");
    expect(durableClose).not.toHaveBeenCalled();

    resolveReplica(replica);
    const [first, second] = await Promise.all([firstAcquire, secondAcquire]);
    expect(vi.mocked(openDatabaseAsync).mock.calls.map(([name]) => name))
      .toEqual(["standalone-health.db", "replica.db"]);
    await first.close();
    expect(durableClose).not.toHaveBeenCalled();
    await second.close();
    expect(durableClose).toHaveBeenCalledTimes(1);
    expect(replicaClose).toHaveBeenCalledTimes(1);
  });

  it("closes partial state after replica open failure and retries with fresh handles", async () => {
    const firstDurableClose = vi.fn(async () => undefined);
    const failedReplicaClose = vi.fn(async () => undefined);
    const secondDurableClose = vi.fn(async () => undefined);
    const successfulReplicaClose = vi.fn(async () => undefined);
    const durable = (closeAsync: () => Promise<void>) => ({
      closeAsync,
      execAsync: vi.fn(),
      getFirstAsync: vi.fn(async (sql: string) =>
        sql === "PRAGMA cipher_version" ? { cipher_version: "4.6.1" } : null)
    });
    const replica = (closeAsync: () => Promise<void>, fail: boolean) => ({
      closeAsync,
      execAsync: vi.fn(async (sql: string) => {
        if (fail && sql.includes("CREATE TABLE")) throw new Error("replica schema failed");
      }),
      getFirstAsync: vi.fn(async () => ({ user_version: 1 }))
    });
    const handles = [
      durable(firstDurableClose),
      replica(failedReplicaClose, true),
      durable(secondDurableClose),
      replica(successfulReplicaClose, false)
    ];
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue("a".repeat(64));
    vi.mocked(openDatabaseAsync).mockImplementation(async () => handles.shift() as never);

    await expect(openSqliteLocalStore()).rejects.toThrow("replica schema failed");
    expect(firstDurableClose).toHaveBeenCalledTimes(1);
    expect(failedReplicaClose).toHaveBeenCalledTimes(1);

    const retried = await openSqliteLocalStore();
    expect(openDatabaseAsync).toHaveBeenCalledTimes(4);
    await retried.close();
    expect(secondDurableClose).toHaveBeenCalledTimes(1);
    expect(successfulReplicaClose).toHaveBeenCalledTimes(1);
  });

  it("releases its lease when reset so the shared connection is actually torn down", async () => {
    const closeAsync = vi.fn(async () => undefined);
    const database = {
      closeAsync,
      execAsync: vi.fn(),
      getFirstAsync: vi.fn(async (sql: string) =>
        sql === "PRAGMA cipher_version" ? { cipher_version: "4.6.1" } : null)
    };
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue("a".repeat(64));
    vi.mocked(openDatabaseAsync).mockResolvedValue(database as never);

    const store = await openSqliteLocalStore();
    // Previously this closed the raw handle without touching the lease count, so the reset below
    // threw "Close active local data operations..." and the module kept caching a closed handle.
    await store.reset();

    expect(closeAsync).toHaveBeenCalledTimes(2);
    expect(deleteDatabaseAsync).toHaveBeenCalledWith("standalone-health.db");
    expect(deleteDatabaseAsync).toHaveBeenCalledWith("replica.db");
    expect(SecureStore.deleteItemAsync).toHaveBeenCalled();

    // A fresh store must open new connections rather than reuse the closed ones.
    vi.mocked(openDatabaseAsync).mockClear();
    const reopened = await openSqliteLocalStore();
    expect(openDatabaseAsync).toHaveBeenCalledTimes(2);
    await reopened.close();
  });

  it("refuses to reset while another store still holds a lease", async () => {
    const database = {
      closeAsync: vi.fn(async () => undefined),
      execAsync: vi.fn(),
      getFirstAsync: vi.fn(async (sql: string) =>
        sql === "PRAGMA cipher_version" ? { cipher_version: "4.6.1" } : null)
    };
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue("a".repeat(64));
    vi.mocked(openDatabaseAsync).mockResolvedValue(database as never);

    const first = await openSqliteLocalStore();
    const second = await openSqliteLocalStore();

    await expect(first.reset()).rejects.toThrow("Close active local data operations");

    await second.close();
  });
});