/**
 * Backup encryption/decryption using built-in Node.js crypto.
 *
 * Format: [4B magic][1B version][32B salt][12B IV][ciphertext+16B GCM tag]
 * Payload: gzip-compressed JSON of BackupPayload
 * Key derivation: scrypt(passphrase, salt, N=2^17, r=8, p=1, keyLen=32)
 */
import { createHash, randomBytes, scrypt, createCipheriv, createDecipheriv } from "node:crypto";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import { gzipSync, gunzip, createGzip } from "node:zlib";
import {
  VITANA_BACKUP_MAGIC,
  VITANA_BACKUP_VERSION,
  VITANA_BACKUP_SALT_LENGTH,
  VITANA_BACKUP_IV_LENGTH,
  VITANA_BACKUP_HEADER_LENGTH,
  SCRYPT_N,
  SCRYPT_R,
  SCRYPT_P,
  SCRYPT_KEY_LENGTH,
  BACKUP_DECRYPTION_ERROR,
  BACKUP_MAX_SIZE_BYTES,
  BACKUP_UNSUPPORTED_FORMAT_ERROR,
  backupPayloadSchema,
  parsePersistedHealthStore,
  type BackupPayload,
  type BackupProfileEntry,
  type HealthStoreData
} from "@vitana/shared";
import {
  backupExportCollections,
  type BackupExportCollection,
  type ProfileRepository
} from "./storage/profileRepository.js";

const BACKUP_EXPORT_PAGE_SIZE = 250;
const gunzipAsync = promisify(gunzip);

export class BackupTooLargeError extends Error {
  constructor() {
    super("Encrypted backup exceeds the maximum restorable size.");
    this.name = "BackupTooLargeError";
  }
}

/**
 * Raised only after the passphrase has already authenticated the file, so it is safe to tell the
 * user their backup is from an unreadable format rather than blaming their passphrase.
 */
export class UnsupportedBackupFormatError extends Error {
  readonly code = "BACKUP_UNSUPPORTED_FORMAT";

  constructor(readonly detail?: string) {
    super(BACKUP_UNSUPPORTED_FORMAT_ERROR);
    this.name = "UnsupportedBackupFormatError";
  }
}

/**
 * Compute canonical SHA-256 digest of a HealthStoreData object.
 * Uses deterministic JSON serialization (recursively sorted keys).
 */
export function computeCanonicalDigest(data: HealthStoreData): string {
  return digestOf(data);
}

