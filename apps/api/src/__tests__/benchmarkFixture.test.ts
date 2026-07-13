import { describe, expect, it } from "vitest";
import { healthStoreDataSchema } from "@local-fitness-advisor/shared";
import { createBenchmarkFixture, createEmptyBenchmarkFixture } from "../poc/benchmarkFixture.js";
import { digestHealthStoreData } from "../storage/duckdbPocRepository.js";

describe("DuckDB PoC benchmark fixture", () => {
  it("is deterministic, schema-valid, multi-domain, and seed-sensitive", () => {
    const first = createBenchmarkFixture({ observationCount: 1_000, seed: 45 });
    const repeated = createBenchmarkFixture({ observationCount: 1_000, seed: 45 });
    const differentSeed = createBenchmarkFixture({ observationCount: 1_000, seed: 46 });

    expect(healthStoreDataSchema.parse(first)).toEqual(first);
    expect(digestHealthStoreData(repeated)).toBe(digestHealthStoreData(first));
    expect(digestHealthStoreData(differentSeed)).not.toBe(digestHealthStoreData(first));
    expect(first.observations).toHaveLength(1_000);
    expect(new Set(first.observations.map((entry) => entry.measurementCode)).size).toBeGreaterThan(4);
    expect(first.timeSeriesSamples.length).toBeGreaterThan(0);
    expect(first.activitySessions.length).toBeGreaterThan(0);
    expect(first.observationGroups.length).toBeGreaterThan(0);
    expect(first.sourceImports.length).toBeGreaterThan(0);
    expect(first.insights.length).toBeGreaterThan(0);
    expect(first.auditEvents.length).toBeGreaterThan(0);
    expect(createEmptyBenchmarkFixture(45).observations).toEqual([]);
    expect(createBenchmarkFixture({ observationCount: 1_000, seed: 45, importCount: 1 }).sourceImports).toHaveLength(1);
  });

  it("rejects unsupported fixture sizes and non-integer seeds", () => {
    expect(() => createBenchmarkFixture({ observationCount: 0, seed: 45 })).toThrow("observationCount");
    expect(() => createBenchmarkFixture({ observationCount: 1_000_001, seed: 45 })).toThrow("observationCount");
    expect(() => createBenchmarkFixture({ observationCount: 10, seed: 4.5 })).toThrow("seed");
    expect(() => createBenchmarkFixture({ observationCount: 10, seed: 45, importCount: 0 })).toThrow("importCount");
  });
});