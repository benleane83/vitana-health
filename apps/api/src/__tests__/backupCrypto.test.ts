import { describe, it, expect } from "vitest";
import {
  computeCanonicalDigest,
  createBackupV1Stream,
  encryptBackup,
  decryptBackup,
  buildBackupProfileEntry,
  UnsupportedBackupFormatError,
  verifyProfileDigest
} from "../backupCrypto.js";
import {
  BACKUP_DECRYPTION_ERROR,
  BACKUP_UNSUPPORTED_FORMAT_ERROR,
  VITANA_BACKUP_MAGIC,
  VITANA_BACKUP_HEADER_LENGTH,
  type BackupPayload,
  type HealthStoreData,
  EXPORT_FORMAT_VERSION,
  defaultMeasurementTypes
} from "@vitana/shared";
import { backupExportCollections, type ProfileRepository } from "../storage/profileRepository.js";

function createTestStoreData(profileId = "test-user", displayName = "Test User"): HealthStoreData {
  return {
    schemaVersion: EXPORT_FORMAT_VERSION,
    profile: {
      id: profileId,
      displayName,
      setupStatus: "complete",
      subjectKind: "adult",
      units: "metric",
      updatedAt: new Date().toISOString()
    },
    sourceImports: [],
    dataSources: [],
    devices: [],
    measurementTypes: defaultMeasurementTypes,
    personalReferenceRanges: [],
    pinnedMeasurements: [],
    observations: [
      {
        id: "obs-1",
        measurementCode: "body-weight",
        observedAt: "2024-01-15T10:00:00.000Z",
        value: 75.5,
        unit: "kg",
        sourceId: "src-1"
      }
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

describe("backupCrypto", () => {
  describe("computeCanonicalDigest", () => {
    it("produces consistent hex digest for same data", () => {
      const data = createTestStoreData();
      const d1 = computeCanonicalDigest(data);
      const d2 = computeCanonicalDigest(data);
      expect(d1).toBe(d2);
      expect(d1).toMatch(/^[a-f0-9]{64}$/);
    });

    it("produces different digest for different data", () => {
      const data1 = createTestStoreData("user-a");
      const data2 = createTestStoreData("user-b");
      expect(computeCanonicalDigest(data1)).not.toBe(computeCanonicalDigest(data2));
    });
  });

  describe("encrypt / decrypt round-trip", () => {
    it("streams a V1 backup readable by the buffered decryptor in bounded pages", async () => {
      const data = createTestStoreData();
      data.observations = Array.from({ length: 251 }, (_, index) => ({
        id: `obs-${index}`,
        measurementCode: "body-weight",
        observedAt: `2024-01-15T10:${String(index % 60).padStart(2, "0")}:00.000Z`,
        value: 70 + index,
        unit: "kg",
        sourceId: "src-1"
      }));
      const pageCalls: Array<{ collection: string; offset: number; limit: number }> = [];
      const store = {
        backupExportMetadata: async () => ({ schemaVersion: data.schemaVersion, profile: data.profile }),
        backupExportPage: async (collection: typeof backupExportCollections[number], offset: number, limit: number) => {
          pageCalls.push({ collection, offset, limit });
          const values = data[collection] as unknown[];
          const items = values.slice(offset, offset + limit);
          return { items, done: items.length < limit };
        }
      } as ProfileRepository;

      const stream = await createBackupV1Stream([store], {
        passphrase: "streamed-backup-passphrase",
        scope: "active",
        createdAt: "2026-08-05T10:00:00.000Z"
      });
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
      const encrypted = Buffer.concat(chunks);
      const decrypted = await decryptBackup(encrypted, "streamed-backup-passphrase");

      expect(decrypted.profiles[0].data).toEqual(data);
      expect(verifyProfileDigest(decrypted.profiles[0])).toBe(true);
      expect(pageCalls.filter((call) => call.collection === "observations")).toEqual([
        { collection: "observations", offset: 0, limit: 250 },
        { collection: "observations", offset: 250, limit: 250 }
      ]);
      expect(pageCalls.every((call) => call.limit === 250)).toBe(true);
    }, 30_000);

    it("encrypts and decrypts a backup payload", async () => {
      const data = createTestStoreData();
      const payload: BackupPayload = {
        formatVersion: 1,
        createdAt: "2024-06-01T00:00:00.000Z",
        scope: "all",
        profiles: [buildBackupProfileEntry(data)]
      };

      const passphrase = "test-passphrase-strong";
      const encrypted = await encryptBackup(payload, passphrase);

      expect(encrypted.length).toBeGreaterThan(VITANA_BACKUP_HEADER_LENGTH + 16);
      // Magic bytes
      expect([...encrypted.subarray(0, 4)]).toEqual([...VITANA_BACKUP_MAGIC]);
      expect(encrypted[4]).toBe(1);    // version

      const decrypted = await decryptBackup(encrypted, passphrase);
      expect(decrypted.formatVersion).toBe(1);
      expect(decrypted.createdAt).toBe("2024-06-01T00:00:00.000Z");
      expect(decrypted.profiles).toHaveLength(1);
      expect(decrypted.profiles[0].profileId).toBe("test-user");
      expect(decrypted.profiles[0].data.observations).toHaveLength(1);
    }, 30_000);

    it("fails with wrong passphrase", async () => {
      const data = createTestStoreData();
      const payload: BackupPayload = {
        formatVersion: 1,
        createdAt: "2024-06-01T00:00:00.000Z",
        scope: "all",
        profiles: [buildBackupProfileEntry(data)]
      };

      const encrypted = await encryptBackup(payload, "correct-passphrase!!");
      await expect(decryptBackup(encrypted, "wrong-passphrase!!!")).rejects.toThrow(BACKUP_DECRYPTION_ERROR);
    }, 30_000);

    it("fails with truncated data", async () => {
      const data = createTestStoreData();
      const payload: BackupPayload = {
        formatVersion: 1,
        createdAt: "2024-06-01T00:00:00.000Z",
        scope: "all",
        profiles: [buildBackupProfileEntry(data)]
      };

      const encrypted = await encryptBackup(payload, "test-passphrase-1234");
      const truncated = encrypted.subarray(0, VITANA_BACKUP_HEADER_LENGTH + 10);
      await expect(decryptBackup(Buffer.from(truncated), "test-passphrase-1234")).rejects.toThrow(BACKUP_DECRYPTION_ERROR);
    }, 30_000);

    it("fails with corrupted magic bytes", async () => {
      const data = createTestStoreData();
      const payload: BackupPayload = {
        formatVersion: 1,
        createdAt: "2024-06-01T00:00:00.000Z",
        scope: "all",
        profiles: [buildBackupProfileEntry(data)]
      };

      const encrypted = await encryptBackup(payload, "test-passphrase-1234");
      encrypted[0] = 0xff; // corrupt magic
      await expect(decryptBackup(encrypted, "test-passphrase-1234")).rejects.toThrow(BACKUP_DECRYPTION_ERROR);
    }, 30_000);

    it("rejects the retired backup format with the generic error", async () => {
      const retiredBackup = Buffer.alloc(VITANA_BACKUP_HEADER_LENGTH + 16);
      retiredBackup.set([0x4c, 0x46, 0x41, 0x00]);
      retiredBackup[4] = 1;

      await expect(decryptBackup(retiredBackup, "test-passphrase-1234")).rejects.toThrow(BACKUP_DECRYPTION_ERROR);
    });

    it("produces different ciphertext each encryption (random salt/IV)", async () => {
      const data = createTestStoreData();
      const payload: BackupPayload = {
        formatVersion: 1,
        createdAt: "2024-06-01T00:00:00.000Z",
        scope: "all",
        profiles: [buildBackupProfileEntry(data)]
      };

      const passphrase = "same-passphrase-every-time";
      const enc1 = await encryptBackup(payload, passphrase);
      const enc2 = await encryptBackup(payload, passphrase);
      // Salt differs (bytes 5-36)
      expect(enc1.subarray(5, 37).equals(enc2.subarray(5, 37))).toBe(false);
    }, 30_000);
  });

  describe("older backup formats", () => {
    it("refuses a backup written at an older export format rather than guessing at it", async () => {
      // The migration chain was removed with the pre-release schema history: the only readable
      // shape is EXPORT_FORMAT_VERSION, and anything else must fail loudly instead of half-loading.
      const legacy = { ...createTestStoreData(), schemaVersion: 7 };
      const payload = {
        formatVersion: 1,
        createdAt: "2024-06-01T00:00:00.000Z",
        scope: "all",
        profiles: [
          {
            profileId: "test-user",
            displayName: "Test User",
            data: legacy,
            digest: computeCanonicalDigest(legacy as unknown as HealthStoreData)
          }
        ]
      } as unknown as BackupPayload;

      const passphrase = "legacy-backup-passphrase";
      const encrypted = await encryptBackup(payload, passphrase);
      await expect(decryptBackup(encrypted, passphrase)).rejects.toThrow(UnsupportedBackupFormatError);
    }, 60_000);

    it("keeps a tampered digest invalid", async () => {
      const current = createTestStoreData();
      const payload = {
        formatVersion: 1,
        createdAt: "2024-06-01T00:00:00.000Z",
        scope: "all",
        profiles: [
          { profileId: "test-user", displayName: "Test User", data: current, digest: "0".repeat(64) }
        ]
      } as unknown as BackupPayload;

      const passphrase = "tampered-digest-passphrase";
      const decrypted = await decryptBackup(await encryptBackup(payload, passphrase), passphrase);
      expect(verifyProfileDigest(decrypted.profiles[0])).toBe(false);
    }, 30_000);

    it("blames the format, not the passphrase, once the passphrase has decrypted the file", async () => {
      const unreadable = { ...createTestStoreData(), schemaVersion: 99 };
      const payload = {
        formatVersion: 1,
        createdAt: "2024-06-01T00:00:00.000Z",
        scope: "all",
        profiles: [
          {
            profileId: "test-user",
            displayName: "Test User",
            data: unreadable,
            digest: computeCanonicalDigest(unreadable as unknown as HealthStoreData)
          }
        ]
      } as unknown as BackupPayload;

      const passphrase = "unsupported-format-pass";
      const encrypted = await encryptBackup(payload, passphrase);
      await expect(decryptBackup(encrypted, passphrase)).rejects.toThrow(UnsupportedBackupFormatError);
      await expect(decryptBackup(encrypted, passphrase)).rejects.toThrow(BACKUP_UNSUPPORTED_FORMAT_ERROR);
    }, 60_000);

    it("still reports a wrong passphrase generically", async () => {
      const payload: BackupPayload = {
        formatVersion: 1,
        createdAt: "2024-06-01T00:00:00.000Z",
        scope: "all",
        profiles: [buildBackupProfileEntry(createTestStoreData())]
      };
      const encrypted = await encryptBackup(payload, "the-right-passphrase!");
      await expect(decryptBackup(encrypted, "the-wrong-passphrase")).rejects.not.toBeInstanceOf(
        UnsupportedBackupFormatError
      );
    }, 30_000);
  });

  describe("buildBackupProfileEntry / verifyProfileDigest", () => {
    it("builds an entry with valid digest", () => {
      const data = createTestStoreData();
      const entry = buildBackupProfileEntry(data);
      expect(entry.profileId).toBe("test-user");
      expect(entry.displayName).toBe("Test User");
      expect(entry.digest).toMatch(/^[a-f0-9]{64}$/);
      expect(verifyProfileDigest(entry)).toBe(true);
    });

    it("detects tampered data", () => {
      const data = createTestStoreData();
      const entry = buildBackupProfileEntry(data);
      entry.data.profile.displayName = "Tampered";
      expect(verifyProfileDigest(entry)).toBe(false);
    });
  });
});
