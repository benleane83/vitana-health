import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HealthStore } from "../store.js";
import { buildManualLabEntryImport } from "@local-fitness-advisor/shared";

let tempDir: string;

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
  it("builds from a temp database and leaves a recoverable backup on subsequent rebuilds", async () => {
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
    expect(["duckdb", "fallback"]).toContain(firstResult.engine);
    if (firstResult.engine === "fallback") {
      expect(firstResult.warning).toBeDefined();
      return;
    }

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
});

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
