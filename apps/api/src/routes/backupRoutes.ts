/**
 * Backup & Restore API routes.
 *
 * Owner-only POST endpoints for portable passphrase-protected profile backups.
 * - POST /api/backups/create        — Create encrypted .vitana-backup binary
 * - POST /api/backups/inspect       — Inspect backup contents (multipart upload)
 * - POST /api/backups/restore       — Restore profiles from backup (multipart upload)
 */
import express from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  BACKUP_DECRYPTION_ERROR,
  BACKUP_MAX_SIZE_BYTES,
  VITANA_BACKUP_FILE_EXTENSION,
  backupCreateRequestSchema,
  backupRestoreRequestSchema,
  type BackupInspectResponse,
  type BackupPayload,
  type BackupRestoreResponse
} from "@vitana/shared";
import type { ProfileStoreManager } from "../storage/profileStoreManager.js";
import type { PairingStore } from "../pairing.js";
import type { AuthorizationPrincipal } from "../createApp.js";
import {
  buildBackupProfileEntry,
  decryptBackup,
  encryptBackup,
  verifyProfileDigest
} from "../backupCrypto.js";
import { RestoreJournal } from "../storage/restoreJournal.js";

// Maintenance lock — during restore, all endpoints except /api/health return 503
let maintenanceMode = false;
export function isInMaintenanceMode(): boolean {
  return maintenanceMode;
}

function sanitizeFilenameSegment(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return normalized || "profile";
}

