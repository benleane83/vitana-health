import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
});

describe("ProfileStoreManager", () => {
  it("migrates a legacy single-store file into the self profile", () => {
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
    expect(manager.getStore("self").snapshot().insights).toHaveLength(1);
  });

  it("keeps profile stores isolated and tracks the active profile", () => {
    const manager = new ProfileStoreManager();
    const created = manager.createProfile("Shabnam Sarjami");
    expect(created.id).toBe("shabnam-sarjami");

    manager.setActiveProfile(created.id);
    manager.getActiveStore().replaceProfile({
      ...manager.getActiveStore().snapshot().profile,
      id: created.id,
      displayName: "Shabnam"
    });
    manager.syncProfileEntry(manager.getActiveStore().snapshot().profile);

    expect(manager.getActiveProfileId()).toBe("shabnam-sarjami");
    expect(manager.listProfiles()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "shabnam-sarjami", displayName: "Shabnam" })])
    );
  });
});