function digestOf(value: unknown): string {
  return createHash("sha256").update(canonicalStringify(value), "utf8").digest("hex");
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

export async function createBackupV1Stream(
  stores: readonly ProfileRepository[],
  options: { passphrase: string; scope: BackupPayload["scope"]; createdAt: string; signal?: AbortSignal }
): Promise<Readable> {
  const salt = randomBytes(VITANA_BACKUP_SALT_LENGTH);
  const iv = randomBytes(VITANA_BACKUP_IV_LENGTH);
  const key = await deriveKey(options.passphrase, salt);
  const header = Buffer.alloc(VITANA_BACKUP_HEADER_LENGTH);
  header.set(VITANA_BACKUP_MAGIC, 0);
  header[4] = VITANA_BACKUP_VERSION;
  header.set(salt, 5);
  header.set(iv, 5 + VITANA_BACKUP_SALT_LENGTH);

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(header.subarray(0, 5));
  const gzip = createGzip({ level: 6 });
  const plaintext = Readable.from(limitPlaintextSize(serializeBackupPayload(stores, options)), { objectMode: false });
  const encrypted = plaintext.pipe(gzip).pipe(cipher);

  return Readable.from((async function* () {
    let emitted = 0;
    const emit = (chunk: Buffer): Buffer => {
      emitted += chunk.length;
      if (emitted > BACKUP_MAX_SIZE_BYTES) throw new BackupTooLargeError();
      return chunk;
    };
    try {
      yield emit(header);
      for await (const chunk of encrypted) {
        if (options.signal?.aborted) throw abortError();
        yield emit(Buffer.from(chunk as Buffer));
      }
      yield emit(cipher.getAuthTag());
    } finally {
      plaintext.destroy();
      gzip.destroy();
      cipher.destroy();
    }
  })(), { objectMode: false });
}

/**
 * Counts the exact plaintext bytes without retaining them. Running this before response headers
 * are committed means a size rejection can still be communicated as a proper API response.
 */
export async function estimateBackupV1PlaintextSize(
  stores: readonly ProfileRepository[],
  options: { scope: BackupPayload["scope"]; createdAt: string; signal?: AbortSignal }
): Promise<number> {
  let total = 0;
  for await (const chunk of serializeBackupPayload(stores, options)) {
    total += chunk.length;
    if (total > BACKUP_MAX_SIZE_BYTES) throw new BackupTooLargeError();
  }
  return total;
}

async function* limitPlaintextSize(source: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
  let total = 0;
  for await (const chunk of source) {
    total += chunk.length;
    if (total > BACKUP_MAX_SIZE_BYTES) throw new BackupTooLargeError();
    yield chunk;
  }
}

async function* serializeBackupPayload(
  stores: readonly ProfileRepository[],
  options: { scope: BackupPayload["scope"]; createdAt: string; signal?: AbortSignal }
): AsyncGenerator<Buffer> {
  yield Buffer.from(`{"formatVersion":1,"createdAt":${JSON.stringify(options.createdAt)},"scope":${JSON.stringify(options.scope)},"profiles":[`);
  for (let profileIndex = 0; profileIndex < stores.length; profileIndex += 1) {
    if (options.signal?.aborted) return;
    const store = stores[profileIndex];
    const metadata = await store.backupExportMetadata();
    if (profileIndex > 0) yield Buffer.from(",");
    yield Buffer.from(`{"profileId":${JSON.stringify(metadata.profile.id)},"displayName":${JSON.stringify(metadata.profile.displayName)},"data":`);

    const digest = createHash("sha256");
    const dataChunk = (value: string): Buffer => {
      const chunk = Buffer.from(value, "utf8");
      digest.update(chunk);
      return chunk;
    };
    yield dataChunk("{");
    let propertyIndex = 0;
    const property = (name: string, valuePrefix = ""): Buffer => {
      const separator = propertyIndex++ === 0 ? "" : ",";
      return dataChunk(`${separator}${JSON.stringify(name)}:${valuePrefix}`);
    };

    const dataKeys = [...backupExportCollections, "profile", "schemaVersion"].sort();
    for (const key of dataKeys) {
      if (key === "profile") {
        yield property(key, canonicalStringify(metadata.profile));
      } else if (key === "schemaVersion") {
        yield property(key, JSON.stringify(metadata.schemaVersion));
      } else {
        const collection = key as BackupExportCollection;
        yield property(key, "[");
        let offset = 0;
        let itemIndex = 0;
        while (true) {
          if (options.signal?.aborted) return;
          const page = await store.backupExportPage(collection, offset, BACKUP_EXPORT_PAGE_SIZE);
          for (const item of page.items) {
            yield dataChunk(`${itemIndex++ === 0 ? "" : ","}${canonicalStringify(item)}`);
          }
          offset += page.items.length;
          if (page.done) break;
          if (page.items.length === 0) throw new Error(`Backup export page for ${collection} made no progress.`);
        }
        yield dataChunk("]");
      }
    }
    yield dataChunk("}");
    yield Buffer.from(`,"digest":${JSON.stringify(digest.digest("hex"))}}`);
  }
  yield Buffer.from("]}");
}

function abortError(): Error {
  const error = new Error("Backup creation was cancelled.");
  error.name = "AbortError";
  return error;
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
 * Encrypt a BackupPayload into the .vitana-backup binary format.
 */
export async function encryptBackup(payload: BackupPayload, passphrase: string): Promise<Buffer> {
  const json = JSON.stringify(payload);
  const compressed = gzipSync(Buffer.from(json, "utf8"), { level: 6 });

  const salt = randomBytes(VITANA_BACKUP_SALT_LENGTH);
  const iv = randomBytes(VITANA_BACKUP_IV_LENGTH);
  const key = await deriveKey(passphrase, salt);

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  // Authenticate the header (magic + version) as additional data
  const header = Buffer.alloc(5);
  header.set(VITANA_BACKUP_MAGIC, 0);
  header[4] = VITANA_BACKUP_VERSION;
  cipher.setAAD(header);

  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag(); // 16 bytes

  // Assemble: header + salt + iv + ciphertext + tag
  return Buffer.concat([header, salt, iv, encrypted, tag]);
}

/**
 * Decrypt a .vitana-backup binary buffer into a BackupPayload.
 * Throws a generic error for any decryption/format failure (no oracle).
 */
export async function decryptBackup(buffer: Buffer, passphrase: string): Promise<BackupPayload> {
  if (buffer.length < VITANA_BACKUP_HEADER_LENGTH + 16) {
    throw new Error(BACKUP_DECRYPTION_ERROR);
  }

  // Validate magic
  for (let i = 0; i < 4; i++) {
    if (buffer[i] !== VITANA_BACKUP_MAGIC[i]) {
      throw new Error(BACKUP_DECRYPTION_ERROR);
    }
  }

  // Validate version
  if (buffer[4] !== VITANA_BACKUP_VERSION) {
    throw new Error(BACKUP_DECRYPTION_ERROR);
  }

  const salt = buffer.subarray(5, 5 + VITANA_BACKUP_SALT_LENGTH);
  const iv = buffer.subarray(5 + VITANA_BACKUP_SALT_LENGTH, VITANA_BACKUP_HEADER_LENGTH);
  const ciphertextWithTag = buffer.subarray(VITANA_BACKUP_HEADER_LENGTH);

  if (ciphertextWithTag.length < 16) {
    throw new Error(BACKUP_DECRYPTION_ERROR);
  }

  const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16);
  const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16);

  const key = await deriveKey(passphrase, Buffer.from(salt));

  let json: string;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv));
    const header = buffer.subarray(0, 5);
    decipher.setAAD(header);
    decipher.setAuthTag(Buffer.from(tag));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()]);
    json = (await gunzipAsync(decrypted, { maxOutputLength: BACKUP_MAX_SIZE_BYTES })).toString("utf8");
  } catch {
    // Everything up to here fails identically for a wrong passphrase and a corrupted file, so this
    // is the one place that must stay a generic message.
    throw new Error(BACKUP_DECRYPTION_ERROR);
  }

  // Past this point the passphrase is proven correct, so failures can name the real problem.
  return validateBackupPayload(parseJson(json));

  function parseJson(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      throw new UnsupportedBackupFormatError("Backup contents are not valid JSON.");
    }
  }

  function validateBackupPayload(value: unknown): BackupPayload {
    const envelope = backupPayloadSchema.safeParse(value);
    if (!envelope.success) {
      throw new UnsupportedBackupFormatError(envelope.error.issues[0]?.message);
    }
    const profiles = envelope.data.profiles.map((profile) => {
      // The digest covers the bytes as written, so it has to be checked before any repair. When
      // it holds, the entry is re-stamped against the parsed data so downstream checks still mean
      // something; when it does not, the stale digest is left in place so the restore refuses.
      const digestValid = digestOf(profile.data) === profile.digest;
      let data: HealthStoreData;
      try {
        // The envelope leaves `data` as a passthrough object, so this is where a backup written
        // at a different EXPORT_FORMAT_VERSION is rejected rather than silently mis-read.
        data = parsePersistedHealthStore(profile.data);
      } catch (error) {
        throw new UnsupportedBackupFormatError(error instanceof Error ? error.message : undefined);
      }
      if (data.profile.id !== profile.profileId) {
        throw new UnsupportedBackupFormatError("Backup profile identifier does not match its data.");
      }
      return {
        ...profile,
        data,
        digest: digestValid ? digestOf(data) : profile.digest
      } satisfies BackupProfileEntry;
    });
    return { ...envelope.data, profiles };
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
