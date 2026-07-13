import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { buildManualLabEntryImport } from "@local-fitness-advisor/shared";
import { createApp } from "../createApp.js";
import { PairingStore } from "../pairing.js";
import { withCopiedDataValidation } from "../poc/copiedDataValidation.js";
import { refreshAnalyticsStorage, runAnalyticsQuery } from "../storage/analyticsBackend.js";
import { ProfileStoreManager, rollbackDuckDbActivation } from "../store.js";

const httpfsExtensionPath = findPreparedExtension();
let tempDir: string;
let duckdbRoot: string;
let workRoots: string[];

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "lfa-duckdb-activation-test-"));
  duckdbRoot = join(tempDir, "duckdb-storage");
  workRoots = [];
  process.env.LFA_DATA_DIR = tempDir;
  process.env.LFA_SECRET = "activation-test-secret-123456789";
  process.env.LFA_OWNER_TOKEN = "activation-test-owner-token";
});

afterEach(() => {
  delete process.env.LFA_DATA_DIR;
  delete process.env.LFA_SECRET;
  delete process.env.LFA_OWNER_TOKEN;
  for (const workRoot of workRoots) {
    rmSync(workRoot, { recursive: true, force: true });
  }
  rmSync(tempDir, { recursive: true, force: true });
});

