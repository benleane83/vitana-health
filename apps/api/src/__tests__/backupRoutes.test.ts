import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { makeBackupRoutes, isInMaintenanceMode } from "../routes/backupRoutes.js";
import {
  BACKUP_DECRYPTION_ERROR,
  EXPORT_FORMAT_VERSION,
  VITANA_BACKUP_MAGIC,
  defaultMeasurementTypes,
  type HealthStoreData,
  type BackupPayload
} from "@vitana/shared";
import { encryptBackup, buildBackupProfileEntry } from "../backupCrypto.js";
import type { ProfileStoreManager } from "../storage/profileStoreManager.js";
import type { PairingStore } from "../pairing.js";

function createTestStoreData(profileId = "test-user", displayName = "Test User"): HealthStoreData {
  return {
    schemaVersion: EXPORT_FORMAT_VERSION,
    profile: { id: profileId, displayName, subjectKind: "adult", units: "metric", updatedAt: "2024-01-01T00:00:00.000Z" },
    sourceImports: [],
    dataSources: [],
    devices: [],
    measurementTypes: defaultMeasurementTypes,
    personalReferenceRanges: [],
    pinnedMeasurements: [],
    observations: [
      { id: "obs-1", measurementCode: "body-weight", observedAt: "2024-01-15T10:00:00.000Z", value: 75.5, unit: "kg", sourceId: "src-1" }
    ],
    observationGroups: [],
    timeSeriesSamples: [],
    measurementAggregates: [],
    activitySessions: [],
    healthEvents: [],
    careItems: [],
    insights: [],
    auditEvents: []
  };
}

function createMockStoreManager(): ProfileStoreManager {
  const testData = createTestStoreData();
  const mockStore = {
    profileId: "test-user",
    exportData: vi.fn().mockResolvedValue(testData),
    getProfile: vi.fn().mockResolvedValue(testData.profile),
    replaceProfile: vi.fn().mockResolvedValue(testData.profile),
    mergeImport: vi.fn().mockResolvedValue({ counts: {}, outcome: {} })
  };

  return {
    listProfiles: vi.fn().mockReturnValue([{ id: "test-user", displayName: "Test User", updatedAt: "2024-01-01T00:00:00.000Z" }]),
    getActiveProfileId: vi.fn().mockReturnValue("test-user"),
    getStore: vi.fn().mockReturnValue(mockStore),
    getActiveStore: vi.fn().mockReturnValue(mockStore),
    createProfile: vi.fn().mockResolvedValue({ id: "test-user-copy", displayName: "Test User (restored)", updatedAt: "2024-01-01T00:00:00.000Z" }),
    restoreProfiles: vi.fn().mockImplementation(async (requests, journal) => {
      journal.complete();
      return requests.map((request: { sourceProfileId: string; decision: "replace" | "create-copy" }) => ({
        profileId: request.sourceProfileId,
        decision: request.decision,
        ...(request.decision === "create-copy" ? { newProfileId: "test-user-copy" } : {}),
        success: true
      }));
    })
  } as unknown as ProfileStoreManager;
}

function createMockPairingStore(): PairingStore {
  return {} as unknown as PairingStore;
}

function createTestApp(storeManager?: ProfileStoreManager) {
  const app = express();
  const sm = storeManager ?? createMockStoreManager();
  const ps = createMockPairingStore();

  // Simulate auth middleware setting owner principal
  app.use((req, res, next) => {
    res.locals.principal = { kind: "owner" };
    next();
  });

  app.use("/api/backups", makeBackupRoutes(sm, ps));
  return { app, storeManager: sm };
}

// We use node:http directly for binary tests since supertest may not be available
import { createServer, type Server } from "node:http";

function listen(app: express.Application): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

async function httpRequest(port: number, path: string, options: {
  method?: string;
  headers?: Record<string, string>;
  body?: Buffer | string;
}): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const http = require("node:http") as typeof import("node:http");
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path,
      method: options.method ?? "POST",
      headers: {
        ...options.headers,
        ...(options.body ? { "content-length": String(Buffer.byteLength(options.body)) } : {})
      }
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (typeof v === "string") headers[k] = v;
        }
        resolve({ status: res.statusCode ?? 500, headers, body });
      });
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