export function makeBackupRoutes(
  storeManager: ProfileStoreManager,
  pairingStore: PairingStore
): express.Router {
  const router = express.Router();

  // --- POST /create — Generate encrypted backup ---
  router.post("/create", express.json({ limit: "1mb" }), async (req, res) => {
    const principal = res.locals.principal as AuthorizationPrincipal | undefined;
    if (!principal || principal.kind !== "owner") {
      res.status(403).json({ error: "Owner access required.", code: "OWNER_REQUIRED" });
      return;
    }

    const parsed = backupCreateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid backup request.", code: "VALIDATION_ERROR" });
      return;
    }

    const { passphrase, scope } = parsed.data;
    const allProfiles = storeManager.listProfiles();
    const targetIds = scope === "active"
      ? [storeManager.getActiveProfileId()]
      : allProfiles.map(p => p.id);

    if (targetIds.length === 0) {
      res.status(400).json({ error: "No valid profiles to back up.", code: "NO_PROFILES" });
      return;
    }

    try {
      const profiles = await Promise.all(
        targetIds.map(async (id) => {
          const store = storeManager.getStore(id);
          const data = await store.exportData();
          return buildBackupProfileEntry(data);
        })
      );

      const payload: BackupPayload = {
        formatVersion: 1,
        createdAt: new Date().toISOString(),
        scope,
        profiles
      };

      const encrypted = await encryptBackup(payload, passphrase);

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const activeProfile = allProfiles.find((profile) => profile.id === targetIds[0]);
      const profileName = scope === "active" && activeProfile
        ? `-${sanitizeFilenameSegment(activeProfile.displayName)}`
        : "";
      const filename = `vitana-backup${profileName}-${timestamp}${VITANA_BACKUP_FILE_EXTENSION}`;

      res.setHeader("content-type", "application/octet-stream");
      res.setHeader("content-disposition", `attachment; filename="${filename}"`);
      res.setHeader("content-length", String(encrypted.length));
      res.status(200).end(encrypted);
    } catch (err) {
      res.status(500).json({ error: "Failed to create backup.", code: "BACKUP_CREATE_FAILED" });
    }
  });

  // --- POST /inspect — Decrypt and inspect backup without restoring ---
  router.post("/inspect", collectBinaryBody(BACKUP_MAX_SIZE_BYTES), async (req, res) => {
    const principal = res.locals.principal as AuthorizationPrincipal | undefined;
    if (!principal || principal.kind !== "owner") {
      res.status(403).json({ error: "Owner access required.", code: "OWNER_REQUIRED" });
      return;
    }

    const passphrase = req.headers["x-backup-passphrase"];
    if (typeof passphrase !== "string" || passphrase.length < 12) {
      res.status(400).json({ error: "x-backup-passphrase header required (min 12 chars).", code: "PASSPHRASE_REQUIRED" });
      return;
    }

    const body = (req as express.Request & { rawBody?: Buffer }).rawBody;
    if (!body || body.length === 0) {
      res.status(400).json({ error: "Backup file body required.", code: "BODY_REQUIRED" });
      return;
    }

    let payload: BackupPayload;
    try {
      payload = await decryptBackup(body, passphrase);
    } catch {
      res.status(400).json({ error: BACKUP_DECRYPTION_ERROR, code: "DECRYPT_FAILED" });
      return;
    }

    const localProfiles = storeManager.listProfiles();
    const response: BackupInspectResponse = {
      formatVersion: payload.formatVersion,
      createdAt: payload.createdAt,
      scope: payload.scope,
      profiles: payload.profiles.map(entry => ({
        profileId: entry.profileId,
        displayName: entry.displayName,
        digestValid: verifyProfileDigest(entry),
        observationCount: entry.data.observations?.length ?? 0,
        existsLocally: localProfiles.some(p => p.id === entry.profileId)
      }))
    };

    res.json(response);
  });

  // --- POST /restore — Restore profiles from backup ---
  router.post("/restore", collectBinaryBody(BACKUP_MAX_SIZE_BYTES), async (req, res) => {
    const principal = res.locals.principal as AuthorizationPrincipal | undefined;
    if (!principal || principal.kind !== "owner") {
      res.status(403).json({ error: "Owner access required.", code: "OWNER_REQUIRED" });
      return;
    }

    const passphrase = req.headers["x-backup-passphrase"];
    if (typeof passphrase !== "string" || passphrase.length < 12) {
      res.status(400).json({ error: "x-backup-passphrase header required (min 12 chars).", code: "PASSPHRASE_REQUIRED" });
      return;
    }

    const decisionsHeader = req.headers["x-restore-decisions"];
    if (typeof decisionsHeader !== "string") {
      res.status(400).json({ error: "x-restore-decisions header required (JSON).", code: "DECISIONS_REQUIRED" });
      return;
    }

    let decisionsBody: unknown;
    try {
      decisionsBody = JSON.parse(decisionsHeader);
    } catch {
      res.status(400).json({ error: "x-restore-decisions must be valid JSON.", code: "DECISIONS_INVALID" });
      return;
    }

    const parsedDecisions = backupRestoreRequestSchema.safeParse({
      passphrase,
      decisions: decisionsBody
    });
    if (!parsedDecisions.success) {
      const issues = parsedDecisions.error.issues.slice(0, 3).map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
      res.status(400).json({ error: `Invalid restore request: ${issues}`, code: "VALIDATION_ERROR" });
      return;
    }

    const body = (req as express.Request & { rawBody?: Buffer }).rawBody;
    if (!body || body.length === 0) {
      res.status(400).json({ error: "Backup file body required.", code: "BODY_REQUIRED" });
      return;
    }

    // Decrypt
    let payload: BackupPayload;
    try {
      payload = await decryptBackup(body, passphrase);
    } catch {
      res.status(400).json({ error: BACKUP_DECRYPTION_ERROR, code: "DECRYPT_FAILED" });
      return;
    }

    // Validate all profile digests
    for (const entry of payload.profiles) {
      if (!verifyProfileDigest(entry)) {
        res.status(400).json({
          error: `Profile "${entry.profileId}" has invalid digest — backup may be corrupted.`,
          code: "DIGEST_INVALID"
        });
        return;
      }
    }

    const { decisions } = parsedDecisions.data;
    const dataDir = process.env.VITANA_DATA_DIR ?? "data";

    // Enter maintenance mode
    maintenanceMode = true;

    const journal = new RestoreJournal(dataDir, randomUUID());
    const results: BackupRestoreResponse["restored"] = [];

    try {
      // Stage: record all decisions in journal
      for (const decision of decisions) {
        const backupEntry = payload.profiles.find(p => p.profileId === decision.profileId);
        if (!backupEntry) {
          results.push({ profileId: decision.profileId, decision: decision.decision, success: false });
          continue;
        }

        if (decision.decision === "skip") {
          results.push({ profileId: decision.profileId, decision: "skip", success: true });
          continue;
        }

        journal.addEntry({
          profileId: decision.profileId,
          decision: decision.decision,
          status: "pending"
        });
      }

      journal.setPhase("hydrating");

      // Hydrate and execute decisions
      const localProfiles = storeManager.listProfiles();

      for (const entry of journal.entries) {
        if (entry.status !== "pending") continue;
        const backupEntry = payload.profiles.find(p => p.profileId === entry.profileId)!;
        const existsLocally = localProfiles.some(p => p.id === entry.profileId);

        if (entry.decision === "replace") {
          if (!existsLocally) {
            // Profile doesn't exist locally — create it fresh
            const created = await storeManager.createProfile(backupEntry.displayName);
            const store = storeManager.getStore(created.id);
            await store.replaceProfile(backupEntry.data.profile);
            // Hydrate with full data via import
            await hydrateStoreFromBackup(store, backupEntry.data);
            journal.updateEntryStatus(entry.profileId, "hydrated");
            results.push({
              profileId: entry.profileId,
              decision: "replace",
              newProfileId: created.id,
              success: true
            });
          } else {
            // Replace existing profile — preserve pairing grants
            const store = storeManager.getStore(entry.profileId);
            await store.replaceProfile(backupEntry.data.profile);
            await hydrateStoreFromBackup(store, backupEntry.data);
            journal.updateEntryStatus(entry.profileId, "hydrated");
            results.push({ profileId: entry.profileId, decision: "replace", success: true });
          }
        } else if (entry.decision === "create-copy") {
          // Create a new profile with copy suffix — does NOT inherit pairing grants
          const dateSuffix = new Date().toISOString().slice(0, 10);
          const copyName = `${backupEntry.displayName} (restored ${dateSuffix})`;
          const created = await storeManager.createProfile(copyName);
          const store = storeManager.getStore(created.id);
          // Update profile data but with new ID
          const adjustedProfile = { ...backupEntry.data.profile, id: created.id, displayName: copyName };
          await store.replaceProfile(adjustedProfile);
          await hydrateStoreFromBackup(store, backupEntry.data);
          journal.updateEntryStatus(entry.profileId, "hydrated");
          results.push({
            profileId: entry.profileId,
            decision: "create-copy",
            newProfileId: created.id,
            success: true
          });
        }
      }

      // Commit phase — registry is already updated by createProfile/replaceProfile
      journal.setPhase("committing");
      journal.complete();

      const response: BackupRestoreResponse = {
        restored: results,
        activeProfileId: storeManager.getActiveProfileId()
      };

      res.json(response);
    } catch (err) {
      // Rollback — journal records partial state for recovery
      journal.rollback();
      res.status(500).json({
        error: "Restore failed. The system has been rolled back to its previous state.",
        code: "RESTORE_FAILED"
      });
    } finally {
      maintenanceMode = false;
    }
  });

  return router;
}

