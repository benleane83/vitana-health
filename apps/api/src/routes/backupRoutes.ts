/**
 * Backup & Restore API routes.
 *
 * Owner-only POST endpoints for portable passphrase-protected profile backups.
 * - POST /api/backups/create        — Create encrypted .vitana-backup binary
 * - POST /api/backups/inspect       — Inspect backup contents (multipart upload)
 * - POST /api/backups/restore       — Restore profiles from backup (multipart upload)
 */
import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  BACKUP_DECRYPTION_ERROR,
  BACKUP_MAX_SIZE_BYTES,
  VITANA_BACKUP_FILE_EXTENSION,
  backupCreateRequestSchema,
  backupInspectResponseSchema,
  backupRestoreRequestSchema,
  backupRestoreResponseSchema,
  type BackupInspectResponse,
  type BackupPayload,
  type BackupRestoreResponse
} from "@vitana/shared";
import { sendJson } from "./sendJson.js";
import type { ProfileStoreManager } from "../storage/profileStoreManager.js";
import type { PairingStore } from "../pairing.js";
import type { AuthorizationPrincipal } from "../createApp.js";
import {
  buildBackupProfileEntry,
  decryptBackup,
  encryptBackup,
  UnsupportedBackupFormatError,
  verifyProfileDigest
} from "../backupCrypto.js";
import { RestoreJournal } from "../storage/restoreJournal.js";

/**
 * A format failure is only reachable once the passphrase has already authenticated the file, so
 * naming it leaks nothing while saving the user from hunting a passphrase that was never wrong.
 */
function respondToDecryptFailure(res: express.Response, error: unknown): void {
  if (error instanceof UnsupportedBackupFormatError) {
    res.status(400).json({ error: error.message, code: error.code });
    return;
  }
  res.status(400).json({ error: BACKUP_DECRYPTION_ERROR, code: "DECRYPT_FAILED" });
}

let activeRestoreId: string | undefined;
export function isInMaintenanceMode(): boolean {
  return activeRestoreId !== undefined;
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
    } catch (error) {
      respondToDecryptFailure(res, error);
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

    sendJson(res, backupInspectResponseSchema, response);
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
    } catch (error) {
      respondToDecryptFailure(res, error);
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
    const restoreId = randomUUID();

    if (activeRestoreId) {
      res.status(409).json({ error: "Another restore is already in progress.", code: "RESTORE_IN_PROGRESS" });
      return;
    }
    activeRestoreId = restoreId;

    const journal = new RestoreJournal(dataDir, restoreId);
    const results: BackupRestoreResponse["restored"] = [];

    try {
      const restoreRequests: import("../storage/profileStoreManager.js").RestoreProfileRequest[] = [];
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
        restoreRequests.push({
          sourceProfileId: decision.profileId,
          decision: decision.decision,
          displayName: backupEntry.displayName,
          data: backupEntry.data
        });
      }
      results.push(...await storeManager.restoreProfiles(restoreRequests, journal));

      const response: BackupRestoreResponse = {
        restored: results,
        activeProfileId: storeManager.getActiveProfileId()
      };

      sendJson(res, backupRestoreResponseSchema, response);
    } catch (err) {
      const compensationFailed = err instanceof Error && err.message.includes("compensation could not be verified");
      res.status(500).json({
        error: compensationFailed
          ? "Restore failed and automatic recovery could not be verified. Restart the service to retry journal recovery."
          : "Restore failed. The previous state was restored and verified.",
        code: compensationFailed ? "RESTORE_RECOVERY_REQUIRED" : "RESTORE_FAILED"
      });
    } finally {
      if (activeRestoreId === restoreId) activeRestoreId = undefined;
    }
  });

  return router;
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