describe("backupRoutes", () => {
  describe("POST /api/backups/create", () => {
    it("creates an encrypted backup binary", async () => {
      const { app } = createTestApp();
      const { server, port } = await listen(app);

      try {
        const res = await httpRequest(port, "/api/backups/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ passphrase: "my-strong-passphrase", scope: "all" })
        });

        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toBe("application/octet-stream");
        expect(res.headers["content-disposition"]).toContain(".vitana-backup");
        // Verify magic bytes
        expect([...res.body.subarray(0, 4)]).toEqual([...VITANA_BACKUP_MAGIC]);
        expect(res.body[4]).toBe(1);
      } finally {
        server.close();
      }
    }, 30_000);

    it("includes a sanitized active profile name in active-scope backup filenames", async () => {
      const storeManager = createMockStoreManager();
      vi.mocked(storeManager.listProfiles).mockReturnValue([
        { id: "test-user", displayName: "Test User: Health / 2026", updatedAt: "2024-01-01T00:00:00.000Z" }
      ]);
      const { app } = createTestApp(storeManager);
      const { server, port } = await listen(app);

      try {
        const res = await httpRequest(port, "/api/backups/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ passphrase: "my-strong-passphrase", scope: "active" })
        });

        expect(res.status).toBe(200);
        expect(res.headers["content-disposition"]).toMatch(/filename="vitana-backup-test-user-health-2026-.*\.vitana-backup"/);
      } finally {
        server.close();
      }
    }, 30_000);

    it("rejects short passphrases", async () => {
      const { app } = createTestApp();
      const { server, port } = await listen(app);

      try {
        const res = await httpRequest(port, "/api/backups/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ passphrase: "short", scope: "all" })
        });

        expect(res.status).toBe(400);
        const body = JSON.parse(res.body.toString());
        expect(body.code).toBe("VALIDATION_ERROR");
      } finally {
        server.close();
      }
    });
  });

  describe("POST /api/backups/inspect", () => {
    it("inspects a valid backup", async () => {
      const { app } = createTestApp();
      const { server, port } = await listen(app);

      const testData = createTestStoreData();
      const payload: BackupPayload = {
        formatVersion: 1,
        createdAt: "2024-06-01T00:00:00.000Z",
        scope: "all",
        profiles: [buildBackupProfileEntry(testData)]
      };
      const encrypted = await encryptBackup(payload, "inspect-passphrase!");

      try {
        const res = await httpRequest(port, "/api/backups/inspect", {
          method: "POST",
          headers: {
            "content-type": "application/octet-stream",
            "x-backup-passphrase": "inspect-passphrase!"
          },
          body: encrypted
        });

        expect(res.status).toBe(200);
        const body = JSON.parse(res.body.toString());
        expect(body.formatVersion).toBe(1);
        expect(body.profiles).toHaveLength(1);
        expect(body.profiles[0].profileId).toBe("test-user");
        expect(body.profiles[0].digestValid).toBe(true);
        expect(body.profiles[0].existsLocally).toBe(true);
        expect(body.profiles[0].observationCount).toBe(1);
      } finally {
        server.close();
      }
    }, 30_000);

    it("rejects wrong passphrase on inspect", async () => {
      const { app } = createTestApp();
      const { server, port } = await listen(app);

      const testData = createTestStoreData();
      const payload: BackupPayload = {
        formatVersion: 1,
        createdAt: "2024-06-01T00:00:00.000Z",
        scope: "all",
        profiles: [buildBackupProfileEntry(testData)]
      };
      const encrypted = await encryptBackup(payload, "correct-passphrase!");

      try {
        const res = await httpRequest(port, "/api/backups/inspect", {
          method: "POST",
          headers: {
            "content-type": "application/octet-stream",
            "x-backup-passphrase": "wrong-passphrase!!"
          },
          body: encrypted
        });

        expect(res.status).toBe(400);
        const body = JSON.parse(res.body.toString());
        expect(body.error).toBe(BACKUP_DECRYPTION_ERROR);
        expect(body.code).toBe("DECRYPT_FAILED");
      } finally {
        server.close();
      }
    }, 30_000);
  });

  describe("POST /api/backups/restore", () => {
    it("restores a profile with create-copy decision", async () => {
      const sm = createMockStoreManager();
      const { app } = createTestApp(sm);
      const { server, port } = await listen(app);

      const testData = createTestStoreData();
      const payload: BackupPayload = {
        formatVersion: 1,
        createdAt: "2024-06-01T00:00:00.000Z",
        scope: "all",
        profiles: [buildBackupProfileEntry(testData)]
      };
      const encrypted = await encryptBackup(payload, "restore-passphrase!");

      const decisions = [
        { profileId: "test-user", decision: "create-copy" }
      ];

      try {
        const res = await httpRequest(port, "/api/backups/restore", {
          method: "POST",
          headers: {
            "content-type": "application/octet-stream",
            "x-backup-passphrase": "restore-passphrase!",
            "x-restore-decisions": JSON.stringify(decisions)
          },
          body: encrypted
        });

        expect(res.status).toBe(200);
        const body = JSON.parse(res.body.toString());
        expect(body.restored).toHaveLength(1);
        expect(body.restored[0].decision).toBe("create-copy");
        expect(body.restored[0].success).toBe(true);
        expect(body.restored[0].newProfileId).toBe("test-user-copy");
        expect(body.activeProfileId).toBe("test-user");
      } finally {
        server.close();
      }
    }, 30_000);

    it("requires acknowledgment for replace decision", async () => {
      const { app } = createTestApp();
      const { server, port } = await listen(app);

      const testData = createTestStoreData();
      const payload: BackupPayload = {
        formatVersion: 1,
        createdAt: "2024-06-01T00:00:00.000Z",
        scope: "all",
        profiles: [buildBackupProfileEntry(testData)]
      };
      const encrypted = await encryptBackup(payload, "restore-passphrase!");

      const decisions = [
        { profileId: "test-user", decision: "replace" }
      ];

      try {
        const res = await httpRequest(port, "/api/backups/restore", {
          method: "POST",
          headers: {
            "content-type": "application/octet-stream",
            "x-backup-passphrase": "restore-passphrase!",
            "x-restore-decisions": JSON.stringify(decisions)
          },
          body: encrypted
        });

        expect(res.status).toBe(400);
        const body = JSON.parse(res.body.toString());
        expect(body.code).toBe("VALIDATION_ERROR");
      } finally {
        server.close();
      }
    }, 30_000);

    it("accepts replace decision with acknowledgment", async () => {
      const sm = createMockStoreManager();
      const { app } = createTestApp(sm);
      const { server, port } = await listen(app);

      const testData = createTestStoreData();
      const payload: BackupPayload = {
        formatVersion: 1,
        createdAt: "2024-06-01T00:00:00.000Z",
        scope: "all",
        profiles: [buildBackupProfileEntry(testData)]
      };
      const encrypted = await encryptBackup(payload, "restore-passphrase!");

      const decisions = [
        { profileId: "test-user", decision: "replace", acknowledgeReplacement: "REPLACE_CONFIRMED" }
      ];

      try {
        const res = await httpRequest(port, "/api/backups/restore", {
          method: "POST",
          headers: {
            "content-type": "application/octet-stream",
            "x-backup-passphrase": "restore-passphrase!",
            "x-restore-decisions": JSON.stringify(decisions)
          },
          body: encrypted
        });

        expect(res.status).toBe(200);
        const body = JSON.parse(res.body.toString());
        expect(body.restored).toHaveLength(1);
        expect(body.restored[0].decision).toBe("replace");
        expect(body.restored[0].success).toBe(true);
      } finally {
        server.close();
      }
    }, 30_000);

    it("skips profiles with skip decision", async () => {
      const { app } = createTestApp();
      const { server, port } = await listen(app);

      const testData = createTestStoreData();
      const payload: BackupPayload = {
        formatVersion: 1,
        createdAt: "2024-06-01T00:00:00.000Z",
        scope: "all",
        profiles: [buildBackupProfileEntry(testData)]
      };
      const encrypted = await encryptBackup(payload, "restore-passphrase!");

      const decisions = [
        { profileId: "test-user", decision: "skip" }
      ];

      try {
        const res = await httpRequest(port, "/api/backups/restore", {
          method: "POST",
          headers: {
            "content-type": "application/octet-stream",
            "x-backup-passphrase": "restore-passphrase!",
            "x-restore-decisions": JSON.stringify(decisions)
          },
          body: encrypted
        });

        expect(res.status).toBe(200);
        const body = JSON.parse(res.body.toString());
        expect(body.restored).toHaveLength(1);
        expect(body.restored[0].decision).toBe("skip");
        expect(body.restored[0].success).toBe(true);
      } finally {
        server.close();
      }
    }, 30_000);

    it("rejects a concurrent restore without releasing the active restore lock", async () => {
      const sm = createMockStoreManager();
      let releaseFirst!: () => void;
      let firstStarted!: () => void;
      const started = new Promise<void>((resolve) => { firstStarted = resolve; });
      const blocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
      vi.mocked(sm.restoreProfiles).mockImplementationOnce(async (requests, journal) => {
        firstStarted();
        await blocked;
        journal.complete();
        return requests.map((request) => ({
          profileId: request.sourceProfileId,
          decision: request.decision,
          success: true as const
        }));
      });
      const { app } = createTestApp(sm);
      const { server, port } = await listen(app);
      const payload: BackupPayload = {
        formatVersion: 1,
        createdAt: "2024-06-01T00:00:00.000Z",
        scope: "all",
        profiles: [buildBackupProfileEntry(createTestStoreData())]
      };
      const encrypted = await encryptBackup(payload, "restore-passphrase!");
      const request = () => httpRequest(port, "/api/backups/restore", {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "x-backup-passphrase": "restore-passphrase!",
          "x-restore-decisions": JSON.stringify([{
            profileId: "test-user",
            decision: "replace",
            acknowledgeReplacement: "REPLACE_CONFIRMED"
          }])
        },
        body: encrypted
      });

      try {
        const first = request();
        await started;
        const second = await request();
        expect(second.status).toBe(409);
        expect(JSON.parse(second.body.toString()).code).toBe("RESTORE_IN_PROGRESS");
        expect(isInMaintenanceMode()).toBe(true);
        releaseFirst();
        expect((await first).status).toBe(200);
        expect(isInMaintenanceMode()).toBe(false);
      } finally {
        releaseFirst();
        server.close();
      }
    }, 30_000);
  });

  describe("maintenance mode", () => {
    it("starts as not in maintenance mode", () => {
      expect(isInMaintenanceMode()).toBe(false);
    });
  });
});