describe.skipIf(!httpfsExtensionPath)("ProfileStoreManager DuckDB activation", () => {
  it("rejects a modified extension before creating DuckDB storage", async () => {
    const modifiedExtensionPath = join(tempDir, "modified-httpfs.duckdb_extension");
    writeFileSync(modifiedExtensionPath, Buffer.concat([readFileSync(httpfsExtensionPath!), Buffer.from([0])]));
    const manager = new ProfileStoreManager();
    await expect(manager.activateDuckDb({
      httpfsExtensionPath: modifiedExtensionPath,
      root: duckdbRoot
    })).rejects.toThrow("SHA-256 verification");
    expect(existsSync(duckdbRoot)).toBe(false);
    await manager.closeAll();
  });

  it("rejects manifest paths outside direct storage children", async () => {
    const manager = new ProfileStoreManager();
    writeFileSync(join(tempDir, "storage-backend.json"), JSON.stringify({
      version: 1,
      backend: "duckdb",
      activatedAt: "2026-07-13T00:00:00.000Z",
      profiles: [{
        profileId: "self",
        sourceFile: "../health-store-self.enc",
        sourceSha256: "a".repeat(64),
        baselineDigest: "b".repeat(64),
        databaseFile: "health-store-self.duckdb"
      }]
    }));
    await expect(manager.activateDuckDb({
      httpfsExtensionPath: httpfsExtensionPath!,
      root: duckdbRoot
    })).rejects.toThrow("manifest is invalid");
    await manager.closeAll();
  });

  it("migrates side by side, reopens DuckDB, and explicitly rolls back to JSON", async () => {
    const manager = new ProfileStoreManager();
    await manager.getActiveStore().mergeImport(buildManualLabEntryImport({
      collectedAt: "2026-07-13T00:00:00.000Z",
      panelName: "Activation fixture",
      markers: [{ markerName: "Weight", value: 81, unit: "kg" }]
    }));
    const sourcePath = join(tempDir, "health-store-self.enc");
    const sourceHash = hashFile(sourcePath);

    await manager.activateDuckDb({ httpfsExtensionPath: httpfsExtensionPath!, root: duckdbRoot });
    expect(manager.getStorageBackend()).toBe("duckdb");
    expect(existsSync(join(tempDir, "storage-backend.json"))).toBe(true);
    expect(hashFile(sourcePath)).toBe(sourceHash);
    const analyticsStorage = await refreshAnalyticsStorage(manager, manager.getActiveStore().snapshot());
    expect(analyticsStorage).toMatchObject({
      databasePath: "encrypted-profile:self",
      engine: "duckdb"
    });
    expect(existsSync(join(tempDir, "health-warehouse.duckdb"))).toBe(false);
    const analyticalRows = await runAnalyticsQuery(
      manager,
      "SELECT measurement_code, n FROM v_daily_metrics ORDER BY measurement_code LIMIT 10"
    );
    expect(analyticalRows.map((row) => ({
      ...row,
      n: Number(row.n)
    }))).toEqual(expect.arrayContaining([
      expect.objectContaining({ measurement_code: "weight", n: 1 })
    ]));
    await manager.getActiveStore().addInsight({
      id: "post-activation-insight",
      createdAt: "2026-07-13T01:00:00.000Z",
      title: "Activated",
      body: "Stored only in DuckDB",
      evidence: [],
      confidence: "medium",
      model: "deterministic",
      safetyNotice: "Test"
    });
    expect(hashFile(sourcePath)).toBe(sourceHash);
    expect(() => manager.createProfile("Pilot profile")).toThrow(/temporarily unavailable/);
    await manager.closeAll();

    const reopened = new ProfileStoreManager();
    await reopened.activateDuckDb({ httpfsExtensionPath: httpfsExtensionPath!, root: duckdbRoot });
    try {
      expect(reopened.getStorageBackend()).toBe("duckdb");
      expect(reopened.getActiveStore().snapshot().insights[0]?.id).toBe("post-activation-insight");
      expect(hashFile(sourcePath)).toBe(sourceHash);
    } finally {
      await reopened.closeAll();
    }

    const archivedManifestPath = rollbackDuckDbActivation({
      security: { passphrase: process.env.LFA_SECRET!, securityMode: "env-secret" },
      discardDuckDbChanges: true
    });
    expect(existsSync(join(tempDir, "storage-backend.json"))).toBe(false);
    expect(existsSync(archivedManifestPath)).toBe(true);
    expect(hashFile(sourcePath)).toBe(sourceHash);
    const telemetry = readFileSync(join(tempDir, "storage-pilot.ndjson"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(telemetry.map((entry) => entry.code)).toEqual([
      "storage-duckdb-activated",
      "storage-duckdb-reopened",
      "storage-duckdb-rolled-back"
    ]);
    expect(telemetry.every((entry) => Object.keys(entry).sort().join(",") === "code,durationMs,profileCount,storageBackend,ts")).toBe(true);

    const rolledBack = new ProfileStoreManager();
    try {
      expect(rolledBack.getStorageBackend()).toBe("json");
      expect(rolledBack.getActiveStore().snapshot().insights).toHaveLength(0);
      expect(hashFile(sourcePath)).toBe(sourceHash);
    } finally {
      await rolledBack.closeAll();
    }
  }, 30_000);

  it("validates the application against copied generated profile data without changing the source", async () => {
    const sourceManager = new ProfileStoreManager();
    await sourceManager.getActiveStore().mergeImport(buildManualLabEntryImport({
      collectedAt: "2026-07-13T00:00:00.000Z",
      panelName: "Copied-data source",
      markers: [{ markerName: "Weight", value: 80, unit: "kg" }]
    }));
    await sourceManager.closeAll();
    const workRoot = `${tempDir}-copied-validation`;
    workRoots.push(workRoot);

    await withCopiedDataValidation({ sourceDir: tempDir, workRoot }, async ({ inputCopyDir, manifestPath }) => {
      process.env.LFA_DATA_DIR = inputCopyDir;
      const copiedManager = new ProfileStoreManager();
      try {
        await copiedManager.activateDuckDb({
          httpfsExtensionPath: httpfsExtensionPath!,
          root: join(inputCopyDir, "duckdb-storage")
        });
        const app = createApp(copiedManager, new PairingStore());
        const authorization = "Bearer activation-test-owner-token";
        const stored = await request(app).get("/api/store").set("authorization", authorization);
        expect(stored.status).toBe(200);
        expect(stored.body.observations).toEqual(expect.arrayContaining([
          expect.objectContaining({ measurementCode: "weight", value: 80 })
        ]));

        const imported = await request(app)
          .post("/api/import/observations/manual")
          .set("authorization", authorization)
          .send({
            observedAt: "2026-07-14",
            label: "Copied-data mutation",
            observations: [{ measurementName: "Body fat", value: 20, unit: "%" }]
          });
        expect(imported.status).toBe(201);
        expect(imported.body.store.observations).toEqual(expect.arrayContaining([
          expect.objectContaining({ measurementCode: "body_fat_pct", value: 20 })
        ]));
        expect(existsSync(manifestPath)).toBe(true);
      } finally {
        await copiedManager.closeAll();
        process.env.LFA_DATA_DIR = tempDir;
      }
    });
  }, 30_000);
});

function findPreparedExtension(): string | undefined {
  return [
    process.env.LFA_DUCKDB_HTTPFS_EXTENSION,
    resolve(process.cwd(), "apps", "desktop", "build", "duckdb-extensions", "httpfs.duckdb_extension"),
    resolve(process.cwd(), "..", "desktop", "build", "duckdb-extensions", "httpfs.duckdb_extension")
  ].find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}