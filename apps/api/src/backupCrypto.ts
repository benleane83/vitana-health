/**
 * Backup encryption/decryption using built-in Node.js crypto.
 *
 * Format: [4B magic][1B version][32B salt][12B IV][ciphertext+16B GCM tag]
 * Payload: gzip-compressed JSON of BackupPayload
 * Key derivation: scrypt(passphrase, salt, N=2^17, r=8, p=1, keyLen=32)
 */
import { createHash, randomBytes, scrypt, createCipheriv, createDecipheriv } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
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
  BACKUP_DECRYPTION_ERROR,
  healthStoreDataSchema,
  type BackupPayload,
  type BackupProfileEntry,
  type HealthStoreData
} from "@local-fitness-advisor/shared";

const BACKUP_MAX_DECOMPRESSED_SIZE_BYTES = 256 * 1024 * 1024;

/**
 * Compute canonical SHA-256 digest of a HealthStoreData object.
 * Uses deterministic JSON serialization (recursively sorted keys).
 */
export function computeCanonicalDigest(data: HealthStoreData): string {
  const canonical = canonicalStringify(data);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Recursively sort object keys for deterministic JSON output. */
function canonicalStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return val;
  });
}

/**
 * Derive encryption key from passphrase + salt using async scrypt.
 * maxmem is set to 256MB to accommodate the N=2^17 cost factor.
 */
function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      passphrase, salt, SCRYPT_KEY_LENGTH,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 256 * 1024 * 1024 },
      (err, key) => {
        if (err) reject(err);
        else resolve(key);
      }
    );
  });
}

/**
 * Encrypt a BackupPayload into the .lfa-backup binary format.
 */
export async function encryptBackup(payload: BackupPayload, passphrase: string): Promise<Buffer> {
  const json = JSON.stringify(payload);
  const compressed = gzipSync(Buffer.from(json, "utf8"), { level: 6 });

  const salt = randomBytes(LFA_BACKUP_SALT_LENGTH);
  const iv = randomBytes(LFA_BACKUP_IV_LENGTH);
  const key = await deriveKey(passphrase, salt);

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  // Authenticate the header (magic + version) as additional data
  const header = Buffer.alloc(5);
  header.set(LFA_BACKUP_MAGIC, 0);
  header[4] = LFA_BACKUP_VERSION;
  cipher.setAAD(header);

  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag(); // 16 bytes

  // Assemble: header + salt + iv + ciphertext + tag
  return Buffer.concat([header, salt, iv, encrypted, tag]);
}

/**
 * Decrypt a .lfa-backup binary buffer into a BackupPayload.
 * Throws a generic error for any decryption/format failure (no oracle).
 */
export async function decryptBackup(buffer: Buffer, passphrase: string): Promise<BackupPayload> {
  if (buffer.length < LFA_BACKUP_HEADER_LENGTH + 16) {
    throw new Error(BACKUP_DECRYPTION_ERROR);
  }

  // Validate magic
  for (let i = 0; i < 4; i++) {
    if (buffer[i] !== LFA_BACKUP_MAGIC[i]) {
      throw new Error(BACKUP_DECRYPTION_ERROR);
    }
  }

  // Validate version
  if (buffer[4] !== LFA_BACKUP_VERSION) {
    throw new Error(BACKUP_DECRYPTION_ERROR);
  }

  const salt = buffer.subarray(5, 5 + LFA_BACKUP_SALT_LENGTH);
  const iv = buffer.subarray(5 + LFA_BACKUP_SALT_LENGTH, LFA_BACKUP_HEADER_LENGTH);
  const ciphertextWithTag = buffer.subarray(LFA_BACKUP_HEADER_LENGTH);

  if (ciphertextWithTag.length < 16) {
    throw new Error(BACKUP_DECRYPTION_ERROR);
  }

  const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16);
  const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16);

  const key = await deriveKey(passphrase, Buffer.from(salt));

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv));
    const header = buffer.subarray(0, 5);
    decipher.setAAD(header);
    decipher.setAuthTag(Buffer.from(tag));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()]);
    const json = gunzipSync(decrypted, { maxOutputLength: BACKUP_MAX_DECOMPRESSED_SIZE_BYTES }).toString("utf8");
    return validateBackupPayload(JSON.parse(json));
  } catch {
    throw new Error(BACKUP_DECRYPTION_ERROR);
  }

  function validateBackupPayload(value: unknown): BackupPayload {
    if (!value || typeof value !== "object") throw new Error(BACKUP_DECRYPTION_ERROR);
    const payload = value as Partial<BackupPayload>;
    if (
      payload.formatVersion !== 1 ||
      typeof payload.createdAt !== "string" ||
      (payload.scope !== "active" && payload.scope !== "all") ||
      !Array.isArray(payload.profiles) ||
      payload.profiles.length === 0
    ) {
      throw new Error(BACKUP_DECRYPTION_ERROR);
    }
    const ids = new Set<string>();
    for (const profile of payload.profiles) {
      if (
        !profile ||
        typeof profile.profileId !== "string" ||
        typeof profile.displayName !== "string" ||
        typeof profile.digest !== "string" ||
        ids.has(profile.profileId) ||
        !healthStoreDataSchema.safeParse(profile.data).success ||
        profile.data.profile.id !== profile.profileId
      ) {
        throw new Error(BACKUP_DECRYPTION_ERROR);
      }
      ids.add(profile.profileId);
    }
    return payload as BackupPayload;
  }
}

/**
 * Build a BackupProfileEntry from a HealthStoreData export.
 */
export function buildBackupProfileEntry(data: HealthStoreData): BackupProfileEntry {
  return {
    profileId: data.profile.id,
    displayName: data.profile.displayName,
    data,
    digest: computeCanonicalDigest(data)
  };
}

/**
 * Verify the digest of a BackupProfileEntry.
 */
export function verifyProfileDigest(entry: BackupProfileEntry): boolean {
  return computeCanonicalDigest(entry.data) === entry.digest;
}
