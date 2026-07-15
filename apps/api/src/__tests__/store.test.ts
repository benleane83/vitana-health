import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { HealthStore, ProfileStoreManager } from "../store.js";
import { buildManualLabEntryImport } from "@local-fitness-advisor/shared";

let tempDir: string;

function makeStore(): HealthStore {
  return new HealthStore();
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "lfa-test-"));
  process.env.LFA_DATA_DIR = tempDir;
  process.env.LFA_SECRET = "test-secret-key-for-vitest-1234567";
});

afterEach(() => {
  delete process.env.LFA_DATA_DIR;
  delete process.env.LFA_SECRET;
  delete process.env.NODE_ENV;
  rmSync(tempDir, { recursive: true, force: true });
});

function makeManualImport(importedAt = "2026-01-01T00:00:00.000Z") {
  return buildManualLabEntryImport(
    {
      collectedAt: "2026-01-01T00:00:00.000Z",
      panelName: "Test panel",
      markers: [
        { markerName: "Weight", value: 82, unit: "kg" },
        { markerName: "Glucose", value: 90, unit: "mg/dL" }
      ]
    },
    importedAt
  );
}

function writeEncryptedFixture(path: string, data: unknown): void {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", scryptSync(process.env.LFA_SECRET!, salt, 32), iv);
  const payload = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
  writeFileSync(path, JSON.stringify({
    version: 1, salt: salt.toString("base64"), iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"), payload: payload.toString("base64")
  }));
}

describe("HealthStore — initialisation", () => {
  it("creates an empty store with default measurement types", () => {
    const store = makeStore();
    const snapshot = store.snapshot();
    expect(snapshot.observations).toHaveLength(0);
    expect(snapshot.measurementTypes.length).toBeGreaterThan(0);
    expect(snapshot.profile.id).toBe("self");
  });

  it("uses env-secret security mode when LFA_SECRET is set", () => {
    const store = makeStore();
    expect(store.securityMode).toBe("env-secret");
  });

  it("refreshes existing default measurement metadata from the registry", () => {
    const initial = makeStore().snapshot({ includeRaw: true });
    const dataPath = join(tempDir, "health-store-self.enc");
    writeEncryptedFixture(dataPath, {
      ...initial,
      measurementTypes: initial.measurementTypes.map((type) => type.code === "bmi"
        ? { ...type, normalLow: undefined, normalHigh: undefined, referenceRanges: undefined }
        : type)
    });

    const bmi = makeStore().snapshot().measurementTypes.find((type) => type.code === "bmi");
    expect(bmi).toMatchObject({
      normalLow: 18.5,
      normalHigh: 24.9,
      referenceRanges: [{ low: 18.5, high: 24.9, unit: "kg/m2" }]
    });
  });
});

describe("HealthStore — mergeImport deduplication", () => {
  it("importing the same data twice does not duplicate observations", () => {
    const store = makeStore();
    const parsed = makeManualImport();

    store.mergeImport(parsed);
    const afterFirst = store.snapshot();

    store.mergeImport(parsed);
    const afterSecond = store.snapshot();

    expect(afterSecond.observations.length).toBe(afterFirst.observations.length);
    expect(afterSecond.timeSeriesSamples.length).toBe(afterFirst.timeSeriesSamples.length);
  });

  it("importing the same file twice does not duplicate sourceImports", () => {
    const store = makeStore();
    const parsed = makeManualImport();

    store.mergeImport(parsed);
    store.mergeImport(parsed);

    expect(store.snapshot().sourceImports).toHaveLength(1);
  });

  it("deduplicates independently parsed grouped lab imports", () => {
    const store = makeStore();
    store.mergeImport(makeManualImport());
    store.mergeImport(makeManualImport());

    const snapshot = store.snapshot();
    expect(snapshot.observationGroups).toHaveLength(1);
    expect(snapshot.observations).toHaveLength(2);
    expect(snapshot.observations.every((item) => item.observationGroupId === snapshot.observationGroups[0].id)).toBe(true);
  });
});

