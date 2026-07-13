import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HealthStore } from "../store.js";
import { buildManualLabEntryImport } from "@local-fitness-advisor/shared";
import { initializeDuckDbRoot } from "../storage/duckdbRuntime.js";
import { createDuckDbHealthStoreFixture } from "./support/duckdbFixture.js";
import { DuckDbRepository } from "../storage/duckdbRepository.js";

let tempDir: string;
const httpfsExtensionPath = findPreparedExtension();

function makeImport(markers: Array<{ markerName: string; value: number; unit?: string }>, importedAt: string) {
  return buildManualLabEntryImport(
    {
      collectedAt: "2026-01-01T00:00:00.000Z",
      panelName: "Warehouse test panel",
      markers
    },
    importedAt
  );
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "lfa-warehouse-test-"));
  process.env.LFA_DATA_DIR = tempDir;
  process.env.LFA_SECRET = "test-secret-key-for-vitest-1234567";
  vi.resetModules();
});

afterEach(() => {
  delete process.env.LFA_DATA_DIR;
  delete process.env.LFA_SECRET;
  removeDirWithRetry(tempDir);
});

describe("warehouse rebuild", () => {
  it.skipIf(Boolean(process.env.CI))("builds from a temp database and leaves a recoverable backup on subsequent rebuilds", async () => {
    const warehousePath = join(tempDir, "health-warehouse.duckdb");
    const backupPath = `${warehousePath}.bak`;

    const store = new HealthStore();
    const firstImport = makeImport(
      [
        { markerName: "Weight", value: 82, unit: "kg" },
        { markerName: "Glucose", value: 91, unit: "mg/dL" }
      ],
      "2026-01-01T00:00:00.000Z"
    );
    const merged1 = store.mergeImport(firstImport);

    const { rebuildWarehouseFromStore, runWarehouseQuery } = await import("../warehouse.js");

    const firstResult = await rebuildWarehouseFromStore(merged1);
    expect(firstResult.engine, firstResult.warning).toBe("duckdb");

    expect(existsSync(warehousePath)).toBe(true);
    expect(existsSync(backupPath)).toBe(false);

    const rowsAfterFirst = await runWarehouseQuery("SELECT COUNT(*) AS c FROM observations");
    expect(Number(rowsAfterFirst[0]?.c ?? 0)).toBeGreaterThan(0);

    const secondImport = makeImport(
      [
        { markerName: "Weight", value: 80, unit: "kg" },
        { markerName: "HbA1c", value: 5.4, unit: "%" }
      ],
      "2026-01-02T00:00:00.000Z"
    );
    const merged2 = store.mergeImport(secondImport);

    const secondResult = await rebuildWarehouseFromStore(merged2);
    expect(secondResult.engine).toBe("duckdb");
    expect(existsSync(warehousePath)).toBe(true);
    expect(existsSync(backupPath)).toBe(true);

    const rowsAfterSecond = await runWarehouseQuery("SELECT COUNT(*) AS c FROM observations");
    expect(Number(rowsAfterSecond[0]?.c ?? 0)).toBeGreaterThanOrEqual(Number(rowsAfterFirst[0]?.c ?? 0));
  });

  it.skipIf(!httpfsExtensionPath)("matches encrypted repository daily and weekly analytical outputs", async () => {
    const fixture = createDuckDbHealthStoreFixture();
    const { rebuildWarehouseFromStore, runWarehouseQuery } = await import("../warehouse.js");
    expect((await rebuildWarehouseFromStore(fixture)).engine).toBe("duckdb");

    const pocRoot = initializeDuckDbRoot(join(tempDir, "duckdb-poc"));
    const repository = await DuckDbRepository.hydrate(
      pocRoot,
      join(pocRoot, "databases", "parity.duckdb-poc"),
      Buffer.alloc(32, 12).toString("base64"),
      fixture,
      { httpfsExtensionPath }
    );
    try {
      const warehouseDaily = await runWarehouseQuery(`SELECT CAST(day AS VARCHAR) AS day,
        measurement_code AS "measurementCode", avg_value AS "avgValue", min_value AS "minValue",
        max_value AS "maxValue", n AS count, unit FROM v_daily_metrics ORDER BY day, measurement_code;`);
      const warehouseWeekly = await runWarehouseQuery(`SELECT CAST(week_start AS VARCHAR) AS "weekStart",
        measurement_code AS "measurementCode", avg_value AS "avgValue", min_value AS "minValue",
        max_value AS "maxValue", n AS count, unit FROM v_weekly_metrics ORDER BY week_start, measurement_code;`);
      expect(normalizeMetricRows(warehouseDaily)).toEqual(await repository.dailyMetrics());
      expect(normalizeMetricRows(warehouseWeekly)).toEqual(await repository.weeklyMetrics());
    } finally {
      await repository.close();
    }
  }, 30_000);
});

function normalizeMetricRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((row) => ({
    ...(row.day === undefined ? { weekStart: String(row.weekStart) } : { day: String(row.day) }),
    measurementCode: String(row.measurementCode),
    avgValue: Number(row.avgValue),
    minValue: Number(row.minValue),
    maxValue: Number(row.maxValue),
    count: Number(row.count),
    unit: String(row.unit)
  }));
}

function findPreparedExtension(): string | undefined {
  return [
    process.env.LFA_DUCKDB_HTTPFS_EXTENSION,
    resolve(process.cwd(), "apps", "desktop", "build", "duckdb-extensions", "httpfs.duckdb_extension"),
    resolve(process.cwd(), "..", "desktop", "build", "duckdb-extensions", "httpfs.duckdb_extension")
  ].find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
}

function removeDirWithRetry(path: string): void {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch {
      // Best effort test cleanup; if the file lock persists, next attempt can still succeed.
    }
  }
}
