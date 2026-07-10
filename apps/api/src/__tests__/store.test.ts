import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HealthStore } from "../store.js";
import { parseSamsungHealthCsv } from "@local-fitness-advisor/shared";

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

const samsungCsv = `date,type,value,unit
2026-01-01,heart_rate,72,bpm
2026-01-02,heart_rate,68,bpm
2026-01-03,weight,82,kg`;

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
    const parsed = parseSamsungHealthCsv("test.csv", samsungCsv, "2026-01-01T00:00:00.000Z");

    store.mergeImport(parsed);
    const afterFirst = store.snapshot();

    store.mergeImport(parsed);
    const afterSecond = store.snapshot();

    expect(afterSecond.observations.length).toBe(afterFirst.observations.length);
    expect(afterSecond.timeSeriesSamples.length).toBe(afterFirst.timeSeriesSamples.length);
  });

  it("importing the same file twice does not duplicate sourceImports", () => {
    const store = makeStore();
    const parsed = parseSamsungHealthCsv("test.csv", samsungCsv, "2026-01-01T00:00:00.000Z");

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
    const parsed = parseSamsungHealthCsv("test.csv", samsungCsv, "2026-01-01T00:00:00.000Z");
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
    const parsed = parseSamsungHealthCsv("test.csv", samsungCsv, "2026-01-01T00:00:00.000Z");
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
    const parsed = parseSamsungHealthCsv("test.csv", samsungCsv, "2026-01-01T00:00:00.000Z");
    store1.mergeImport(parsed);
    const countAfterWrite = store1.snapshot().observations.length;

    // Second instance: reads from the same file
    const store2 = makeStore();
    expect(store2.snapshot().observations.length).toBe(countAfterWrite);
  });

  it("keeps a recoverable backup and restores from it if the primary file is corrupted", () => {
    const store = makeStore();
    const parsed = parseSamsungHealthCsv("test.csv", samsungCsv, "2026-01-01T00:00:00.000Z");
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

    const dataPath = join(tempDir, "health-store.enc");
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
