import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildManualLabEntryImport } from "@local-fitness-advisor/shared";
import { refreshAnalyticsStorage, runAnalyticsQuery } from "../storage/analyticsBackend.js";
import { HealthStore, ProfileStoreManager } from "../store.js";

const httpfsExtensionPath = findPreparedExtension();
let tempDir: string;
let duckdbRoot: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "lfa-duckdb-activation-test-"));
  duckdbRoot = join(tempDir, "duckdb-storage");
  process.env.LFA_DATA_DIR = tempDir;
  process.env.LFA_SECRET = "activation-test-secret-123456789";
  process.env.LFA_OWNER_TOKEN = "activation-test-owner-token";
});

afterEach(() => {
  delete process.env.LFA_DATA_DIR;
  delete process.env.LFA_SECRET;
  delete process.env.LFA_OWNER_TOKEN;
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

  it("migrates side by side and reopens DuckDB without reading the JSON source", async () => {
    const manager = new ProfileStoreManager();
    await manager.getActiveStore().mergeImport(buildManualLabEntryImport({
      collectedAt: "2026-07-13T00:00:00.000Z",
      panelName: "Activation fixture",
      markers: [{ markerName: "Weight", value: 81, unit: "kg" }]
    }));
    const sourcePath = join(tempDir, "health-store-self.enc");
    const sourceHash = hashFile(sourcePath);
    writeFileSync(join(tempDir, "health-warehouse.duckdb"), "legacy plaintext warehouse");

    await manager.activateDuckDb({ httpfsExtensionPath: httpfsExtensionPath!, root: duckdbRoot });
    expect(manager.getStorageBackend()).toBe("duckdb");
    expect(existsSync(join(tempDir, "storage-backend.json"))).toBe(true);
    expect(hashFile(sourcePath)).toBe(sourceHash);
    const analyticsStorage = await refreshAnalyticsStorage(manager, await manager.getActiveStore().readSnapshot());
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
    await manager.closeAll();

    const jsonSnapshotSpy = vi.spyOn(HealthStore.prototype, "snapshot");
    const reopened = await ProfileStoreManager.open({
      storageBackend: "duckdb",
      duckdb: { httpfsExtensionPath: httpfsExtensionPath!, root: duckdbRoot }
    });
    try {
      expect(reopened.getStorageBackend()).toBe("duckdb");
      expect((await reopened.getActiveStore().readSnapshot()).insights[0]?.id).toBe("post-activation-insight");
      expect(hashFile(sourcePath)).toBe(sourceHash);
      expect(jsonSnapshotSpy).not.toHaveBeenCalled();
    } finally {
      jsonSnapshotSpy.mockRestore();
      await reopened.closeAll();
    }

    const telemetry = readFileSync(join(tempDir, "storage-pilot.ndjson"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(telemetry.map((entry) => entry.code)).toEqual([
      "storage-duckdb-activated",
      "storage-duckdb-reopened"
    ]);
    expect(telemetry.every((entry) => Object.keys(entry).sort().join(",") === "code,durationMs,profileCount,storageBackend,ts")).toBe(true);
  }, 30_000);

  it("creates, reopens, and deletes profiles while DuckDB is active", async () => {
    const manager = new ProfileStoreManager();
    await manager.activateDuckDb({ httpfsExtensionPath: httpfsExtensionPath!, root: duckdbRoot });

    const created = await manager.createProfile("Pilot profile");
    expect(created.id).toBe("pilot-profile");
    expect(existsSync(join(tempDir, "health-store-pilot-profile.enc"))).toBe(false);
    expect(existsSync(join(duckdbRoot, "databases", "health-store-pilot-profile.duckdb"))).toBe(true);
    await expect(refreshAnalyticsStorage(
      manager,
      await manager.getStore(created.id).readSnapshot(),
      created.id
    )).resolves.toMatchObject({ databasePath: "encrypted-profile:pilot-profile" });
    manager.setActiveProfile(created.id);
    await manager.getActiveStore().addInsight({
      id: "pilot-profile-insight",
      createdAt: "2026-07-13T02:00:00.000Z",
      title: "Profile mutation",
      body: "Stored in the new encrypted profile database",
      evidence: [],
      confidence: "medium",
      model: "deterministic",
      safetyNotice: "Test"
    });
    await manager.closeAll();

    const reopened = new ProfileStoreManager();
    await reopened.activateDuckDb({ httpfsExtensionPath: httpfsExtensionPath!, root: duckdbRoot });
    expect(reopened.listProfiles()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "pilot-profile", displayName: "Pilot profile" })
    ]));
    expect(reopened.getActiveProfileId()).toBe("pilot-profile");
    expect((await reopened.getActiveStore().readSnapshot()).insights[0]?.id).toBe("pilot-profile-insight");

    const deleted = await reopened.deleteProfile("pilot-profile");
    expect(deleted.activeProfileId).toBe("self");
    expect(existsSync(join(tempDir, "health-store-pilot-profile.enc"))).toBe(false);
    expect(existsSync(join(duckdbRoot, "databases", "health-store-pilot-profile.duckdb"))).toBe(false);
    await reopened.closeAll();

    const afterDelete = new ProfileStoreManager();
    await afterDelete.activateDuckDb({ httpfsExtensionPath: httpfsExtensionPath!, root: duckdbRoot });
    try {
      expect(afterDelete.listProfiles().map((profile) => profile.id)).toEqual(["self"]);
    } finally {
      await afterDelete.closeAll();
    }
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