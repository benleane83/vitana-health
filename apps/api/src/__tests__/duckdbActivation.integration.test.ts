import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildManualLabEntryImport } from "@vitana/shared";
import { describeAnalyticsStorage, runAnalyticsQuery } from "../storage/analyticsBackend.js";
import { ProfileStoreManager } from "../storage/profileStoreManager.js";
import { RestoreJournal } from "../storage/restoreJournal.js";
import { createDuckDbHealthStoreFixture } from "./support/duckdbFixture.js";
import { findPreparedExtension } from "./support/duckdbExtension.js";

const httpfsExtensionPath = findPreparedExtension();
let tempDir: string;
let duckdbRoot: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "vitana-duckdb-runtime-test-"));
  duckdbRoot = join(tempDir, "duckdb-storage");
  process.env.VITANA_DATA_DIR = tempDir;
  process.env.VITANA_SECRET = "activation-test-secret-123456789";
});

afterEach(() => {
  delete process.env.VITANA_DATA_DIR;
  delete process.env.VITANA_SECRET;
  rmSync(tempDir, { recursive: true, force: true });
});

describe.skipIf(!httpfsExtensionPath)("ProfileStoreManager DuckDB runtime", () => {
  it("rejects a modified extension before creating storage", async () => {
    const modifiedExtensionPath = join(tempDir, "modified-httpfs.duckdb_extension");
    writeFileSync(modifiedExtensionPath, Buffer.concat([readFileSync(httpfsExtensionPath!), Buffer.from([0])]));

    await expect(ProfileStoreManager.open({
      storageBackend: "duckdb",
      duckdb: { httpfsExtensionPath: modifiedExtensionPath, root: duckdbRoot }
    })).rejects.toThrow("SHA-256 verification");
    expect(existsSync(duckdbRoot)).toBe(false);
  });

  it("rejects invalid manifest paths", async () => {
    writeFileSync(join(tempDir, "storage-backend.json"), JSON.stringify({
      version: 1,
      backend: "duckdb",
      activatedAt: "2026-07-15T00:00:00.000Z",
      profiles: [{ profileId: "self", databaseFile: "../health-store-self.duckdb" }]
    }));

    await expect(ProfileStoreManager.open({
      storageBackend: "duckdb",
      duckdb: { httpfsExtensionPath: httpfsExtensionPath!, root: duckdbRoot }
    })).rejects.toThrow("manifest is invalid");
  });

  it("initializes DuckDB directly and ignores legacy JSON files", async () => {
    const legacyJsonPath = join(tempDir, "health-store-self.enc");
    writeFileSync(legacyJsonPath, "not-a-readable-json-store");

    const manager = await openManager();
    try {
      expect(manager.getStorageBackend()).toBe("duckdb");
      expect(manager.listProfiles().map((profile) => profile.id)).toEqual(["self"]);
      expect((await manager.getActiveStore().storageCounts()).observations).toBe(0);
      expect(readFileSync(legacyJsonPath, "utf8")).toBe("not-a-readable-json-store");
      expect(existsSync(join(duckdbRoot, "databases", "health-store-self.duckdb"))).toBe(true);
    } finally {
      await manager.closeAll();
    }
  }, 30_000);

  it("persists analytics and profile lifecycle entirely in DuckDB", async () => {
    const manager = await openManager();
    await manager.getActiveStore().mergeImport(buildManualLabEntryImport({
      collectedAt: "2026-07-15T00:00:00.000Z",
      panelName: "DuckDB fixture",
      markers: [{ markerName: "Weight", value: 81, unit: "kg" }]
    }));
    expect(describeAnalyticsStorage(await manager.getActiveStore().storageCounts())).toMatchObject({
      counts: { observations: 1 }
    });
    expect(await runAnalyticsQuery(manager, {
      dialect: "duckdb",
      sql: "SELECT measurement_code, n FROM v_daily_metrics WHERE measurement_code = ? ORDER BY measurement_code LIMIT 10",
      parameters: ["weight"],
      resolvedTimeRange: { start: "1970-01-01", end: "2100-01-01", label: "all time" },
      appliedLimit: 10
    })).toEqual(expect.arrayContaining([expect.objectContaining({ measurement_code: "weight" })]));

    const created = await manager.createProfile("Pilot profile");
    await manager.setActiveProfile(created.id);
    await manager.closeAll();

    const reopened = await openManager();
    expect(reopened.getActiveProfileId()).toBe("pilot-profile");
    expect(reopened.listProfiles()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "pilot-profile", displayName: "Pilot profile" })
    ]));
    expect((await reopened.deleteProfile("pilot-profile")).activeProfileId).toBe("self");
    await reopened.closeAll();

    const afterDelete = await openManager();
    try {
      expect(afterDelete.listProfiles().map((profile) => profile.id)).toEqual(["self"]);
    } finally {
      await afterDelete.closeAll();
    }
  }, 30_000);

  it("fails closed when a manifest-listed database is missing", async () => {
    const manager = await openManager();
    await manager.closeAll();
    rmSync(join(duckdbRoot, "databases", "health-store-self.duckdb"), { force: true });

    await expect(openManager()).rejects.toThrow("DuckDB database is missing for profile self");
  }, 30_000);

  it("restores every stored domain and replaces changed or deleted observations", async () => {
    const manager = await openManager();
    try {
      const fixture = createDuckDbHealthStoreFixture();
      await manager.restoreProfiles([{
        sourceProfileId: "self",
        decision: "replace",
        displayName: fixture.profile.displayName,
        data: fixture
      }], new RestoreJournal(tempDir, "fixture-seed"));

      await manager.getActiveStore().createHealthEvent({
        kind: "immunization",
        status: "completed",
        occurredAt: "2026-07-18T12:00:00.000Z"
      });
      await manager.getActiveStore().createCareItem({
        kind: "medication",
        title: "Take medication",
        dueStart: "2026-08-18T14:00:00.000Z",
        priority: "normal",
        status: "open"
      });
      const backupSnapshot = await manager.getActiveStore().exportData();
      expect(backupSnapshot.devices).not.toHaveLength(0);
      expect(backupSnapshot.personalReferenceRanges).not.toHaveLength(0);
      expect(backupSnapshot.healthEvents).not.toHaveLength(0);
      expect(backupSnapshot.careItems).not.toHaveLength(0);
      expect(backupSnapshot.insights).not.toHaveLength(0);
      expect(backupSnapshot.auditEvents).not.toHaveLength(0);

      await manager.getActiveStore().updateObservation("observation-z", {
        measurementCode: "weight",
        observedAt: "2026-07-20T10:00:00.000Z",
        value: 999,
        unit: "kg"
      });
      await manager.getActiveStore().deleteObservation("observation-a");

      await manager.restoreProfiles([{
        sourceProfileId: "self",
        decision: "replace",
        displayName: backupSnapshot.profile.displayName,
        data: backupSnapshot
      }], new RestoreJournal(tempDir, "round-trip"));

      const restoredSnapshot = await manager.getActiveStore().exportData();
      expect({
        ...restoredSnapshot,
        auditEvents: restoredSnapshot.auditEvents.filter((event) => event.eventType !== "export-created")
      }).toEqual({
        ...backupSnapshot,
        auditEvents: backupSnapshot.auditEvents.filter((event) => event.eventType !== "export-created")
      });
    } finally {
      await manager.closeAll();
    }
  }, 60_000);
});

function openManager(): Promise<ProfileStoreManager> {
  return ProfileStoreManager.open({
    storageBackend: "duckdb",
    duckdb: { httpfsExtensionPath: httpfsExtensionPath!, root: duckdbRoot }
  });
}
