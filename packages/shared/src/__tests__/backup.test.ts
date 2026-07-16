import { describe, it, expect } from "vitest";
import {
  LFA_BACKUP_MAGIC,
  LFA_BACKUP_VERSION,
  LFA_BACKUP_SALT_LENGTH,
  LFA_BACKUP_IV_LENGTH,
  LFA_BACKUP_HEADER_LENGTH,
  SCRYPT_N,
  SCRYPT_R,
  SCRYPT_P,
  SCRYPT_KEY_LENGTH,
  BACKUP_MAX_SIZE_BYTES,
  LFA_BACKUP_FILE_EXTENSION,
  BACKUP_DECRYPTION_ERROR,
  backupCreateRequestSchema,
  backupRestoreRequestSchema,
  backupInspectResponseSchema
} from "../backup.js";

describe("backup contracts", () => {
  describe("constants", () => {
    it("has correct magic bytes for LFA", () => {
      expect(LFA_BACKUP_MAGIC).toEqual(new Uint8Array([0x4c, 0x46, 0x41, 0x00]));
    });

    it("has version 1", () => {
      expect(LFA_BACKUP_VERSION).toBe(1);
    });

    it("has correct header length", () => {
      expect(LFA_BACKUP_HEADER_LENGTH).toBe(4 + 1 + LFA_BACKUP_SALT_LENGTH + LFA_BACKUP_IV_LENGTH);
      expect(LFA_BACKUP_HEADER_LENGTH).toBe(49);
    });

    it("uses 32-byte salt", () => {
      expect(LFA_BACKUP_SALT_LENGTH).toBe(32);
    });

    it("uses 12-byte IV for GCM", () => {
      expect(LFA_BACKUP_IV_LENGTH).toBe(12);
    });

    it("uses scrypt with N=2^17", () => {
      expect(SCRYPT_N).toBe(131072);
      expect(SCRYPT_R).toBe(8);
      expect(SCRYPT_P).toBe(1);
      expect(SCRYPT_KEY_LENGTH).toBe(32);
    });

    it("has 100MB max size", () => {
      expect(BACKUP_MAX_SIZE_BYTES).toBe(100 * 1024 * 1024);
    });

    it("has correct file extension", () => {
      expect(LFA_BACKUP_FILE_EXTENSION).toBe(".lfa-backup");
    });

    it("has generic error message", () => {
      expect(BACKUP_DECRYPTION_ERROR).toBe("Invalid passphrase or corrupted backup file.");
    });
  });

  describe("backupCreateRequestSchema", () => {
    it("validates a valid all-scope request", () => {
      const result = backupCreateRequestSchema.safeParse({
        passphrase: "strong-passphrase",
        scope: "all"
      });
      expect(result.success).toBe(true);
    });

    it("validates a selected-scope request with profileIds", () => {
      const result = backupCreateRequestSchema.safeParse({
        passphrase: "strong-passphrase",
        scope: "selected",
        profileIds: ["user-1", "user-2"]
      });
      expect(result.success).toBe(true);
    });

    it("rejects passphrase shorter than 8 chars", () => {
      const result = backupCreateRequestSchema.safeParse({
        passphrase: "short",
        scope: "all"
      });
      expect(result.success).toBe(false);
    });

    it("rejects passphrase longer than 256 chars", () => {
      const result = backupCreateRequestSchema.safeParse({
        passphrase: "x".repeat(257),
        scope: "all"
      });
      expect(result.success).toBe(false);
    });

    it("defaults scope to all", () => {
      const result = backupCreateRequestSchema.safeParse({
        passphrase: "strong-passphrase"
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scope).toBe("all");
      }
    });
  });

  describe("backupRestoreRequestSchema", () => {
    it("validates skip decisions", () => {
      const result = backupRestoreRequestSchema.safeParse({
        passphrase: "strong-passphrase",
        decisions: [{ profileId: "user-1", decision: "skip" }]
      });
      expect(result.success).toBe(true);
    });

    it("validates create-copy decisions", () => {
      const result = backupRestoreRequestSchema.safeParse({
        passphrase: "strong-passphrase",
        decisions: [{ profileId: "user-1", decision: "create-copy" }]
      });
      expect(result.success).toBe(true);
    });

    it("requires acknowledgment for replace", () => {
      const result = backupRestoreRequestSchema.safeParse({
        passphrase: "strong-passphrase",
        decisions: [{ profileId: "user-1", decision: "replace" }]
      });
      expect(result.success).toBe(false);
    });

    it("accepts replace with correct acknowledgment", () => {
      const result = backupRestoreRequestSchema.safeParse({
        passphrase: "strong-passphrase",
        decisions: [{
          profileId: "user-1",
          decision: "replace",
          acknowledgeReplacement: "REPLACE_CONFIRMED"
        }]
      });
      expect(result.success).toBe(true);
    });

    it("rejects replace with wrong acknowledgment", () => {
      const result = backupRestoreRequestSchema.safeParse({
        passphrase: "strong-passphrase",
        decisions: [{
          profileId: "user-1",
          decision: "replace",
          acknowledgeReplacement: "WRONG"
        }]
      });
      expect(result.success).toBe(false);
    });

    it("requires at least one decision", () => {
      const result = backupRestoreRequestSchema.safeParse({
        passphrase: "strong-passphrase",
        decisions: []
      });
      expect(result.success).toBe(false);
    });
  });

  describe("backupInspectResponseSchema", () => {
    it("validates a well-formed inspect response", () => {
      const result = backupInspectResponseSchema.safeParse({
        formatVersion: 1,
        createdAt: "2024-06-01T00:00:00.000Z",
        scope: "all",
        profiles: [{
          profileId: "user-1",
          displayName: "Test User",
          digestValid: true,
          observationCount: 42,
          existsLocally: true
        }]
      });
      expect(result.success).toBe(true);
    });
  });
});
