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
import { pipeline } from "node:stream/promises";
import {
  BACKUP_DECRYPTION_ERROR,
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
  BackupTooLargeError,
  createBackupV1Stream,
  decryptBackup,
  UnsupportedBackupFormatError,
  verifyProfileDigest
} from "../backupCrypto.js";
import { RestoreJournal } from "../storage/restoreJournal.js";
import { BackupMultipartError, parseBackupMultipart } from "../backupMultipart.js";
import { createRateLimiter } from "../rateLimit.js";

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
  const rateLimit = createRateLimiter();

  // --- POST /create — Generate encrypted backup ---
  router.post(
    "/create",
    rateLimit("backups-create", 5, 60_000),
    express.json({ limit: "1mb" }),
    async (req, res) => {
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
      const createdAt = new Date().toISOString();
      const stores = targetIds.map((id) => storeManager.getStore(id));
      const abortController = new AbortController();
      const onAborted = () => abortController.abort();
      req.once("aborted", onAborted);
      res.once("close", () => {
        if (!res.writableFinished) abortController.abort();
      });
      const encrypted = await createBackupV1Stream(stores, {
        passphrase,
        scope,
        createdAt,
        signal: abortController.signal
      });

      const timestamp = createdAt.replace(/[:.]/g, "-").slice(0, 19);
      const activeProfile = allProfiles.find((profile) => profile.id === targetIds[0]);
      const profileName = scope === "active" && activeProfile
        ? `-${sanitizeFilenameSegment(activeProfile.displayName)}`
        : "";
      const filename = `vitana-backup${profileName}-${timestamp}${VITANA_BACKUP_FILE_EXTENSION}`;

      res.setHeader("content-type", "application/octet-stream");
      res.setHeader("content-disposition", `attachment; filename="${filename}"`);
      res.status(200);
      await pipeline(encrypted, res);
      req.off("aborted", onAborted);
      for (const store of stores) await store.recordExportAudit();
    } catch (err) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.status(err instanceof BackupTooLargeError ? 413 : 500).json({
        error: err instanceof BackupTooLargeError ? err.message : "Failed to create backup.",
        code: err instanceof BackupTooLargeError ? "BACKUP_TOO_LARGE" : "BACKUP_CREATE_FAILED"
      });
    }
    }
  );

  // --- POST /inspect — Decrypt and inspect backup without restoring ---
  router.post("/inspect", rateLimit("backups-inspect", 10, 60_000), async (req, res) => {
    const principal = res.locals.principal as AuthorizationPrincipal | undefined;
    if (!principal || principal.kind !== "owner") {
      res.status(403).json({ error: "Owner access required.", code: "OWNER_REQUIRED" });
      return;
    }

    let upload;
    let payload: BackupPayload;
    try {
      upload = await parseBackupMultipart(req, { requireDecisions: false });
      const parsedPassphrase = backupCreateRequestSchema.shape.passphrase.safeParse(upload.passphrase);
      if (!parsedPassphrase.success) {
        res.status(400).json({ error: "Passphrase must be 12 to 256 characters.", code: "PASSPHRASE_REQUIRED" });
        return;
      }
      payload = await decryptBackup(upload.file, parsedPassphrase.data);
    } catch (error) {
      if (error instanceof BackupMultipartError) {
        res.status(error.status).json({ error: error.message, code: error.code });
        return;
      }
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
  router.post("/restore", rateLimit("backups-restore", 5, 60_000), async (req, res) => {
    const principal = res.locals.principal as AuthorizationPrincipal | undefined;
    if (!principal || principal.kind !== "owner") {
      res.status(403).json({ error: "Owner access required.", code: "OWNER_REQUIRED" });
      return;
    }

    const restoreId = randomUUID();
    if (activeRestoreId) {
      res.status(409).json({ error: "Another restore is already in progress.", code: "RESTORE_IN_PROGRESS" });
      return;
    }
    activeRestoreId = restoreId;

    try {
      const upload = await parseBackupMultipart(req, { requireDecisions: true });
      const parsedDecisions = backupRestoreRequestSchema.safeParse({
        passphrase: upload.passphrase,
        decisions: upload.decisions
      });
      if (!parsedDecisions.success) {
        const issues = parsedDecisions.error.issues.slice(0, 3).map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
        res.status(400).json({ error: `Invalid restore request: ${issues}`, code: "VALIDATION_ERROR" });
        return;
      }

      let payload: BackupPayload;
      try {
        payload = await decryptBackup(upload.file, parsedDecisions.data.passphrase);
      } catch (error) {
        respondToDecryptFailure(res, error);
        return;
      }

      for (const entry of payload.profiles) {
        if (!verifyProfileDigest(entry)) {
          res.status(400).json({
            error: `Profile "${entry.profileId}" has invalid digest — backup may be corrupted.`,
            code: "DIGEST_INVALID"
          });
          return;
        }
      }

      const journal = new RestoreJournal(process.env.VITANA_DATA_DIR ?? "data", restoreId);
      const results: BackupRestoreResponse["restored"] = [];
      const restoreRequests: import("../storage/profileStoreManager.js").RestoreProfileRequest[] = [];
      for (const decision of parsedDecisions.data.decisions) {
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
      if (err instanceof BackupMultipartError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
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