/**
 * Hydrate a store with full backup data via merge import.
 * This handles all data categories in the HealthStoreData.
 */
async function hydrateStoreFromBackup(
  store: import("../storage/profileRepository.js").ManagedProfileRepository,
  data: import("@vitana/shared").HealthStoreData
): Promise<void> {
  // Use mergeImport for observation data
  if (data.sourceImports.length > 0 || data.observations.length > 0 ||
      data.timeSeriesSamples.length > 0 || data.activitySessions.length > 0) {
    for (const sourceImport of data.sourceImports) {
      const dataSource = data.dataSources.find(ds => ds.importId === sourceImport.id);
      if (!dataSource) continue;

      const relatedObservations = data.observations.filter(o => o.sourceId === dataSource.id);
      const relatedGroups = data.observationGroups.filter(g => g.sourceId === dataSource.id || g.importId === sourceImport.id);
      const relatedSamples = data.timeSeriesSamples.filter(s => s.sourceId === dataSource.id);
      const relatedActivities = data.activitySessions.filter(a => a.sourceId === dataSource.id);

      await store.mergeImport({
        sourceImport,
        dataSource,
        observations: relatedObservations,
        observationGroups: relatedGroups,
        timeSeriesSamples: relatedSamples,
        activitySessions: relatedActivities
      });
    }

    // Handle orphan observations (no source import)
    const importedSourceIds = new Set(data.dataSources.filter(ds => ds.importId).map(ds => ds.id));
    const orphanObservations = data.observations.filter(o => !importedSourceIds.has(o.sourceId));
    const orphanSources = data.dataSources.filter(ds => !ds.importId);

    for (const source of orphanSources) {
      const relatedObs = orphanObservations.filter(o => o.sourceId === source.id);
      const relatedGroups = data.observationGroups.filter(g => g.sourceId === source.id);
      const relatedSamples = data.timeSeriesSamples.filter(s => s.sourceId === source.id);
      const relatedActivities = data.activitySessions.filter(a => a.sourceId === source.id);

      if (relatedObs.length > 0 || relatedSamples.length > 0 || relatedActivities.length > 0) {
        const syntheticImport = {
          id: `backup-restore-orphan-${randomBytes(8).toString("hex")}`,
          sourceKind: source.sourceKind,
          fileName: "backup-restore",
          importedAt: new Date().toISOString(),
          parserVersion: "restore-1.0",
          checksum: randomBytes(16).toString("hex"),
          rowCount: relatedObs.length + relatedSamples.length + relatedActivities.length,
          status: "processed" as const,
          diagnostics: []
        };
        await store.mergeImport({
          sourceImport: syntheticImport,
          dataSource: source,
          observations: relatedObs,
          observationGroups: relatedGroups,
          timeSeriesSamples: relatedSamples,
          activitySessions: relatedActivities
        });
      }
    }
  }
}

/**
 * Middleware to collect raw binary body with size limit.
 * Used for multipart-like binary upload of .vitana-backup files.
 */
function collectBinaryBody(maxSize: number) {
  return (req: express.Request, res: express.Response, next: express.NextFunction): void => {
    const contentLength = parseInt(req.headers["content-length"] ?? "0", 10);
    if (contentLength > maxSize) {
      res.status(413).json({ error: "Backup file exceeds maximum size.", code: "PAYLOAD_TOO_LARGE" });
      return;
    }

    const chunks: Buffer[] = [];
    let totalSize = 0;
    let aborted = false;

    req.on("data", (chunk: Buffer) => {
      if (aborted) return;
      totalSize += chunk.length;
      if (totalSize > maxSize) {
        aborted = true;
        req.destroy();
        if (!res.headersSent) {
          res.status(413).json({ error: "Backup file exceeds maximum size.", code: "PAYLOAD_TOO_LARGE" });
        }
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (aborted) return;
      (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.concat(chunks);
      next();
    });

    req.on("error", () => {
      if (aborted) return;
      aborted = true;
      if (!res.headersSent) {
        res.status(400).json({ error: "Error reading request body.", code: "READ_ERROR" });
      }
    });
  };
}
