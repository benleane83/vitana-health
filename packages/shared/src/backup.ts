/**
 * Shared contracts for the portable passphrase-protected profile backup format (.lfa-backup).
 *
 * Binary format layout:
 *   [4 bytes magic "LFA\x00"] [1 byte version] [32 bytes salt] [12 bytes IV] [N bytes AES-256-GCM ciphertext+tag]
 *
 * The ciphertext is gzip-compressed JSON of BackupPayload, encrypted with a key derived via scrypt.
 * The header is authenticated but contains NO profile metadata.
 */
import { z } from "zod";

// --- Binary format constants ---

export const LFA_BACKUP_MAGIC = new Uint8Array([0x4c, 0x46, 0x41, 0x00]); // "LFA\x00"
export const LFA_BACKUP_VERSION = 1;
export const LFA_BACKUP_SALT_LENGTH = 32;
export const LFA_BACKUP_IV_LENGTH = 12;
export const LFA_BACKUP_HEADER_LENGTH = 4 + 1 + LFA_BACKUP_SALT_LENGTH + LFA_BACKUP_IV_LENGTH; // 49 bytes
export const LFA_BACKUP_FILE_EXTENSION = ".lfa-backup";

// scrypt parameters: N=2^17, r=8, p=1 (strong for offline attacks, ~130ms on modern hardware)
export const SCRYPT_N = 2 ** 17;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const SCRYPT_KEY_LENGTH = 32; // AES-256

export const BACKUP_MAX_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB hard limit

// --- Payload types ---

export interface BackupProfileEntry {
  profileId: string;
  displayName: string;
  data: import("./types.js").HealthStoreData;
  /** SHA-256 hex digest of canonical JSON of data (for integrity verification) */
  digest: string;
}

export interface BackupPayload {
  formatVersion: 1;
  createdAt: string;
  scope: "active" | "all";
  profiles: BackupProfileEntry[];
}

// --- API request/response contracts ---

export const backupCreateRequestSchema = z.object({
  passphrase: z.string().min(12).max(256),
  scope: z.enum(["active", "all"]).default("all")
}).strict();
export type BackupCreateRequest = z.infer<typeof backupCreateRequestSchema>;

export const backupInspectResponseSchema = z.object({
  formatVersion: z.number(),
  createdAt: z.string(),
  scope: z.string(),
  profiles: z.array(z.object({
    profileId: z.string(),
    displayName: z.string(),
    digestValid: z.boolean(),
    observationCount: z.number().int().nonnegative(),
    existsLocally: z.boolean()
  }))
}).strict();
export type BackupInspectResponse = z.infer<typeof backupInspectResponseSchema>;

export type RestoreDecision = "replace" | "create-copy" | "skip";

export const restoreProfileDecisionSchema = z.object({
  profileId: z.string().min(1).max(120),
  decision: z.enum(["replace", "create-copy", "skip"]),
  /** Required when decision is "replace" - explicit acknowledgment string */
  acknowledgeReplacement: z.string().optional()
}).strict().superRefine((val, ctx) => {
  if (val.decision === "replace" && val.acknowledgeReplacement !== "REPLACE_CONFIRMED") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["acknowledgeReplacement"],
      message: "Replacement requires acknowledgeReplacement set to 'REPLACE_CONFIRMED'."
    });
  }
});

export const backupRestoreRequestSchema = z.object({
  passphrase: z.string().min(12).max(256),
  decisions: z.array(restoreProfileDecisionSchema).min(1)
}).strict();
export type BackupRestoreRequest = z.infer<typeof backupRestoreRequestSchema>;

export const backupRestoreResponseSchema = z.object({
  restored: z.array(z.object({
    profileId: z.string(),
    decision: z.enum(["replace", "create-copy", "skip"]),
    newProfileId: z.string().optional(),
    success: z.boolean()
  })),
  activeProfileId: z.string()
}).strict();
export type BackupRestoreResponse = z.infer<typeof backupRestoreResponseSchema>;

// Generic error message for invalid passphrase/corruption (no oracle)
export const BACKUP_DECRYPTION_ERROR = "Invalid passphrase or corrupted backup file.";