describe("HealthStore — deleteObservation", () => {
  it("returns undefined for a non-existent observation ID", () => {
    const store = makeStore();
    const result = store.deleteObservation("obs_nonexistent_id");
    expect(result).toBeUndefined();
  });

  it("removes the observation and returns the deleted record", () => {
    const store = makeStore();
    const parsed = makeManualImport();
    store.mergeImport(parsed);

    const observations = store.snapshot().observations;
    expect(observations.length).toBeGreaterThan(0);
    const observationId = observations[0].id;

    const result = store.deleteObservation(observationId);
    expect(result).toBeDefined();
    expect(result!.deletedCount).toBe(1);
    expect(result!.deletedObservation?.id).toBe(observationId);
    expect(store.snapshot().observations.find((o) => o.id === observationId)).toBeUndefined();
    expect(store.snapshot().observationGroups).toHaveLength(1);
  });
});

describe("HealthStore — updateObservation", () => {
  it("updates editable fields and preserves source and group linkage", () => {
    const store = makeStore();
    store.mergeImport(makeManualImport());
    const before = store.snapshot().observations[0];

    const result = store.updateObservation(before.id, {
      measurementCode: "creatinine",
      observedAt: "2026-02-03T10:30:00.000Z",
      value: 61.4,
      unit: "µmol/L",
      note: "Corrected"
    });

    expect(result?.updatedObservation).toMatchObject({
      id: before.id,
      measurementCode: "creatinine",
      sourceId: before.sourceId,
      observationGroupId: before.observationGroupId
    });
    expect(result?.updatedObservation.sourceJson).toEqual(before.sourceJson);
    expect(store.updateObservation("missing-observation", {
      measurementCode: "creatinine", observedAt: "2026-02-03T10:30:00.000Z", value: 1, unit: "µmol/L"
    })).toBeUndefined();
  });
});

describe("HealthStore — deleteObservationsByMeasurementCode", () => {
  it("returns deletedCount 0 for a measurement code with no observations", () => {
    const store = makeStore();
    const result = store.deleteObservationsByMeasurementCode("heart_rate");
    expect(result.deletedCount).toBe(0);
    expect(result.measurementCode).toBe("heart_rate");
  });

  it("deletes all observations matching the measurement code", () => {
    const store = makeStore();
    const parsed = makeManualImport();
    store.mergeImport(parsed);

    const before = store.snapshot().observations.filter((o) => o.measurementCode === "weight").length;
    expect(before).toBeGreaterThan(0);

    const result = store.deleteObservationsByMeasurementCode("weight");
    expect(result.deletedCount).toBe(before);
    expect(store.snapshot().observations.filter((o) => o.measurementCode === "weight")).toHaveLength(0);
  });
});

describe("HealthStore — persistence", () => {
  it("survives a reload from disk (data is re-readable after persist)", () => {
    // First instance: create and write data
    const store1 = makeStore();
    const parsed = makeManualImport();
    store1.mergeImport(parsed);
    const countAfterWrite = store1.snapshot().observations.length;

    // Second instance: reads from the same file
    const store2 = makeStore();
    expect(store2.snapshot().observations.length).toBe(countAfterWrite);
  });

  it("keeps a recoverable backup and restores from it if the primary file is corrupted", () => {
    const store = makeStore();
    const parsed = makeManualImport();
    store.mergeImport(parsed);
    store.addInsight({
      id: "insight_test_1",
      createdAt: "2026-01-01T00:00:00.000Z",
      title: "test",
      body: "test",
      evidence: [],
      confidence: "medium",
      model: "deterministic",
      safetyNotice: "test"
    });

    const dataPath = join(tempDir, "health-store-self.enc");
    const backupPath = `${dataPath}.bak`;
    expect(existsSync(dataPath)).toBe(true);
    expect(existsSync(backupPath)).toBe(true);

    writeFileSync(dataPath, "{\"version\":1,\"salt\":\"broken\"", { encoding: "utf8" });

    const recovered = makeStore();
    expect(recovered.snapshot().observations.length).toBeGreaterThan(0);
    expect(recovered.snapshot().profile.id).toBe("self");
    expect(existsSync(dataPath)).toBe(true);
  });

  it("backs up and rewrites a validated v1 store through the legacy migration", () => {
    const initial = makeStore().snapshot({ includeRaw: true });
    const dataPath = join(tempDir, "health-store-self.enc");
    writeEncryptedFixture(dataPath, {
      ...initial,
      schemaVersion: 1,
      observationGroups: undefined,
      labPanels: [{ id: "panel-1", collectedAt: "2026-01-01T00:00:00.000Z", panelName: "Legacy", sourceId: "source-1" }],
      labMarkers: [{ id: "marker-1", panelId: "panel-1", measurementCode: "glucose", value: 90, unit: "mg/dL" }],
      sleepSessions: [],
      sleepStageIntervals: []
    });

    const migrated = makeStore().snapshot();
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.observationGroups).toEqual(expect.arrayContaining([expect.objectContaining({ id: "group_legacy_panel-1" })]));
    expect(migrated.observations).toEqual(expect.arrayContaining([expect.objectContaining({ id: "obs_legacy_marker-1" })]));
    expect(existsSync(`${dataPath}.bak`)).toBe(true);
  });
});

describe("ProfileStoreManager", () => {
  it("accepts an OS-secure key injected by the desktop host", () => {
    delete process.env.LFA_SECRET;
    process.env.NODE_ENV = "production";

    const manager = new ProfileStoreManager({
      security: {
        passphrase: "in-memory-os-secure-store-key-123456",
        securityMode: "os-secure-storage"
      }
    });

    expect(manager.securityMode).toBe("os-secure-storage");
    expect(existsSync(join(tempDir, "local.key"))).toBe(false);
  });

  it("refuses generated plaintext key fallback in production", () => {
    delete process.env.LFA_SECRET;
    process.env.NODE_ENV = "production";

    expect(() => new ProfileStoreManager()).toThrow(/Production health storage requires/);
    expect(existsSync(join(tempDir, "local.key"))).toBe(false);
  });

  it("fails closed without replacing unreadable primary and backup stores", () => {
    const dataPath = join(tempDir, "health-store-self.enc");
    const backupPath = `${dataPath}.bak`;
    const unreadablePrimary = "unreadable-primary";
    const unreadableBackup = "unreadable-backup";
    writeFileSync(dataPath, unreadablePrimary, "utf8");
    writeFileSync(backupPath, unreadableBackup, "utf8");

    expect(() => new ProfileStoreManager()).toThrow(/Unable to load encrypted health store/);
    expect(existsSync(dataPath)).toBe(true);
    expect(existsSync(backupPath)).toBe(true);
  });

  it("migrates a legacy single-store file into the self profile", async () => {
    const legacy = makeStore();
    legacy.addInsight({
      id: "legacy-test",
      createdAt: "2026-01-01T00:00:00.000Z",
      title: "legacy",
      body: "legacy",
      evidence: [],
      confidence: "medium",
      model: "deterministic",
      safetyNotice: "test"
    });

    copyFileSync(join(tempDir, "health-store-self.enc"), join(tempDir, "health-store.enc"));
    if (existsSync(join(tempDir, "health-store-self.enc"))) {
      rmSync(join(tempDir, "health-store-self.enc"), { force: true });
    }

    const manager = new ProfileStoreManager();
    expect(manager.getActiveProfileId()).toBe("self");
    expect(manager.listProfiles().map((entry) => entry.id)).toContain("self");
    expect((await manager.getStore("self").readSnapshot()).insights).toHaveLength(1);
  });

  it("keeps profile stores isolated and tracks the active profile", async () => {
    const manager = new ProfileStoreManager();
    const created = await manager.createProfile("Shabnam Sarjami");
    expect(created.id).toBe("shabnam-sarjami");

    manager.setActiveProfile(created.id);
    const currentProfile = (await manager.getActiveStore().readSnapshot()).profile;
    await manager.getActiveStore().replaceProfile({
      ...currentProfile,
      id: created.id,
      displayName: "Shabnam"
    });
    manager.syncProfileEntry(await manager.getActiveStore().getProfile());

    expect(manager.getActiveProfileId()).toBe("shabnam-sarjami");
    expect(manager.listProfiles()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "shabnam-sarjami", displayName: "Shabnam" })])
    );
  }, 10_000);
});
