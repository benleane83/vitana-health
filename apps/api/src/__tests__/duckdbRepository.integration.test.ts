import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  calculateBiologicalAge,
  careItemReminderAt,
  computeAnalytics,
  analyticsCountsFromStore,
  defaultMeasurementTypes,
  type HealthStoreData
} from "@vitana/shared";
import {
  closeEncryptedDuckDbDatabase,
  createDuckDbSchema,
  initializeDuckDbRoot,
  openEncryptedDuckDbDatabase,
  restoreDatabaseBackup,
  SchemaVersionTooNewError
} from "../storage/duckdbRuntime.js";
import { createDuckDbHealthStoreFixture } from "./support/duckdbFixture.js";
import { DuckDbRepository, digestHealthStoreData } from "../storage/duckdbRepository.js";
import { all } from "../storage/duckdbRows.js";
import { buildClinicianReport } from "../clinicianReport.js";
import { healthConnectImportRequestSchema, parseHealthConnectImport } from "../healthConnectImport.js";
import { findPreparedExtension } from "./support/duckdbExtension.js";
import { backupExportCollections } from "../storage/profileRepository.js";

const httpfsExtensionPath = findPreparedExtension();
const key = Buffer.alloc(32, 7).toString("base64");
let root: string;

beforeEach(() => {
  root = initializeDuckDbRoot(mkdtempSync(join(tmpdir(), "vitana-duckdb-repository-test-")));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("DuckDbRepository fidelity", () => {
  it.skipIf(!httpfsExtensionPath)("retrieves and atomically edits a phone-scanned report group without overwriting distinct timestamps", async () => {
    const databasePath = join(root, "databases", "observation-group-edit.duckdb-poc");
    const fixture = createDuckDbHealthStoreFixture();
    fixture.sourceImports[0]!.sourceKind = "blood-test-report";
    fixture.sourceImports[0]!.fileName = "scan-2026-07-12.pdf";
    fixture.dataSources[0]!.sourceKind = "blood-test-report";
    fixture.dataSources[0]!.label = "Blood test report: scanned from phone";
    fixture.observations.push({
      id: "observation-distinct",
      measurementCode: "weight",
      observedAt: "2026-07-12T10:04:00.000Z",
      value: 79,
      unit: "kg",
      sourceId: "source-1",
      observationGroupId: "group-1"
    });
    const repository = await DuckDbRepository.hydrate(root, databasePath, key, fixture, { httpfsExtensionPath });
    try {
      expect(await repository.getObservationGroup("group-1")).toMatchObject({
        id: "group-1",
        editable: true,
        source: { kind: "blood-test-report", label: "Blood test report: scanned from phone" },
        observations: [{ id: "observation-z" }, { id: "observation-distinct" }]
      });

      const updated = await repository.updateObservationGroup("group-1", {
        expectedCollectedAt: "2026-07-12T10:02:00.000Z",
        label: "Morning readings",
        collectedAt: "2026-07-13T08:15:00.000Z",
        creates: [{ measurementCode: "weight", value: 78, unit: "kg", note: "Added" }],
        updates: [{
          id: "observation-z",
          measurementCode: "weight",
          value: 80,
          unit: "kg",
          note: "Corrected"
        }],
        removals: []
      });

      expect(updated).toMatchObject({
        label: "Morning readings",
        collectedAt: "2026-07-13T08:15:00.000Z"
      });
      expect(updated!.observations).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "observation-z", observedAt: "2026-07-13T08:15:00.000Z", value: 80, note: "Corrected" }),
        expect.objectContaining({ id: "observation-distinct", observedAt: "2026-07-12T10:04:00.000Z" }),
        expect.objectContaining({ observedAt: "2026-07-13T08:15:00.000Z", value: 78, note: "Added" })
      ]));
      const beforeRejectedUpdate = await repository.snapshot();
      await expect(repository.updateObservationGroup("group-1", {
        expectedCollectedAt: "2026-07-12T10:02:00.000Z",
        label: "Should not persist",
        collectedAt: "2026-07-14T08:15:00.000Z",
        creates: [],
        updates: [],
        removals: []
      })).rejects.toThrow("changed before these edits");
      expect(await repository.snapshot()).toEqual(beforeRejectedUpdate);
      expect(beforeRejectedUpdate.auditEvents[0]).toMatchObject({ eventType: "observation-group-updated" });
    } finally {
      await repository.close();
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("exports every backup collection through bounded stable pages", async () => {
    const databasePath = join(root, "databases", "health-store-paged-export.duckdb-poc");
    const fixture = createDuckDbHealthStoreFixture();
    const repository = await DuckDbRepository.hydrate(root, databasePath, key, fixture, { httpfsExtensionPath });
    try {
      const metadata = await repository.backupExportMetadata();
      expect(metadata).toEqual({ schemaVersion: fixture.schemaVersion, profile: fixture.profile });

      for (const collection of backupExportCollections) {
        const exported: unknown[] = [];
        let offset = 0;
        while (true) {
          const page = await repository.backupExportPage(collection, offset, 2);
          expect(page.items.length).toBeLessThanOrEqual(2);
          exported.push(...page.items);
          offset += page.items.length;
          if (page.done) break;
        }
        expect(exported, collection).toEqual(fixture[collection]);
      }
    } finally {
      await repository.close();
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("invalidates cached storage counts only after successful count-changing commits", async () => {
    const databasePath = join(root, "databases", "health-store-count-cache.duckdb-poc");
    const fixture = createDuckDbHealthStoreFixture();
    let countReads = 0;
    let failCommit = false;
    const repository = await DuckDbRepository.hydrate(root, databasePath, key, fixture, {
      httpfsExtensionPath,
      testHooks: {
        beforeStorageCountsRead: () => { countReads += 1; },
        beforeTransactionCommit: async () => {
          if (failCommit) throw new Error("Injected commit failure");
        }
      }
    });
    try {
      const initial = await repository.storageCounts();
      expect(countReads).toBe(1);

      await repository.replaceProfile({ ...fixture.profile, displayName: "Metadata-only update" });
      expect(await repository.storageCounts()).toEqual(initial);
      expect(countReads).toBe(1);

      const created = await repository.createHealthEvent({
        kind: "immunization",
        status: "completed",
        occurredAt: "2026-08-05T09:00:00.000Z",
        provider: "Local Clinic"
      });
      expect((await repository.storageCounts()).healthEvents).toBe(initial.healthEvents + 1);
      expect(countReads).toBe(2);

      failCommit = true;
      await expect(repository.deleteHealthEvent(created.healthEvent.id)).rejects.toThrow("Injected commit failure");
      expect((await repository.storageCounts()).healthEvents).toBe(initial.healthEvents + 1);
      expect(countReads).toBe(2);
    } finally {
      await repository.close();
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("projects paged sleep sessions with repaired stage gaps", async () => {
    const databasePath = join(root, "databases", "health-store-sleep-sessions.duckdb-poc");
    const fixture = createDuckDbHealthStoreFixture();
    fixture.timeSeriesSamples.push({
      id: "sleep-partial",
      measurementCode: "sleep_duration",
      startAt: "2026-08-01T22:00:00.000Z",
      endAt: "2026-08-02T06:00:00.000Z",
      value: 480,
      unit: "min",
      sourceId: "source-1",
      sourceJson: {
        stages: [
          { startTime: "2026-08-01T22:15:00.000Z", endTime: "2026-08-02T03:00:00.000Z", stage: 4 },
          { startTime: "2026-08-02T02:30:00.000Z", endTime: "2026-08-02T04:00:00.000Z", stage: 5 },
          { startTime: "2026-08-02T04:00:00.000Z", endTime: "2026-08-02T04:30:00.000Z", stage: 0 },
          { startTime: "2026-08-02T04:30:00.000Z", endTime: "2026-08-02T06:00:00.000Z", stage: 6 }
        ]
      }
    }, {
      id: "sleep-available",
      measurementCode: "sleep_duration",
      startAt: "2026-08-02T22:00:00.000Z",
      endAt: "2026-08-03T06:00:00.000Z",
      value: 480,
      unit: "min",
      sourceId: "source-1",
      sourceJson: {
        title: "A complete night",
        stages: [
          { startTime: "2026-08-02T22:00:00.000Z", endTime: "2026-08-03T02:00:00.000Z", stage: 4 },
          { startTime: "2026-08-03T02:00:00.000Z", endTime: "2026-08-03T04:00:00.000Z", stage: 5 },
          { startTime: "2026-08-03T04:00:00.000Z", endTime: "2026-08-03T06:00:00.000Z", stage: 6 }
        ]
      }
    });
    const repository = await DuckDbRepository.hydrate(root, databasePath, key, fixture, { httpfsExtensionPath });

    try {
      const newest = await repository.sleepSessions({ limit: 1, offset: 0 });
      expect(newest).toMatchObject({ total: 2, limit: 1, offset: 0, hasMore: true });
      expect(newest.sessions).toEqual([expect.objectContaining({
        id: "sleep-available",
        title: "A complete night",
        stageDataStatus: "available",
        stages: [
          { startAt: "2026-08-02T22:00:00.000Z", endAt: "2026-08-03T02:00:00.000Z", stage: "light" },
          { startAt: "2026-08-03T02:00:00.000Z", endAt: "2026-08-03T04:00:00.000Z", stage: "deep" },
          { startAt: "2026-08-03T04:00:00.000Z", endAt: "2026-08-03T06:00:00.000Z", stage: "rem" }
        ]
      })]);

      const older = await repository.sleepSessions({ limit: 1, offset: 1 });
      expect(older.sessions[0]).toMatchObject({
        id: "sleep-partial",
        stageDataStatus: "partial",
        stages: [
          { startAt: "2026-08-01T22:00:00.000Z", endAt: "2026-08-01T22:15:00.000Z", stage: "gap" },
          { startAt: "2026-08-01T22:15:00.000Z", endAt: "2026-08-02T03:00:00.000Z", stage: "light" },
          { startAt: "2026-08-02T03:00:00.000Z", endAt: "2026-08-02T04:00:00.000Z", stage: "deep" },
          { startAt: "2026-08-02T04:00:00.000Z", endAt: "2026-08-02T04:30:00.000Z", stage: "gap" },
          { startAt: "2026-08-02T04:30:00.000Z", endAt: "2026-08-02T06:00:00.000Z", stage: "rem" }
        ]
      });
    } finally {
      await repository.close();
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("enriches existing sleep sessions without overwriting stages on retries", async () => {
    const databasePath = join(root, "databases", "health-store-sleep-enrichment.duckdb-poc");
    const repository = await DuckDbRepository.hydrate(
      root,
      databasePath,
      key,
      createDuckDbHealthStoreFixture(),
      { httpfsExtensionPath }
    );
    const request = {
      syncedAt: "2026-08-03T06:05:00.000Z",
      rangeStart: "2026-08-02T00:00:00.000Z",
      rangeEnd: "2026-08-03T12:00:00.000Z",
      deviceLabel: "Pixel 8",
      steps: [], heartRate: [], restingHeartRate: [], oxygenSaturation: [], hrvRmssd: [], respiratoryRate: [],
      basalMetabolicRateKcalDay: [], heightCm: [], skinTemperatureC: [], vo2MaxMlKgMin: [], weightKg: [],
      exerciseSessions: [], distanceMeters: [], activeCaloriesKcal: [], totalCaloriesKcal: [], bodyFatPct: [],
      sleepSessions: [{
        startTime: "2026-08-02T22:00:00.000Z",
        endTime: "2026-08-03T06:00:00.000Z",
        durationMinutes: 480
      }]
    };

    try {
      const initial = await repository.mergeImport(parseHealthConnectImport(healthConnectImportRequestSchema.parse(request)));
      const enriched = await repository.mergeImport(parseHealthConnectImport(healthConnectImportRequestSchema.parse({
        ...request,
        batchId: "staged",
        syncedAt: "2026-08-03T06:10:00.000Z",
        sleepSessions: [{
          ...request.sleepSessions[0],
          stages: [
            { startTime: "2026-08-02T22:00:00.000Z", endTime: "2026-08-03T02:00:00.000Z", stage: 4 },
            { startTime: "2026-08-03T02:00:00.000Z", endTime: "2026-08-03T06:00:00.000Z", stage: 5 }
          ]
        }]
      })));
      const retry = await repository.mergeImport(parseHealthConnectImport(healthConnectImportRequestSchema.parse({
        ...request,
        batchId: "stage-less-retry",
        syncedAt: "2026-08-03T06:15:00.000Z"
      })));

      expect(initial.outcome.timeSeriesSamples).toMatchObject({ attempted: 1, accepted: 1, duplicates: 0 });
      expect(enriched.outcome.timeSeriesSamples).toMatchObject({ attempted: 1, accepted: 1, duplicates: 0 });
      expect(retry.outcome.timeSeriesSamples).toMatchObject({ attempted: 1, accepted: 0, duplicates: 1 });
      expect((await repository.sleepSessions({ limit: 1, offset: 0 })).sessions).toEqual([expect.objectContaining({
        stageDataStatus: "available",
        stages: [
          { startAt: "2026-08-02T22:00:00.000Z", endAt: "2026-08-03T02:00:00.000Z", stage: "light" },
          { startAt: "2026-08-03T02:00:00.000Z", endAt: "2026-08-03T06:00:00.000Z", stage: "deep" }
        ]
      })]);
    } finally {
      await repository.close();
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("serves reads from a connection that never sees uncommitted writes", async () => {
    const databasePath = join(root, "databases", "health-store-read-isolation.duckdb-poc");
    const fixture = createDuckDbHealthStoreFixture();
    let duringTransaction: string | undefined;
    const repository = await DuckDbRepository.hydrate(root, databasePath, key, fixture, {
      httpfsExtensionPath,
      testHooks: {
        // Runs while the write transaction is still open, so a read here must see the old state.
        beforeTransactionCommit: async () => {
          duringTransaction = (await repository.getProfile()).displayName;
        }
      }
    });
    const original = (await repository.getProfile()).displayName;
    try {
      await repository.replaceProfile({ ...fixture.profile, displayName: "Renamed mid-transaction" });
      expect(duringTransaction).toBe(original);
      expect((await repository.getProfile()).displayName).toBe("Renamed mid-transaction");
    } finally {
      await repository.close();
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("applies resumable migration batches with provenance-aware deduplication", async () => {
    const databasePath = join(root, "databases", "mobile-migration.duckdb-poc");
    const fixture = createDuckDbHealthStoreFixture();
    const repository = await DuckDbRepository.hydrate(root, databasePath, key, fixture, { httpfsExtensionPath });
    const manifest = {
      protocolVersion: 1 as const,
      datasetId: "mobile-dataset",
      datasetFingerprint: "standalone:mobile-dataset",
      sourceProfileId: "mobile-profile",
      counts: { sourceImports: 1, dataSources: 2, observationGroups: 0, observations: 3 }
    };

    try {
      const started = await repository.startMobileMigration("pairing-1", manifest);
      const batch = {
        protocolVersion: 1 as const,
        sessionId: started.sessionId,
        batchId: "batch-1",
        sourceImports: [{
          ...fixture.sourceImports[0]!,
          id: "mobile-import",
          rawContent: undefined
        }],
        dataSources: [{
          id: "mobile-source-same",
          sourceKind: "manual-entry" as const,
          label: "Same provenance",
          importId: "mobile-import",
          createdAt: "2026-07-25T00:00:00.000Z"
        }, {
          id: "mobile-source-other",
          sourceKind: "manual-entry" as const,
          label: "Independent source",
          createdAt: "2026-07-25T00:00:00.000Z"
        }],
        observationGroups: [],
        observations: [{
          ...fixture.observations[0]!,
          id: "mobile-semantic-duplicate",
          sourceId: "mobile-source-same",
          observationGroupId: undefined,
          deviceId: undefined,
          value: fixture.observations[0]!.value * 2.2046226218487757,
          unit: "lb"
        }, {
          ...fixture.observations[0]!,
          id: "mobile-cross-source-lookalike",
          sourceId: "mobile-source-other",
          observationGroupId: undefined,
          deviceId: undefined
        }, {
          ...fixture.observations[0]!,
          value: fixture.observations[0]!.value + 1,
          sourceId: "mobile-source-same",
          observationGroupId: undefined,
          deviceId: undefined
        }]
      };

      const acknowledgement = await repository.applyMobileMigrationBatch("pairing-1", batch);
      expect(acknowledgement.counts).toEqual({ accepted: 3, duplicates: 2, conflicts: 1 });
      expect(acknowledgement.duplicates).toEqual([
        expect.objectContaining({ entityType: "sourceImport", classification: "source-import-identity" }),
        expect.objectContaining({ entityType: "observation", classification: "canonical-observation" })
      ]);
      expect(acknowledgement.conflicts).toEqual([
        expect.objectContaining({ entityType: "observation", entityId: fixture.observations[0]!.id })
      ]);
      expect(await repository.applyMobileMigrationBatch("pairing-1", batch)).toEqual(acknowledgement);
      const receipt = await repository.completeMobileMigration("pairing-1", started.sessionId);
      expect(receipt.counts).toEqual(acknowledgement.counts);
      expect(await repository.completeMobileMigration("pairing-1", started.sessionId)).toEqual(receipt);
      expect((await repository.snapshot()).observations.some((entry) => entry.id === "mobile-cross-source-lookalike")).toBe(true);
      expect((await repository.snapshot()).observations.some((entry) => entry.id === "mobile-semantic-duplicate")).toBe(false);
    } finally {
      await repository.close();
    }
  });

  it.skipIf(!httpfsExtensionPath)("resumes and replays chunked Health Connect sync", async () => {
    const databasePath = join(root, "databases", "health-connect-sync.duckdb-poc");
    const options = { httpfsExtensionPath };
    const start = {
      sessionKey: "device-1:2026-07-02T00:00:00.000Z",
      deviceLabel: "android-companion:device-1",
      rangeStart: "2026-07-01T00:00:00.000Z",
      rangeEnd: "2026-07-02T00:00:00.000Z"
    };
    const chunk = () => parseHealthConnectImport(healthConnectImportRequestSchema.parse({
      syncedAt: "2026-07-02T00:00:00.000Z",
      rangeStart: start.rangeStart,
      rangeEnd: start.rangeEnd,
      deviceLabel: start.deviceLabel,
      batchId: "chunk-1",
      weightKg: [{ time: "2026-07-01T06:00:00.000Z", value: 80 }]
    }));

    const repository = await DuckDbRepository.hydrate(root, databasePath, key, createDuckDbHealthStoreFixture(), options);
    try {
      const session = await repository.startHealthConnectSyncSession("pairing-hc", start);
      expect(session.processedBatchIds).toEqual([]);
      // A phone that lost its session id resends the same key and must get the same session back.
      expect((await repository.startHealthConnectSyncSession("pairing-hc", start)).sessionId).toBe(session.sessionId);

      const acknowledgement = await repository.applyHealthConnectSyncChunk("pairing-hc", session.sessionId, "chunk-1", chunk());
      expect(acknowledgement).toMatchObject({ sessionId: session.sessionId, batchId: "chunk-1" });
      expect(acknowledgement!.counts.accepted).toBeGreaterThan(0);
      const afterFirst = (await repository.snapshot()).observations.length;

      // A retry after a lost response replays the stored answer instead of importing again.
      expect(await repository.applyHealthConnectSyncChunk("pairing-hc", session.sessionId, "chunk-1", chunk())).toEqual(acknowledgement);
      expect((await repository.snapshot()).observations.length).toBe(afterFirst);

      expect((await repository.startHealthConnectSyncSession("pairing-hc", start)).processedBatchIds).toEqual(["chunk-1"]);
      expect(await repository.applyHealthConnectSyncChunk("pairing-hc", "unknown-session", "chunk-2", chunk())).toBeUndefined();
    } finally {
      await repository.close();
    }
  });

  it.skipIf(!httpfsExtensionPath)("rolls back failed batches and resumes processed batches after reopen", async () => {
    const databasePath = join(root, "databases", "mobile-migration-resume.duckdb-poc");
    const fixture = createDuckDbHealthStoreFixture();
    const options = { httpfsExtensionPath };
    const manifest = {
      protocolVersion: 1 as const,
      datasetId: "resume-dataset",
      datasetFingerprint: "standalone:resume-dataset",
      sourceProfileId: "resume-profile",
      counts: { sourceImports: 1, dataSources: 1, observationGroups: 0, observations: 1 }
    };
    const sourceImport = {
      ...fixture.sourceImports[0]!,
      id: "resume-import",
      checksum: "resume-checksum",
      fileName: "resume.json",
      rawContent: undefined
    };
    const dataSource = {
      id: "resume-source",
      sourceKind: "manual-entry" as const,
      label: "Resume source",
      importId: sourceImport.id,
      createdAt: "2026-07-25T00:00:00.000Z"
    };

    const first = await DuckDbRepository.hydrate(root, databasePath, key, fixture, options);
    let sessionId: string;
    try {
      const started = await first.startMobileMigration("pairing-resume", manifest);
      sessionId = started.sessionId;
      await expect(first.applyMobileMigrationBatch("pairing-resume", {
        protocolVersion: 1,
        sessionId,
        batchId: "failed-source",
        sourceImports: [sourceImport],
        dataSources: [{ ...dataSource, createdAt: "not-a-timestamp" }],
        observationGroups: [],
        observations: []
      })).rejects.toThrow();
      expect((await first.snapshot()).sourceImports.some((entry) => entry.id === sourceImport.id)).toBe(false);

      await first.applyMobileMigrationBatch("pairing-resume", {
        protocolVersion: 1,
        sessionId,
        batchId: "source-graph",
        sourceImports: [sourceImport],
        dataSources: [dataSource],
        observationGroups: [],
        observations: []
      });
    } finally {
      await first.close();
    }

    const reopened = await DuckDbRepository.open(root, databasePath, key, options);
    try {
      const resumed = await reopened.startMobileMigration("pairing-resume", manifest);
      expect(resumed).toMatchObject({
        sessionId: sessionId!,
        processedBatchIds: ["source-graph"],
        completed: false
      });
      await reopened.applyMobileMigrationBatch("pairing-resume", {
        protocolVersion: 1,
        sessionId: sessionId!,
        batchId: "observations",
        sourceImports: [],
        dataSources: [],
        observationGroups: [],
        observations: [{
          ...fixture.observations[0]!,
          id: "resume-observation",
          sourceId: dataSource.id,
          observationGroupId: undefined,
          deviceId: undefined
        }]
      });
      await expect(reopened.completeMobileMigration("pairing-resume", sessionId!)).resolves.toMatchObject({
        counts: { accepted: 3, duplicates: 0, conflicts: 0 }
      });
    } finally {
      await reopened.close();
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("keeps profile photos encrypted, isolated, and outside exports", async () => {
    const firstPath = join(root, "databases", "health-store-photo-first.duckdb-poc");
    const secondPath = join(root, "databases", "health-store-photo-second.duckdb-poc");
    const first = await DuckDbRepository.hydrate(root, firstPath, key, createDuckDbHealthStoreFixture(), { httpfsExtensionPath });
    const secondFixture = createDuckDbHealthStoreFixture();
    secondFixture.profile.id = "second";
    const second = await DuckDbRepository.hydrate(root, secondPath, key, secondFixture, { httpfsExtensionPath });
    const original = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64 * 1024, 1), Buffer.from([0xff, 0xd9])]);
    const replacement = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), Buffer.alloc(64 * 1024, 2), Buffer.from([0xff, 0xd9])]);

    try {
      expect(await first.schemaVersions()).toEqual([1, 2, 3, 4, 5, 6]);
      const created = await first.replaceProfilePhoto("image/jpeg", original);
      expect(created.revision).toBe(createHash("sha256").update(original).digest("hex"));
      expect(await second.getProfilePhoto()).toBeUndefined();
      expect(await first.exportData()).not.toHaveProperty("profilePhoto");

      const replaced = await first.replaceProfilePhoto("image/jpeg", replacement);
      expect(replaced.revision).not.toBe(created.revision);
      expect((await first.getProfilePhoto())?.bytes).toEqual(replacement);
      expect(await first.deleteProfilePhoto()).toBe(true);
      expect(await first.getProfilePhoto()).toBeUndefined();
      expect(await first.deleteProfilePhoto()).toBe(false);
    } finally {
      await Promise.all([first.close(), second.close()]);
    }

    const reopened = await DuckDbRepository.open(root, firstPath, key, { httpfsExtensionPath });
    try {
      expect(await reopened.getProfilePhoto()).toBeUndefined();
    } finally {
      await reopened.close();
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("exposes care data through the AI views without retired columns", async () => {
    const databasePath = join(root, "databases", "health-store-care-views.duckdb-poc");
    const options = { httpfsExtensionPath };
    await createDuckDbSchema(root, databasePath, key, options);
    const database = await openEncryptedDuckDbDatabase(root, databasePath, key, options);
    try {
      await execSql(database.connection, `
        INSERT INTO health_events VALUES
          (0, 'event-completion', 'visit', 'completed', TIMESTAMPTZ '2026-07-20 10:00:00Z', 'manual-entry', 'Clinic', 'Completed visit', NULL);
        INSERT INTO care_items VALUES
          (0, 'care-completed', 'visit', NULL, 'Annual check-up', TIMESTAMPTZ '2026-07-20 09:00:00Z', NULL, 'normal', 'completed', NULL, NULL, 'Keep this note', 'event-completion', TIMESTAMPTZ '2026-07-20 10:00:00Z');
      `);

      const eventColumns = await querySql(database.connection, "SELECT column_name FROM information_schema.columns WHERE table_name = 'health_events' ORDER BY column_name;");
      const careColumns = await querySql(database.connection, "SELECT column_name FROM information_schema.columns WHERE table_name = 'care_items' ORDER BY column_name;");
      expect(eventColumns.map((row) => row.column_name)).not.toContain("occurred_end");
      expect(careColumns.map((row) => row.column_name)).not.toContain("due_end");
      expect(careColumns.map((row) => row.column_name)).not.toContain("originating_health_event_id");
      expect(await querySql(database.connection, "SELECT id, notes FROM health_events;")).toEqual([
        { id: "event-completion", notes: "Completed visit" }
      ]);
      expect(await querySql(database.connection, "SELECT id, notes, completed_health_event_id FROM care_items;")).toEqual([
        { id: "care-completed", notes: "Keep this note", completed_health_event_id: "event-completion" }
      ]);
      expect(await querySql(database.connection, "SELECT id, occurred_at FROM v_ai_health_events;")).toHaveLength(1);
      expect(await querySql(database.connection, "SELECT id, due_start FROM v_ai_care_items;")).toHaveLength(1);
    } finally {
      await closeEncryptedDuckDbDatabase(database);
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("refreshes changed registry metadata on launch without changing user-owned data", async () => {
    const databasePath = join(root, "databases", "health-store-registry-reset.duckdb-poc");
    const fixture = createDuckDbHealthStoreFixture();
    const weight = fixture.measurementTypes.find((type) => type.code === "weight");
    if (!weight) throw new Error("Weight measurement type is missing from fixture.");
    weight.display = "Legacy weight";
    weight.description = "Legacy description";
    weight.aliases = ["legacy weight"];
    fixture.measurementTypes.push({
      code: "custom_grip_score",
      display: "Custom grip score",
      description: "A user-defined grip score.",
      category: "derived",
      kind: "point",
      canonicalUnit: "score",
      aliases: [],
      aggregation: "latest"
    });
    const observations = structuredClone(fixture.observations);
    const personalReferenceRanges = structuredClone(fixture.personalReferenceRanges);
    const hydrated = await DuckDbRepository.hydrate(root, databasePath, key, fixture, { httpfsExtensionPath });
    await hydrated.close();
    const legacyDatabase = await openEncryptedDuckDbDatabase(root, databasePath, key, { httpfsExtensionPath });
    try {
      await execSql(legacyDatabase.connection, "DELETE FROM schema_objects WHERE name = 'measurement_registry';");
    } finally {
      await closeEncryptedDuckDbDatabase(legacyDatabase);
    }
    const repository = await DuckDbRepository.open(root, databasePath, key, { httpfsExtensionPath });

    try {
      const expectedWeight = defaultMeasurementTypes.find((type) => type.code === "weight");
      if (!expectedWeight) throw new Error("Weight is missing from the default registry.");
      const measurementTypes = (await repository.appBootstrap()).measurementTypes;
      const refreshedWeight = measurementTypes.find((type) => type.code === "weight");

      expect(refreshedWeight).toEqual(expectedWeight);
      expect(measurementTypes).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "custom_grip_score", display: "Custom grip score" })
      ]));
      expect(measurementTypes.filter((type) => defaultMeasurementTypes.some((entry) => entry.code === type.code)))
        .toHaveLength(defaultMeasurementTypes.length);
      const snapshot = await repository.snapshot();
      expect(snapshot.observations).toEqual(observations);
      expect(snapshot.personalReferenceRanges).toEqual(personalReferenceRanges);
    } finally {
      await repository.close();
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("persists, replaces, and removes canonical personal reference ranges", async () => {
    const databasePath = join(root, "databases", "health-store-reference-range.duckdb-poc");
    const fixture = createDuckDbHealthStoreFixture();
    const repository = await DuckDbRepository.hydrate(root, databasePath, key, fixture, { httpfsExtensionPath });
    try {
      const initialDetail = await repository.measurementDetail("weight");
      expect(initialDetail.referenceRange).toMatchObject({
        source: "personal",
        personal: { low: 60, high: 90, unit: "kg" },
        optimal: { low: 65, high: 85, unit: "kg" }
      });
      expect(initialDetail.chartPoints[0]?.optimalRange).toEqual({ low: 65, high: 85, unit: "kg" });
      await repository.upsertPersonalReferenceRange("weight", { low: 130, high: 200, unit: "lb" });
      expect((await repository.snapshot()).personalReferenceRanges[0]).toMatchObject({
        measurementCode: "weight",
        normalLow: expect.closeTo(58.967, 3),
        normalHigh: expect.closeTo(90.718, 3),
        optimalLow: 65,
        optimalHigh: 85,
        unit: "kg"
      });
      await repository.upsertPersonalReferenceRange("weight", {
        low: 120, high: 210, optimalLow: 150, optimalHigh: 190, unit: "lb"
      });
      expect((await repository.snapshot()).personalReferenceRanges[0]).toMatchObject({
        normalLow: expect.closeTo(54.431, 3),
        normalHigh: expect.closeTo(95.254, 3),
        optimalLow: expect.closeTo(68.039, 3),
        optimalHigh: expect.closeTo(86.183, 3),
        unit: "kg"
      });
      const detail = await repository.measurementDetail("weight");
      const chart = await repository.measurementChartSeries("weight", { range: "all", mode: "raw" });
      expect(detail.referenceRange.optimal).toMatchObject({ low: expect.closeTo(68.039, 3), high: expect.closeTo(86.183, 3) });
      expect(detail.entries[0]?.status).toBe("normal");
      expect(chart.points[0]?.optimalRange).toMatchObject({ low: expect.closeTo(68.039, 3), high: expect.closeTo(86.183, 3) });
      await repository.upsertPersonalReferenceRange("weight", {
        low: 120, high: 210, optimalLow: null, optimalHigh: null, unit: "lb"
      });
      expect((await repository.snapshot()).personalReferenceRanges[0]).not.toHaveProperty("optimalLow");
      expect((await repository.measurementDetail("weight")).referenceRange).not.toHaveProperty("optimal");
      expect((await repository.deletePersonalReferenceRange("weight")).source).toBe("catalog");
      expect((await repository.snapshot()).personalReferenceRanges).toEqual([]);
    } finally {
      await repository.close();
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("persists idempotent pins independently of measurement data", async () => {
    const databasePath = join(root, "databases", "health-store-pins.duckdb-poc");
    const fixture = createDuckDbHealthStoreFixture();
    let repository = await DuckDbRepository.hydrate(root, databasePath, key, fixture, { httpfsExtensionPath });
    try {
      const first = await repository.pinMeasurement("weight");
      const second = await repository.pinMeasurement("weight");
      expect(second).toEqual(first);
      expect((await repository.analyticsSummary()).latestMetrics[0]).toMatchObject({ code: "weight", isPinned: true });
      expect((await repository.measurementDetail("weight")).isPinned).toBe(true);

      await repository.deleteObservationsByMeasurementCode("weight");
      const snapshot = await repository.snapshot();
      expect(snapshot.pinnedMeasurements).toEqual([{
        measurementCode: "weight",
        pinnedAt: first.pinnedAt
      }]);
      expect(snapshot.auditEvents.filter((event) => event.eventType === "measurement-pinned")).toHaveLength(1);

      await repository.close();
      repository = await DuckDbRepository.open(root, databasePath, key, { httpfsExtensionPath });
      expect((await repository.snapshot()).pinnedMeasurements).toEqual(snapshot.pinnedMeasurements);
      expect(await repository.unpinMeasurement("weight")).toEqual({ measurementCode: "weight", isPinned: false });
      expect(await repository.unpinMeasurement("weight")).toEqual({ measurementCode: "weight", isPinned: false });
      const unpinned = await repository.snapshot();
      expect(unpinned.pinnedMeasurements).toEqual([]);
      expect(unpinned.auditEvents.filter((event) => event.eventType === "measurement-unpinned")).toHaveLength(1);
    } finally {
      await repository.close();
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("creates and rehydrates care items", async () => {
    const databasePath = join(root, "databases", "health-store-care-item.duckdb-poc");
    const fixture = createDuckDbHealthStoreFixture();
    const repository = await DuckDbRepository.hydrate(root, databasePath, key, fixture, { httpfsExtensionPath });
    let snapshot: HealthStoreData | undefined;
    const dueStart = "2026-08-18T14:00:00.000Z";
    const reminderAt = careItemReminderAt(dueStart, "one-week");
    if (!reminderAt) throw new Error("Expected a reminder timestamp.");
    try {
      const created = await repository.createCareItem({
        kind: "visit",
        title: "Annual check-up",
        dueStart,
        reminderAt,
        priority: "normal",
        status: "open"
      });
      expect(created.careItem).toMatchObject({
        kind: "visit",
        title: "Annual check-up",
        dueStart,
        reminderAt,
        priority: "normal",
        status: "open"
      });
      expect((await repository.listCareItems({})).items).toEqual([created.careItem]);
      snapshot = await repository.snapshot();
    } finally {
      await repository.close();
    }

    if (!snapshot) throw new Error("Expected a care-item snapshot.");
    const rehydratedPath = join(root, "databases", "health-store-care-item-rehydrated.duckdb-poc");
    const rehydrated = await DuckDbRepository.hydrate(root, rehydratedPath, key, snapshot, { httpfsExtensionPath });
    try {
      expect((await rehydrated.listCareItems({})).items).toEqual([
        expect.objectContaining({
          title: "Annual check-up",
          dueStart,
          reminderAt
        })
      ]);
    } finally {
      await rehydrated.close();
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("completes only open care items and preserves completion provenance", async () => {
    const databasePath = join(root, "databases", "health-store-care-completion.duckdb-poc");
    const repository = await DuckDbRepository.hydrate(
      root,
      databasePath,
      key,
      createDuckDbHealthStoreFixture(),
      { httpfsExtensionPath }
    );
    try {
      const initialReplicaMark = await repository.getReplicaHighWaterMark();
      const created = await repository.createCareItem({
        kind: "visit",
        title: "Annual check-up",
        dueStart: "2026-08-18T14:00:00.000Z",
        priority: "normal",
        status: "open"
      });
      const cancelled = await repository.createCareItem({
        kind: "visit",
        title: "Cancelled dental visit",
        priority: "normal",
        status: "cancelled"
      });
      expect((await repository.getReplicaHighWaterMark()).sequence).toBeGreaterThan(initialReplicaMark.sequence);

      expect((await repository.listCareItems({ kind: "visit", status: "open" })).items).toEqual([created.careItem]);
      await expect(repository.createCareItem({
        kind: "other",
        title: "Invalid completed item",
        priority: "normal",
        status: "completed"
      })).rejects.toThrow("completion endpoint");
      await expect(repository.updateCareItem(created.careItem.id, {
        title: created.careItem.title,
        kind: "visit",
        dueStart: created.careItem.dueStart,
        priority: created.careItem.priority,
        status: "completed"
      })).rejects.toThrow("completion endpoint");
      expect(await repository.completeCareItem("missing-care-item", {
        occurredAt: "2026-07-25T09:30:00.000Z",
        kind: "visit"
      })).toBeUndefined();
      await expect(repository.completeCareItem(cancelled.careItem.id, {
        occurredAt: "2026-07-25T09:30:00.000Z",
        kind: "visit"
      })).rejects.toThrow("Only open care items");

      const completed = await repository.completeCareItem(created.careItem.id, {
        occurredAt: "2026-07-25T09:30:00.000Z",
        kind: "visit"
      });
      expect(completed).toMatchObject({
        careItem: {
          id: created.careItem.id,
          status: "completed",
          completedAt: "2026-07-25T09:30:00.000Z",
          completedHealthEventId: expect.stringMatching(/^event_/),
          completedHealthEvent: { kind: "visit", occurredAt: "2026-07-25T09:30:00.000Z" }
        },
        healthEvent: {
          kind: "visit",
          status: "completed",
          occurredAt: "2026-07-25T09:30:00.000Z",
          source: "manual-entry",
          notes: "Completed care item: Annual check-up."
        }
      });
      expect(completed?.counts.healthEvents).toBe((createDuckDbHealthStoreFixture().healthEvents ?? []).length + 1);
      const completionMark = await repository.getReplicaHighWaterMark();
      const completionDeltas = await repository.replicaDeltaPage(
        initialReplicaMark.sequence,
        completionMark.sequence,
        100
      );
      const completedCareDelta = completionDeltas.changes.find((change) =>
        change.entityType === "care-item"
        && change.entityId === created.careItem.id
        && change.payload?.status === "completed");
      const snapshotCareItem = (await repository.snapshot()).careItems?.find((item) => item.id === created.careItem.id);
      expect(completedCareDelta?.payload).toEqual(snapshotCareItem);
      expect(completedCareDelta?.payload).not.toHaveProperty("completedHealthEvent");
      await expect(repository.completeCareItem(created.careItem.id, {
        occurredAt: "2026-07-25T09:30:00.000Z",
        kind: "visit"
      })).rejects.toThrow("Only open care items");

      const edited = await repository.updateCareItem(created.careItem.id, {
        title: "Annual check-up reviewed",
        kind: "visit",
        priority: "high",
        status: "open"
      });
      expect(edited?.careItem).toMatchObject({
        status: "completed",
        completedAt: completed?.careItem.completedAt,
        completedHealthEventId: completed?.healthEvent?.id
      });
      const snapshot = await repository.snapshot();
      expect(snapshot.auditEvents.slice(0, 3).map((entry) => entry.eventType)).toEqual([
        "care-item-updated",
        "care-item-completed",
        "health-event-created"
      ]);
    } finally {
      await repository.close();
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("completes monitoring without creating a Health Event", async () => {
    const databasePath = join(root, "databases", "health-store-monitoring-completion.duckdb-poc");
    const repository = await DuckDbRepository.hydrate(
      root,
      databasePath,
      key,
      createDuckDbHealthStoreFixture(),
      { httpfsExtensionPath }
    );
    try {
      const before = await repository.storageCounts();
      const created = await repository.createCareItem({
        kind: "monitoring",
        title: "Review blood pressure readings",
        priority: "normal",
        status: "open"
      });
      const completed = await repository.completeCareItem(created.careItem.id, {
        occurredAt: "2026-07-25T09:30:00.000Z",
        kind: "other"
      });

      expect(completed).toMatchObject({
        careItem: {
          status: "completed",
          completedAt: "2026-07-25T09:30:00.000Z"
        },
        counts: { healthEvents: before.healthEvents }
      });
      expect(completed).not.toHaveProperty("healthEvent");
      expect(completed?.careItem).not.toHaveProperty("completedHealthEventId");
    } finally {
      await repository.close();
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("rolls back care completion records and audits together", async () => {
    const databasePath = join(root, "databases", "health-store-care-completion-rollback.duckdb-poc");
    const initial = await DuckDbRepository.hydrate(
      root,
      databasePath,
      key,
      createDuckDbHealthStoreFixture(),
      { httpfsExtensionPath }
    );
    const created = await initial.createCareItem({
      kind: "visit",
      title: "Review results",
      priority: "normal",
      status: "open"
    });
    const before = await initial.snapshot();
    await initial.close();

    const failing = await DuckDbRepository.open(root, databasePath, key, {
      httpfsExtensionPath,
      testHooks: { beforeTransactionCommit: async () => { throw new Error("Injected commit failure"); } }
    });
    try {
      await expect(failing.completeCareItem(created.careItem.id, {
        occurredAt: "2026-07-25T10:00:00.000Z",
        kind: "visit"
      })).rejects.toThrow("Injected commit failure");
    } finally {
      await failing.close();
    }

    const reopened = await DuckDbRepository.open(root, databasePath, key, { httpfsExtensionPath });
    try {
      const after = await reopened.snapshot();
      expect(after.healthEvents).toEqual(before.healthEvents);
      expect(after.careItems).toEqual(before.careItems);
      expect(after.auditEvents).toEqual(before.auditEvents);
    } finally {
      await reopened.close();
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("returns bounded startup data without materializing full health history", async () => {
    const databasePath = join(root, "databases", "health-store-bootstrap.duckdb-poc");
    const fixture = createDuckDbHealthStoreFixture();
    fixture.profile.units = "imperial";
    const repository = await DuckDbRepository.hydrate(root, databasePath, key, fixture, { httpfsExtensionPath });
    try {
      const bootstrap = await repository.appBootstrap();
      expect(bootstrap.profile).toEqual(fixture.profile);
      expect(bootstrap.measurementTypes).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: fixture.measurementTypes[0]?.code })
      ]));
      expect(bootstrap.counts).toEqual({
        imports: fixture.sourceImports.length,
        observations: fixture.observations.length,
        samples: fixture.timeSeriesSamples.length,
        activities: fixture.activitySessions.length,
        healthEvents: fixture.healthEvents?.length ?? 0,
        careItems: fixture.careItems?.length ?? 0
      });
      expect(bootstrap).not.toHaveProperty("observations");
      expect(bootstrap).not.toHaveProperty("sourceImports");
      const analytics = await repository.analyticsSummary();
      expect(analytics).toEqual(computeAnalytics({ ...fixture, counts: analyticsCountsFromStore(fixture) }));
      const reviewContext = await repository.insightReviewContext();
      expect(reviewContext.windowDays).toBe(30);
      expect(reviewContext.coverage.activeDays).toBeGreaterThanOrEqual(0);
      expect(reviewContext.trackedMetrics.length).toBeLessThanOrEqual(9);
      expect(reviewContext.activities.length).toBeLessThanOrEqual(12);
      expect(reviewContext.healthEvents.length).toBeLessThanOrEqual(12);
      expect(reviewContext.care).toEqual({
        open: expect.any(Number),
        overdue: expect.any(Number),
        highPriority: expect.any(Number)
      });
      const generatedAt = "2026-07-15T00:00:00.000Z";
      const biologicalAgeSource = await repository.biologicalAgeSource();
      expect(calculateBiologicalAge(biologicalAgeSource, generatedAt)).toEqual(calculateBiologicalAge(fixture, generatedAt));
      expect(new Set(biologicalAgeSource.observations.map((entry) => entry.measurementCode)).size)
        .toBe(biologicalAgeSource.observations.length);

      const sourceImports = await repository.clinicianReportSourceImports();
      expect(sourceImports).toEqual(fixture.sourceImports.map(({ fileName, sourceKind, importedAt, status, rowCount }) => ({
        fileName, sourceKind, importedAt, status, rowCount
      })));
      expect(JSON.stringify(sourceImports)).not.toContain("rawContent");
      expect(await repository.clinicianReportLatestMeasurements()).toMatchObject([
        {
          category: "activity",
          displayName: "Activity sessions",
          measuredAt: "2026-07-12T09:30:00.000Z",
          activity: { activityType: "walking", durationMinutes: 30 }
        },
        {
          category: "body",
          displayName: "Weight",
          measuredAt: "2026-07-12T10:05:00.000Z",
          value: expect.closeTo(177.47, 2),
          unit: "lb"
        }
      ]);
      expect(buildClinicianReport({ profile: bootstrap.profile, analytics, sourceImports }, generatedAt)).toMatchObject({
        patient: { displayName: fixture.profile.displayName },
        totals: {
          observations: fixture.observations.length,
          samples: fixture.timeSeriesSamples.length,
          activities: fixture.activitySessions.length
        }
      });
    } finally {
      await repository.close();
    }
  }, 30_000);

  it("refuses to create an empty replacement when opening a missing database", async () => {
    const databasePath = join(root, "databases", "missing.duckdb-poc");

    await expect(DuckDbRepository.open(root, databasePath, key)).rejects.toThrow("refuses to create");
    expect(existsSync(databasePath)).toBe(false);
  });

  it.skipIf(!httpfsExtensionPath)("reconciles stale default measurement types when opening an existing profile", async () => {
    const databasePath = join(root, "databases", "health-store-legacy-registry.duckdb-poc");
    const fixture = createDuckDbHealthStoreFixture();
    const glucoseObservation = {
      ...fixture.observations[0],
      id: "legacy-glucose",
      measurementCode: "glucose",
      value: 5.2,
      unit: "mmol/L"
    };
    const bmiObservation = {
      ...fixture.observations[0],
      id: "legacy-bmi",
      measurementCode: "bmi",
      value: 21.1,
      unit: "kg/m2"
    };
    const totalCaloriesSample = {
      ...fixture.timeSeriesSamples[0],
      id: "legacy-total-calories",
      measurementCode: "total_calories_burned",
      value: 1_850,
      unit: "kcal"
    };
    const fixtureWithGlucose = {
      ...fixture,
      observations: [...fixture.observations, glucoseObservation, bmiObservation],
      timeSeriesSamples: [...fixture.timeSeriesSamples, totalCaloriesSample]
    };

    const hydrated = await DuckDbRepository.hydrate(root, databasePath, key, fixtureWithGlucose, { httpfsExtensionPath });
    await hydrated.close();
    const legacyHandle = await openEncryptedDuckDbDatabase(root, databasePath, key, { httpfsExtensionPath });
    await execSql(legacyHandle.connection, `
      UPDATE measurement_types
      SET category = 'metabolic', canonical_unit = 'mg/dL',
          custom_properties = '{"fhirCode":"2345-7","loincCode":"2345-7","normalLow":70,"normalHigh":99}'
      WHERE code = 'glucose';
      UPDATE measurement_types
      SET custom_properties = '{}'
      WHERE code = 'bmi';
      CHECKPOINT;
    `);
    await closeEncryptedDuckDbDatabase(legacyHandle);

    const repository = await DuckDbRepository.open(root, databasePath, key, { httpfsExtensionPath });
    try {
      expect((await repository.appBootstrap()).measurementTypes).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "glucose",
          category: "lab",
          canonicalUnit: "mmol/L",
          normalLow: 3.9,
          normalHigh: 5.5
        })
      ]));
      expect((await repository.appBootstrap()).measurementTypes).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "bmi",
          description: "A number calculated from your height and weight, used as a simple screening measure for weight status.",
          normalLow: 18.5,
          normalHigh: 24.9,
          referenceRanges: [{ low: 18.5, high: 24.9, unit: "kg/m2" }]
        })
      ]));
      const summary = await repository.summary();
      expect(summary.categories.flatMap((category) => category.rows)).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "glucose", category: "lab" }),
        expect.objectContaining({ code: "activity_sessions", category: "activity" }),
        expect.objectContaining({ code: "total_calories_burned", category: "activity" })
      ]));
    } finally {
      await repository.close();
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("hydrates, closes, and reopens every v2 collection with exact content and order", async () => {
    const databasePath = join(root, "databases", "health-store-profile-a.duckdb-poc");
    const fixture = createDuckDbHealthStoreFixture();
    const options = { httpfsExtensionPath };
    const hydrated = await DuckDbRepository.hydrate(root, databasePath, key, fixture, options);
    try {
      expect(await hydrated.snapshot()).toEqual(fixture);
    } finally {
      await hydrated.close();
    }

    const databaseHashBeforeWrongKey = hashFile(databasePath);
    await expect(DuckDbRepository.open(
      root,
      databasePath,
      Buffer.alloc(32, 8).toString("base64"),
      options
    )).rejects.toThrow();
    expect(hashFile(databasePath)).toBe(databaseHashBeforeWrongKey);

    const reopened = await DuckDbRepository.open(root, databasePath, key, options);
    let exported;
    try {
      exported = await reopened.snapshot();
    } finally {
      await reopened.close();
    }

    expect(exported).toEqual(fixture);
    expect(digestHealthStoreData(exported)).toBe(digestHealthStoreData(fixture));

    const corruptPath = join(root, "databases", "health-store-corrupt.duckdb-poc");
    copyFileSync(databasePath, corruptPath);
    const bytes = readFileSync(corruptPath);
    writeFileSync(corruptPath, bytes.subarray(0, Math.floor(bytes.length / 2)));
    const corruptHash = hashFile(corruptPath);

    await expect((async () => {
      let corruptRepository: DuckDbRepository | undefined;
      try {
        corruptRepository = await DuckDbRepository.open(root, corruptPath, key, options);
        await corruptRepository.snapshot();
      } finally {
        await corruptRepository?.close();
      }
    })()).rejects.toThrow();
    expect(hashFile(corruptPath)).toBe(corruptHash);
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("updates a profile transactionally and preserves it across reopen", async () => {
    const databasePath = join(root, "databases", "health-store-profile-update.duckdb-poc");
    const fixture = createDuckDbHealthStoreFixture();
    const options = { httpfsExtensionPath };
    const repository = await DuckDbRepository.hydrate(root, databasePath, key, fixture, options);
    const beforeDigest = digestHealthStoreData({ ...fixture, profile: fixture.profile, auditEvents: [] });
    let updated;
    try {
      updated = await repository.replaceProfile({
        ...fixture.profile,
        id: "attempted-id-change",
        displayName: "Updated Profile",
        units: "imperial"
      });
    } finally {
      await repository.close();
    }

    expect(updated.id).toBe(fixture.profile.id);
    expect(updated.displayName).toBe("Updated Profile");
    expect(updated.birthDate).toBe("1985-04-12");
    expect(updated.units).toBe("imperial");

    const reopened = await DuckDbRepository.open(root, databasePath, key, options);
    try {
      const snapshot = await reopened.snapshot();
      expect(snapshot.profile).toEqual(updated);
      expect(snapshot.auditEvents[0]).toMatchObject({
        eventType: "profile-updated",
        detail: "Profile details updated locally."
      });
      expect(snapshot.auditEvents.slice(1)).toEqual(fixture.auditEvents);
      expect(digestHealthStoreData({ ...snapshot, profile: fixture.profile, auditEvents: [] })).toBe(beforeDigest);
    } finally {
      await reopened.close();
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("serves Track summaries and details without materializing a full snapshot", async () => {
    const databasePath = join(root, "databases", "health-store-track-reads.duckdb-poc");
    const repository = await DuckDbRepository.hydrate(
      root,
      databasePath,
      key,
      createDuckDbHealthStoreFixture(),
      { httpfsExtensionPath }
    );
    const snapshotSpy = vi.spyOn(repository, "snapshot").mockRejectedValue(new Error("Track reads must not snapshot."));
    try {
      const summary = await repository.summary();
      const detail = await repository.measurementDetail("weight");
      const activities = await repository.measurementDetail("activity_sessions");
      const firstPage = await repository.measurementDetail("weight", { offset: 0, limit: 2 });

      expect(summary.totals).toMatchObject({ observations: 2, samples: 1, activities: 1, total: 4, types: 2 });
      expect(detail.measurement).toMatchObject({
        code: "weight",
        displayName: "Weight",
        description: "Your total body weight.",
        counts: { total: 3 }
      });
      expect(detail.entries.map((entry) => entry.id)).toEqual(["sample-1", "observation-a", "observation-z"]);
      expect(detail.entries[0]).toMatchObject({
        referenceRange: { low: 60, high: 90, unit: "kg" },
        status: "normal"
      });
      expect(detail.entries[2]).toMatchObject({
        sourceLabel: "Fixture source",
        importFileName: "fixture.csv",
        observationGroup: { id: "group-1", label: "Fixture group" },
        status: "normal"
      });
      expect(activities.entries[0]).toMatchObject({ id: "activity-1", note: "Type: walking • Energy: 120.5 kcal • Distance: 2500.0 m" });
      expect(firstPage.entries.map((entry) => entry.id)).toEqual(["sample-1", "observation-a"]);
      expect(firstPage.pagination).toEqual({ limit: 2, loaded: 2, total: 3, hasMore: true });
      expect(snapshotSpy).not.toHaveBeenCalled();
    } finally {
      await repository.close();
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("returns complete aggregation-aware chart series independently of detail pagination", async () => {
    const databasePath = join(root, "databases", "health-store-chart-series.duckdb-poc");
    const fixture = createDuckDbHealthStoreFixture();
    fixture.measurementTypes.push({
      code: "steps",
      display: "Steps",
      description: "The number of steps you have taken.",
      category: "activity",
      kind: "interval",
      canonicalUnit: "count",
      aliases: [],
      aggregation: "sum"
    });
    fixture.timeSeriesSamples.push(
      {
        ...fixture.timeSeriesSamples[0],
        id: "steps-1",
        measurementCode: "steps",
        startAt: "2026-07-10T01:00:00.000Z",
        endAt: "2026-07-10T01:05:00.000Z",
        value: 400,
        unit: "count"
      },
      {
        ...fixture.timeSeriesSamples[0],
        id: "steps-2",
        measurementCode: "steps",
        startAt: "2026-07-10T11:00:00.000Z",
        endAt: "2026-07-10T11:05:00.000Z",
        value: 600,
        unit: "count"
      },
      {
        ...fixture.timeSeriesSamples[0],
        id: "steps-3",
        measurementCode: "steps",
        startAt: "2026-07-11T01:00:00.000Z",
        endAt: "2026-07-11T01:05:00.000Z",
        value: 900,
        unit: "count"
      },
      {
        ...fixture.timeSeriesSamples[0],
        id: "steps-daily-aggregate",
        measurementCode: "steps",
        startAt: "2026-07-12T07:00:00.000Z",
        endAt: "2026-07-13T06:59:59.999Z",
        value: 1_200,
        unit: "count",
        sourceJson: { aggregation: "health-connect-daily", calendarDate: "2026-07-12" }
      }
    );
    const repository = await DuckDbRepository.hydrate(root, databasePath, key, fixture, { httpfsExtensionPath });
    const snapshotSpy = vi.spyOn(repository, "snapshot").mockRejectedValue(new Error("Chart reads must not snapshot."));
    try {
      const detail = await repository.measurementDetail("steps", { offset: 0, limit: 1 });
      const chart = await repository.measurementChartSeries("steps", { range: "all", mode: "auto" });
      const rawWeight = await repository.measurementChartSeries("weight", { range: "all", mode: "auto" });

      expect(detail.entries).toHaveLength(1);
      expect(chart).toMatchObject({ aggregation: "sum", granularity: "daily", totalPoints: 3, truncated: false });
      expect(chart.points).toEqual([
        expect.objectContaining({ timestamp: "2026-07-10T00:00:00.000Z", value: 1000, count: 2, minValue: 400, maxValue: 600 }),
        expect.objectContaining({ timestamp: "2026-07-11T00:00:00.000Z", value: 900, count: 1 }),
        expect.objectContaining({ timestamp: "2026-07-12T00:00:00.000Z", value: 1_200, count: 1 })
      ]);
      expect(rawWeight).toMatchObject({ aggregation: "latest", granularity: "raw", totalPoints: 3, truncated: false });
      expect(snapshotSpy).not.toHaveBeenCalled();
    } finally {
      await repository.close();
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("projects calendar data by source date, timezone, aggregation, and completed event status", async () => {
    const databasePath = join(root, "databases", "health-store-calendar.duckdb-poc");
    const fixture = createDuckDbHealthStoreFixture();
    const calendarObservation = {
      ...fixture.observations[0],
      id: "calendar-date-weight",
      observedAt: "2026-07-31T23:30:00.000Z",
      value: 81,
      sourceJson: { calendarDate: "2026-08-01" }
    };
    delete (calendarObservation as Partial<typeof calendarObservation>).observationGroupId;
    fixture.observations.push(calendarObservation);
    fixture.healthEvents = [{
      id: "completed-event",
      kind: "visit",
      status: "completed",
      occurredAt: "2026-08-01T07:30:00.000Z",
      source: "manual-entry"
    }, {
      id: "error-event",
      kind: "procedure",
      status: "entered-in-error",
      occurredAt: "2026-08-01T08:00:00.000Z",
      source: "manual-entry"
    }];
    const repository = await DuckDbRepository.hydrate(root, databasePath, key, fixture, { httpfsExtensionPath });
    const snapshotSpy = vi.spyOn(repository, "snapshot").mockRejectedValue(new Error("Calendar reads must not snapshot."));
    try {
      const calendar = await repository.calendarMonth({
        month: "2026-08",
        timezone: "America/Los_Angeles",
        measurementCodes: ["weight"]
      });
      expect(calendar.measurements).toEqual([expect.objectContaining({
        date: "2026-08-01",
        measurementCode: "weight",
        value: 81,
        count: 1,
        aggregation: "latest",
        sources: ["Fixture source"]
      })]);
      expect(calendar.events).toEqual([{ date: "2026-08-01", count: 1, kinds: ["visit"] }]);
      expect(snapshotSpy).not.toHaveBeenCalled();
    } finally {
      await repository.close();
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("returns complete local Journal days with steps, wake-up sleep, and cursor pagination", async () => {
    const databasePath = join(root, "databases", "health-store-journal.duckdb-poc");
    const fixture = createDuckDbHealthStoreFixture();
    fixture.measurementTypes.push(...defaultMeasurementTypes.filter((measurement) =>
      measurement.code === "steps" || measurement.code === "sleep_duration"
    ));
    fixture.timeSeriesSamples.push({
      id: "journal-steps",
      measurementCode: "steps",
      startAt: "2026-07-12T18:00:00.000Z",
      endAt: "2026-07-12T18:05:00.000Z",
      value: 700,
      unit: "count",
      sourceId: "source-1"
    }, {
      id: "journal-sleep",
      measurementCode: "sleep_duration",
      startAt: "2026-07-12T22:30:00.000Z",
      endAt: "2026-07-13T06:30:00.000Z",
      value: 480,
      unit: "min",
      sourceId: "source-1",
      sourceJson: { stages: [] }
    });
    fixture.healthEvents ??= [];
    fixture.healthEvents.push({
      id: "journal-event",
      kind: "visit",
      status: "completed",
      occurredAt: "2026-07-13T09:00:00.000Z",
      source: "manual-entry",
      provider: "Local clinic"
    });
    const repository = await DuckDbRepository.hydrate(root, databasePath, key, fixture, { httpfsExtensionPath });
    try {
      const newest = await repository.journal({ timezone: "UTC", dayLimit: 1 });
      const older = await repository.journal({ timezone: "UTC", dayLimit: 1, beforeDate: newest.nextBeforeDate });

      expect(newest).toMatchObject({
        timezone: "UTC",
        nextBeforeDate: "2026-07-13",
        days: [{
          date: "2026-07-13",
          summary: { sleepDurationMinutes: 480 },
          items: expect.arrayContaining([
            expect.objectContaining({ kind: "sleep", id: "journal-sleep", stageDataStatus: "unavailable" }),
            expect.objectContaining({ kind: "health-event", id: "journal-event", eventKind: "visit" })
          ])
        }]
      });
      expect(older).toMatchObject({
        days: [{
          date: "2026-07-12",
          summary: { steps: { value: 700, unit: "count", sources: ["Fixture source"] } },
          items: [expect.objectContaining({ kind: "activity", id: "activity-1" })]
        }]
      });
    } finally {
      await repository.close();
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("returns schema-compatible Body Trend date detail groups", async () => {
    const databasePath = join(root, "databases", "health-store-body-trend-detail.duckdb-poc");
    const fixture = createDuckDbHealthStoreFixture();
    const bodyCompositionCodes = new Set(["muscle_mass", "skeletal_muscle_mass", "fat_mass", "bone_mineral_content"]);
    fixture.measurementTypes.push(...defaultMeasurementTypes.filter((measurement) => bodyCompositionCodes.has(measurement.code)));
    fixture.observationGroups.push({
      id: "body-trend-group",
      kind: "body_composition_report",
      label: "Body composition report",
      sourceId: "source-1",
      collectedAt: "2026-08-01T09:00:00.000Z"
    });
    const bodyCompositionObservations: Array<[string, string, number]> = [
      ["body-muscle", "muscle_mass", 56.4],
      ["body-skeletal-muscle", "skeletal_muscle_mass", 31.6],
      ["body-fat", "fat_mass", 17.8],
      ["body-bone", "bone_mineral_content", 3.1]
    ];
    fixture.observations.push(...bodyCompositionObservations.map(([id, measurementCode, value]) => ({
      id,
      measurementCode,
      observedAt: "2026-08-01T09:00:00.000Z",
      value,
      unit: "kg",
      sourceId: "source-1",
      observationGroupId: "body-trend-group"
    })));
    const repository = await DuckDbRepository.hydrate(root, databasePath, key, fixture, { httpfsExtensionPath });
    try {
      const timeline = await repository.bodyTrendTimeline({ range: "all", timezone: "UTC" });
      const detail = await repository.bodyTrendDateDetail("2026-08-01", { timezone: "UTC" });

      expect(timeline.points).toEqual([expect.objectContaining({
        sessionId: "body-trend-group",
        components: expect.objectContaining({ muscleMass: 56.4, fatMass: 17.8, boneMineralContent: 3.1 })
      })]);
      expect(detail.selectedSession).toMatchObject({
        sessionId: "body-trend-group",
        metrics: expect.arrayContaining([
          expect.objectContaining({ measurementCode: "muscle_mass", observedAt: "2026-08-01T09:00:00.000Z" }),
          expect.objectContaining({ measurementCode: "skeletal_muscle_mass", observedAt: "2026-08-01T09:00:00.000Z" }),
          expect.objectContaining({ measurementCode: "fat_mass" }),
          expect.objectContaining({ measurementCode: "bone_mineral_content" })
        ])
      });
      expect(detail.selectedSession).not.toHaveProperty("date");
      expect(detail.otherReadings).toEqual([]);
    } finally {
      await repository.close();
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("deletes all Step samples without deleting other measurements", async () => {
    const databasePath = join(root, "databases", "health-store-delete-steps.duckdb-poc");
    const fixture = createDuckDbHealthStoreFixture();
    fixture.timeSeriesSamples.push(
      {
        ...fixture.timeSeriesSamples[0],
        id: "steps-individual",
        measurementCode: "steps",
        value: 400,
        unit: "count"
      },
      {
        ...fixture.timeSeriesSamples[0],
        id: "steps-daily",
        measurementCode: "steps",
        startAt: "2026-07-12T00:00:00.000Z",
        endAt: "2026-07-12T23:59:59.999Z",
        value: 4_400,
        unit: "count",
        sourceJson: { aggregation: "health-connect-daily", calendarDate: "2026-07-12" }
      }
    );
    const repository = await DuckDbRepository.hydrate(root, databasePath, key, fixture, { httpfsExtensionPath });
    try {
      expect((await repository.deleteStepSamples()).deletedCount).toBe(2);
      expect((await repository.deleteStepSamples()).deletedCount).toBe(0);
      expect((await repository.snapshot()).timeSeriesSamples.map((entry) => entry.id)).toEqual(["sample-1"]);
    } finally {
      await repository.close();
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("reads profile metadata without materializing a full snapshot", async () => {
    const databasePath = join(root, "databases", "health-store-profile-read.duckdb-poc");
    const fixture = createDuckDbHealthStoreFixture();
    const repository = await DuckDbRepository.hydrate(root, databasePath, key, fixture, { httpfsExtensionPath });
    const snapshotSpy = vi.spyOn(repository, "snapshot").mockRejectedValue(new Error("Profile reads must not snapshot."));
    try {
      await expect(repository.getProfile()).resolves.toEqual(fixture.profile);
      expect(snapshotSpy).not.toHaveBeenCalled();
    } finally {
      await repository.close();
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("provides slim transactional observation mutation primitives without snapshot responses", async () => {
    const databasePath = join(root, "databases", "health-store-slim-mutations.duckdb-poc");
    const fixture = createDuckDbHealthStoreFixture();
    const repository = await DuckDbRepository.hydrate(root, databasePath, key, fixture, { httpfsExtensionPath });
    const inserted = { ...fixture.observations[0], id: "slim-insert", value: 77 };
    try {
      expect(await repository.insertObservationRecord(inserted)).toBe(true);
      expect(await repository.insertObservationRecord(inserted)).toBe(false);
      expect(await repository.deleteObservationRecord("slim-insert")).toBe(true);
      expect(await repository.deleteObservationRecord("slim-insert")).toBe(false);
      expect(await repository.deleteObservationRecordsByMeasurementCode("weight")).toBe(2);
      expect(await repository.deleteObservationRecordsByMeasurementCode("weight")).toBe(0);
      expect((await repository.snapshot()).observations).toEqual([]);

      const bulkImport = {
        sourceImport: {
          id: "slim-import",
          sourceKind: "manual-entry" as const,
          fileName: "slim.json",
          importedAt: "2026-07-12T12:00:00.000Z",
          parserVersion: "test",
          checksum: "slim-checksum",
          rowCount: 2,
          status: "processed" as const,
          diagnostics: []
        },
        dataSource: {
          id: "slim-source",
          sourceKind: "manual-entry" as const,
          label: "Slim source",
          importId: "slim-import",
          createdAt: "2026-07-12T12:00:00.000Z"
        },
        observations: [
          { ...fixture.observations[0], id: "bulk-a", sourceId: "slim-source" },
          { ...fixture.observations[1], id: "bulk-b", sourceId: "slim-source" }
        ]
      };
      expect(await repository.importObservationRecords(bulkImport)).toBe(2);
      expect(await repository.importObservationRecords(bulkImport)).toBe(0);
      expect((await repository.snapshot()).observations.map((entry) => entry.id)).toEqual(["bulk-a", "bulk-b"]);
    } finally {
      await repository.close();
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("persists import, insight, and deletion semantics without duplicate rows", async () => {
    const databasePath = join(root, "databases", "health-store-mutations.duckdb-poc");
    const fixture = createDuckDbHealthStoreFixture();
    const options = { httpfsExtensionPath };
    const repository = await DuckDbRepository.hydrate(root, databasePath, key, fixture, options);
    const parsedImport = {
      sourceImport: {
        id: "import-2",
        sourceKind: "manual-entry" as const,
        fileName: "second-fixture.csv",
        importedAt: "2026-07-12T11:00:00.000Z",
        parserVersion: "test-2",
        checksum: "fixture-checksum-2",
        rowCount: 1,
        status: "processed" as const,
        diagnostics: [],
        rawContent: "x".repeat(1_000_005)
      },
      dataSource: {
        id: "source-2",
        sourceKind: "manual-entry" as const,
        label: "Second fixture source",
        importId: "import-2",
        createdAt: "2026-07-12T11:00:00.000Z"
      },
      observations: [{
        ...fixture.observations[0],
        id: "observation-2",
        observedAt: "2026-07-12T11:01:00.000Z",
        sourceId: "source-2"
      }, fixture.observations[0]],
      observationGroups: [{
        ...fixture.observationGroups[0],
        id: "group-2",
        sourceId: "source-2"
      }],
      timeSeriesSamples: [{
        ...fixture.timeSeriesSamples[0],
        id: "sample-2",
        sourceId: "source-2"
      }],
      measurementAggregates: [],
      activitySessions: [{
        ...fixture.activitySessions[0],
        id: "activity-2",
        sourceId: "source-2"
      }]
    };
    const addedInsight = {
      ...fixture.insights[0],
      id: "insight-2",
      title: "Second fixture insight"
    };

    try {
      const firstImportResult = await repository.mergeImport(parsedImport);
      const repeatedImportResult = await repository.mergeImport(parsedImport);
      expect(firstImportResult).toMatchObject({
        counts: { imports: 2, observations: 3, samples: 2, activities: 2 },
        outcome: {
          sourceImport: { attempted: 1, accepted: 1, duplicates: 0, rejected: 0 },
          dataSource: { attempted: 1, accepted: 1, duplicates: 0, rejected: 0 },
          observations: { attempted: 2, accepted: 1, duplicates: 1, rejected: 0 },
          observationGroups: { attempted: 1, accepted: 1, duplicates: 0, rejected: 0 },
          timeSeriesSamples: { attempted: 1, accepted: 1, duplicates: 0, rejected: 0 },
          activitySessions: { attempted: 1, accepted: 1, duplicates: 0, rejected: 0 }
        },
        auditEvent: { eventType: "import-processed" }
      });
      expect(repeatedImportResult.counts).toEqual(firstImportResult.counts);
      expect(repeatedImportResult.outcome).toEqual({
        sourceImport: { attempted: 1, accepted: 0, duplicates: 1, rejected: 0 },
        dataSource: { attempted: 1, accepted: 0, duplicates: 1, rejected: 0 },
        observations: { attempted: 2, accepted: 0, duplicates: 2, rejected: 0 },
        observationGroups: { attempted: 1, accepted: 0, duplicates: 1, rejected: 0 },
        timeSeriesSamples: { attempted: 1, accepted: 0, duplicates: 1, rejected: 0 },
        measurementAggregates: { attempted: 0, accepted: 0, duplicates: 0, rejected: 0 },
        activitySessions: { attempted: 1, accepted: 0, duplicates: 1, rejected: 0 }
      });
      expect(firstImportResult.auditEvent.detail).toContain("observations: 1 accepted, 1 duplicate(s), 0 rejected");
      expect(repeatedImportResult.auditEvent.detail).toContain("observations: 0 accepted, 2 duplicate(s), 0 rejected");
      expect(firstImportResult).not.toHaveProperty("observations");
      expect(firstImportResult).not.toHaveProperty("sourceImports");
      await repository.addInsight(addedInsight);
      const beforeUpdate = (await repository.snapshot()).observations.find((entry) => entry.id === "observation-z")!;
      const updated = await repository.updateObservation("observation-z", {
        measurementCode: "creatinine",
        observedAt: "2026-02-03T10:30:00.000Z",
        value: 61.4,
        unit: "µmol/L",
        note: "Corrected"
      });
      expect(updated?.updatedObservation).toMatchObject({
        id: "observation-z",
        measurementCode: "creatinine",
        sourceId: beforeUpdate.sourceId,
        observationGroupId: beforeUpdate.observationGroupId
      });
      expect(updated?.updatedObservation.sourceJson).toEqual(beforeUpdate.sourceJson);
      expect(await repository.updateObservation("missing-observation", {
        measurementCode: "creatinine", observedAt: "2026-02-03T10:30:00.000Z", value: 1, unit: "µmol/L"
      })).toBeUndefined();
      const deleted = await repository.deleteObservation("observation-z");
      expect(deleted).toMatchObject({ deletedCount: 1, deletedObservation: { id: "observation-z" } });
      expect(await repository.deleteObservation("missing-observation")).toBeUndefined();
      const deletedByType = await repository.deleteObservationsByMeasurementCode("weight");
      expect(deletedByType.deletedCount).toBe(2);
      expect((await repository.deleteObservationsByMeasurementCode("weight")).deletedCount).toBe(0);
    } finally {
      await repository.close();
    }

    const reopened = await DuckDbRepository.open(root, databasePath, key, options);
    try {
      const snapshot = await reopened.snapshot();
      expect(snapshot.sourceImports.map((entry) => entry.id)).toEqual(["import-1", "import-2"]);
      expect(snapshot.sourceImports[1].rawContent).toHaveLength(1_000_005);
      expect(snapshot.dataSources.map((entry) => entry.id)).toEqual(["source-1", "source-2"]);
      expect(snapshot.observationGroups.map((entry) => entry.id)).toEqual(["group-1", "group-2"]);
      expect(snapshot.timeSeriesSamples.map((entry) => entry.id)).toEqual(["sample-1", "sample-2"]);
      expect(snapshot.activitySessions.map((entry) => entry.id)).toEqual(["activity-1", "activity-2"]);
      expect(snapshot.observations).toEqual([]);
      expect(snapshot.insights.map((entry) => entry.id)).toEqual(["insight-2", "insight-1"]);
      expect(snapshot.auditEvents.map((entry) => entry.eventType).slice(0, 6)).toEqual([
        "observation-type-deleted",
        "observation-deleted",
        "observation-updated",
        "insight-generated",
        "import-processed",
        "import-processed"
      ]);
    } finally {
      await reopened.close();
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("replaces a corrected Heart Rate aggregate bucket", async () => {
    const databasePath = join(root, "databases", "health-store-heart-rate-aggregates.duckdb-poc");
    const fixture = createDuckDbHealthStoreFixture();
    const repository = await DuckDbRepository.hydrate(root, databasePath, key, fixture, { httpfsExtensionPath });
    const bucket = {
      startTime: "2026-07-15T10:00:00.000Z",
      endTime: "2026-07-15T10:15:00.000Z",
      granularity: "15m" as const,
      average: 72,
      minimum: 64,
      maximum: 91,
      count: 18
    };
    const request = healthConnectImportRequestSchema.parse({
      syncedAt: "2026-07-15T12:00:00.000Z",
      rangeStart: "2026-07-15T00:00:00.000Z",
      rangeEnd: "2026-07-15T12:00:00.000Z",
      deviceLabel: "Pixel 8",
      batchId: "first",
      heartRate: [
        bucket,
        {
          ...bucket,
          startTime: "2026-07-15T09:45:00.000Z",
          endTime: "2026-07-15T10:00:00.000Z",
          average: 100,
          minimum: 100,
          maximum: 100,
          count: 1
        }
      ]
    });

    try {
      await repository.resetMeasurementTypeMetadataFromRegistry();
      await repository.mergeImport(parseHealthConnectImport(request));
      await repository.mergeImport(parseHealthConnectImport({
        ...request,
        syncedAt: "2026-07-15T12:05:00.000Z",
        batchId: "retry",
        heartRate: [{ ...bucket, average: 73, count: 19 }]
      }));
      expect(await repository.latestMeasurement("heart_rate")).toMatchObject({
        timestamp: bucket.endTime,
        value: 73,
        unit: "beats/min"
      });
      const detail = await repository.measurementDetail("heart_rate");
      expect(detail.counts).toMatchObject({ observations: 0, samples: 2, total: 2 });
      const chart = await repository.measurementChartSeries("heart_rate", { range: "all", mode: "auto" });
      expect(chart.points).toHaveLength(1);
      expect(chart.points[0]).toMatchObject({
        value: 74.35,
        count: 20,
        minValue: 64,
        maxValue: 100
      });
    } finally {
      await repository.close();
    }

    const database = await openEncryptedDuckDbDatabase(root, databasePath, key, { httpfsExtensionPath });
    try {
      const aggregateRows = await all(database.connection, `
        SELECT average, minimum, maximum, measurement_count
        FROM measurement_aggregates
        WHERE measurement_code = 'heart_rate'
        ORDER BY start_at DESC;
      `);
      expect(aggregateRows).toEqual([
        { average: 73, minimum: 64, maximum: 91, measurement_count: 19n },
        { average: 100, minimum: 100, maximum: 100, measurement_count: 1n }
      ]);
      const dailyRows = await all(database.connection, `
        SELECT avg_value, min_value, max_value, n, unit
        FROM v_daily_metrics
        WHERE measurement_code = 'heart_rate';
      `);
      expect(dailyRows).toEqual([{
        avg_value: 74.35,
        min_value: 64,
        max_value: 100,
        n: 20n,
        unit: "beats/min"
      }]);
    } finally {
      await closeEncryptedDuckDbDatabase(database);
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("replaces legacy Health Connect Step rows by calendar day", async () => {
    const databasePath = join(root, "databases", "health-store-steps-daily.duckdb-poc");
    const fixture = createDuckDbHealthStoreFixture();
    const repository = await DuckDbRepository.hydrate(root, databasePath, key, fixture, { httpfsExtensionPath });
    const request = healthConnectImportRequestSchema.parse({
      syncedAt: "2026-08-02T12:00:00.000Z",
      rangeStart: "2026-08-01T00:00:00.000Z",
      rangeEnd: "2026-08-03T00:00:00.000Z",
      deviceLabel: "Pixel 8",
      batchId: "corrected",
      steps: [{
        startTime: "2026-08-02T00:00:00.000Z",
        endTime: "2026-08-03T00:00:00.000Z",
        count: 9586,
        provenance: { aggregation: "health-connect-daily", calendarDate: "2026-08-02" }
      }]
    });
    const corrected = parseHealthConnectImport(request);
    const legacy = {
      ...corrected,
      sourceImport: { ...corrected.sourceImport, id: "legacy-health-connect-import", batchId: undefined },
      dataSource: { ...corrected.dataSource, importId: "legacy-health-connect-import" },
      timeSeriesSamples: [{
        ...corrected.timeSeriesSamples[0],
        id: "legacy-evening-step-row",
        startAt: "2026-08-02T14:25:00.000Z",
        endAt: "2026-08-02T14:25:00.000Z",
        value: 2491
      }]
    };

    try {
      await repository.mergeImport(legacy);
      await repository.mergeImport(corrected);
      const detail = await repository.measurementDetail("steps");
      expect(detail.entries).toHaveLength(1);
      expect(detail.entries[0]).toMatchObject({
        value: 9586,
        timestamp: "2026-08-02T00:00:00.000Z"
      });
    } finally {
      await repository.close();
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("retains samples beyond the former ceiling across later imports", async () => {
    const databasePath = join(root, "databases", "health-store-unlimited-samples.duckdb-poc");
    const fixture = createDuckDbHealthStoreFixture();
    const repository = await DuckDbRepository.hydrate(root, databasePath, key, fixture, { httpfsExtensionPath });
    const sampleCount = 10_001;
    const samples = Array.from({ length: sampleCount }, (_, index) => ({
      ...fixture.timeSeriesSamples[0],
      id: `unlimited-sample-${index}`,
      startAt: new Date(Date.UTC(2025, 0, 1, 0, index)).toISOString(),
      endAt: new Date(Date.UTC(2025, 0, 1, 0, index, 30)).toISOString()
    }));
    try {
      const first = await repository.mergeImport({
        sourceImport: {
          id: "unlimited-import-1", sourceKind: "manual-entry", fileName: "unlimited-1.json",
          importedAt: "2026-07-15T00:00:00.000Z", parserVersion: "test", checksum: "unlimited-1",
          rowCount: sampleCount, status: "processed", diagnostics: []
        },
        dataSource: {
          id: "unlimited-source", sourceKind: "manual-entry", label: "Unlimited fixture",
          importId: "unlimited-import-1", createdAt: "2026-07-15T00:00:00.000Z"
        },
        observations: [], observationGroups: [], timeSeriesSamples: samples,
        measurementAggregates: [], activitySessions: []
      });
      expect(first.outcome.timeSeriesSamples).toEqual({
        attempted: sampleCount, accepted: sampleCount, duplicates: 0, rejected: 0
      });
      expect(first.counts.samples).toBe(sampleCount + fixture.timeSeriesSamples.length);

      const second = await repository.mergeImport({
        sourceImport: {
          id: "unlimited-import-2", sourceKind: "manual-entry", fileName: "unlimited-2.json",
          importedAt: "2026-07-16T00:00:00.000Z", parserVersion: "test", checksum: "unlimited-2",
          rowCount: 1, status: "processed", diagnostics: []
        },
        dataSource: {
          id: "unlimited-source", sourceKind: "manual-entry", label: "Unlimited fixture",
          importId: "unlimited-import-2", createdAt: "2026-07-16T00:00:00.000Z"
        },
        observations: [], observationGroups: [],
        timeSeriesSamples: [{ ...samples[0], id: "unlimited-sample-later", startAt: "2026-07-16T00:00:00.000Z", endAt: "2026-07-16T00:01:00.000Z" }],
        measurementAggregates: [],
        activitySessions: []
      });
      expect(second.outcome.timeSeriesSamples).toEqual({ attempted: 1, accepted: 1, duplicates: 0, rejected: 0 });
      expect(second.counts.samples).toBe(sampleCount + fixture.timeSeriesSamples.length + 1);
    } finally {
      await repository.close();
    }
  }, 60_000);

  it.skipIf(!httpfsExtensionPath)("isolates profiles across concurrently open encrypted databases", async () => {
    const options = { httpfsExtensionPath };
    const profileAPath = join(root, "databases", "health-store-profile-a-isolated.duckdb-poc");
    const profileBPath = join(root, "databases", "health-store-profile-b-isolated.duckdb-poc");
    const profileAKey = Buffer.alloc(32, 10).toString("base64");
    const profileBKey = Buffer.alloc(32, 11).toString("base64");
    const profileA = createDuckDbHealthStoreFixture();
    const profileB = createDuckDbHealthStoreFixture();
    profileB.profile = { ...profileB.profile, id: "profile-b", displayName: "Profile B" };
    profileB.observations = profileB.observations.map((entry, index) => ({
      ...entry,
      value: 60 + index,
      note: "profile-b-marker"
    }));

    const [repositoryA, repositoryB] = await Promise.all([
      DuckDbRepository.hydrate(root, profileAPath, profileAKey, profileA, options),
      DuckDbRepository.hydrate(root, profileBPath, profileBKey, profileB, options)
    ]);
    try {
      await Promise.all([
        repositoryA.deleteObservation("observation-z"),
        repositoryB.addInsight({
          ...profileB.insights[0],
          id: "profile-b-only-insight",
          title: "Profile B only"
        })
      ]);
      const [snapshotA, snapshotB] = await Promise.all([repositoryA.snapshot(), repositoryB.snapshot()]);
      expect(snapshotA.profile.id).toBe("profile-a");
      expect(snapshotA.observations.map((entry) => entry.id)).toEqual(["observation-a"]);
      expect(snapshotA.insights.some((entry) => entry.id === "profile-b-only-insight")).toBe(false);
      expect(snapshotB.profile.id).toBe("profile-b");
      expect(snapshotB.observations.map((entry) => entry.value)).toEqual([60, 61]);
      expect(snapshotB.insights[0].id).toBe("profile-b-only-insight");
    } finally {
      await Promise.all([repositoryA.close(), repositoryB.close()]);
    }

    await expect(DuckDbRepository.open(root, profileAPath, profileBKey, options)).rejects.toThrow();
    await expect(DuckDbRepository.open(root, profileBPath, profileAKey, options)).rejects.toThrow();
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("provides fixed daily and Monday-based weekly analytical views", async () => {
    const databasePath = join(root, "databases", "health-store-analytics.duckdb-poc");
    const fixture = createDuckDbHealthStoreFixture();
    fixture.observations = [
      { ...fixture.observations[0], id: "weight-sunday-a", observedAt: "2026-07-05T23:30:00.000Z", value: 80 },
      { ...fixture.observations[1], id: "weight-sunday-b", observedAt: "2026-07-05T23:45:00.000Z", value: 82 },
      { ...fixture.observations[1], id: "weight-monday", observedAt: "2026-07-06T00:15:00.000Z", value: 78 }
    ];
    fixture.timeSeriesSamples = [
      { ...fixture.timeSeriesSamples[0], id: "steps-sunday-a", measurementCode: "steps", startAt: "2026-07-05T10:00:00.000Z", endAt: "2026-07-05T10:05:00.000Z", value: 1_000, unit: "count" },
      { ...fixture.timeSeriesSamples[0], id: "steps-sunday-b", measurementCode: "steps", startAt: "2026-07-05T18:00:00.000Z", endAt: "2026-07-05T18:05:00.000Z", value: 1_500, unit: "count" },
      { ...fixture.timeSeriesSamples[0], id: "steps-monday", measurementCode: "steps", startAt: "2026-07-06T08:00:00.000Z", endAt: "2026-07-06T08:05:00.000Z", value: 700, unit: "count" }
    ];
    const repository = await DuckDbRepository.hydrate(root, databasePath, key, fixture, { httpfsExtensionPath });
    try {
      const weightDaily = await repository.dailyMetrics("weight");
      const stepsDaily = await repository.dailyMetrics("steps");
      const weightWeekly = await repository.weeklyMetrics("weight");
      expect(weightDaily).toEqual([
        { day: "2026-07-05", measurementCode: "weight", avgValue: 81, minValue: 80, maxValue: 82, count: 2, unit: "kg" },
        { day: "2026-07-06", measurementCode: "weight", avgValue: 78, minValue: 78, maxValue: 78, count: 1, unit: "kg" }
      ]);
      expect(stepsDaily).toEqual([
        { day: "2026-07-05", measurementCode: "steps", avgValue: 2_500, minValue: 1_000, maxValue: 1_500, count: 2, unit: "count" },
        { day: "2026-07-06", measurementCode: "steps", avgValue: 700, minValue: 700, maxValue: 700, count: 1, unit: "count" }
      ]);
      expect(weightWeekly).toEqual([
        { weekStart: "2026-06-29", measurementCode: "weight", avgValue: 81, minValue: 80, maxValue: 82, count: 2, unit: "kg" },
        { weekStart: "2026-07-06", measurementCode: "weight", avgValue: 78, minValue: 78, maxValue: 78, count: 1, unit: "kg" }
      ]);
      expect(await repository.dailyMetrics("missing")).toEqual([]);
      expect(await repository.latestMeasurement("weight")).toEqual({
        kind: "observation", id: "weight-monday", timestamp: "2026-07-06T00:15:00.000Z", value: 78, unit: "kg"
      });
      expect((await repository.measurementDetails("weight")).map((entry) => entry.id)).toEqual([
        "weight-monday", "weight-sunday-b", "weight-sunday-a"
      ]);
      expect(await repository.latestMeasurement("missing")).toBeUndefined();
    } finally {
      await repository.close();
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("provides bounded activity list and count queries matching the allowlisted compiler surface", async () => {
    const databasePath = join(root, "databases", "health-store-activities.duckdb-poc");
    const fixture = createDuckDbHealthStoreFixture();
    fixture.activitySessions = [
      { ...fixture.activitySessions[0], id: "outside-before", startAt: "2026-07-04T23:59:59.999Z" },
      { id: "walking-start", activityType: "walking", startAt: "2026-07-05T00:00:00.000Z", sourceId: "source-1" },
      { ...fixture.activitySessions[0], id: "running-midday", activityType: "running", startAt: "2026-07-05T12:00:00.000Z" },
      { ...fixture.activitySessions[0], id: "walking-end", startAt: "2026-07-05T23:59:59.000Z" },
      { ...fixture.activitySessions[0], id: "outside-after", activityType: "cycling", startAt: "2026-07-05T23:59:59.999Z" }
    ];
    const repository = await DuckDbRepository.hydrate(root, databasePath, key, fixture, { httpfsExtensionPath });
    try {
      expect(await repository.listActivities({
        startDate: "2026-07-05",
        endDate: "2026-07-05",
        sort: "asc",
        limit: 2
      })).toEqual([
        { activityType: "walking", startAt: "2026-07-05T00:00:00.000Z" },
        {
          activityType: "running",
          startAt: "2026-07-05T12:00:00.000Z",
          endAt: fixture.activitySessions[0].endAt,
          durationMinutes: 30,
          energyKcal: 120.5,
          distanceMeters: 2500
        }
      ]);
      expect(await repository.countActivities({
        startDate: "2026-07-05",
        endDate: "2026-07-05"
      })).toEqual([
        { activityType: "walking", count: 2 },
        { activityType: "running", count: 1 }
      ]);
      await expect(repository.listActivities({
        startDate: "2026-07-06",
        endDate: "2026-07-05"
      })).rejects.toThrow("startDate must not be after endDate");
      await expect(repository.countActivities({
        startDate: "2026-02-30",
        endDate: "2026-03-01"
      })).rejects.toThrow("valid YYYY-MM-DD date");
    } finally {
      await repository.close();
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("creates the baseline schema with views, indexes, and foreign keys", async () => {
    const databasePath = join(root, "databases", "health-store-baseline.duckdb-poc");
    const options = { httpfsExtensionPath };
    await createDuckDbSchema(root, databasePath, key, options);

    const opened = await DuckDbRepository.open(root, databasePath, key, options);
    try {
      expect(await opened.schemaVersions()).toEqual([1, 2, 3, 4, 5, 6]);
      expect(await opened.dailyMetrics()).toEqual([]);
      expect(await opened.weeklyMetrics()).toEqual([]);
    } finally {
      await opened.close();
    }

    const handle = await openEncryptedDuckDbDatabase(root, databasePath, key, options);
    try {
      const columns = await querySql(handle.connection, `SELECT column_name
        FROM information_schema.columns
        WHERE table_catalog = current_database() AND table_name = 'profile'
        ORDER BY column_name;`);
      expect(columns.map((row) => row.column_name)).toContain("birth_date");
      expect(columns.map((row) => row.column_name)).not.toContain("birth_year");

      const views = await querySql(handle.connection, `SELECT table_name
        FROM information_schema.views
        WHERE table_catalog = current_database()
        ORDER BY table_name;`);
      expect(views.map((row) => row.table_name)).toEqual([
        "v_ai_care_items", "v_ai_health_events", "v_daily_metrics", "v_weekly_metrics"
      ]);

      const indexes = await querySql(handle.connection,
        "SELECT index_name FROM duckdb_indexes() WHERE database_name = current_database() ORDER BY index_name;");
      expect(indexes.map((row) => row.index_name)).toEqual(expect.arrayContaining([
        "activities_start_idx",
        "companion_migration_identity_idx",
        "companion_sync_changes_revision_idx",
        "imports_kind_checksum_idx",
        "observations_code_observed_idx",
        "time_series_samples_code_end_idx"
      ]));

      const timestampColumns = await querySql(handle.connection, `SELECT COUNT(*) AS count
        FROM information_schema.columns
        WHERE table_catalog = current_database() AND table_schema = 'main' AND data_type = 'TIMESTAMP';`);
      expect(Number((timestampColumns[0] as { count: unknown }).count)).toBe(0);

      await execSql(handle.connection, `INSERT INTO sources (ordinal, id, source_kind, label, import_id, created_at)
        VALUES (0, 'source-a', 'manual', 'Manual', NULL, CURRENT_TIMESTAMP);`);
      await expect(execSql(handle.connection, `INSERT INTO observations
        (ordinal, id, measurement_code, observed_at, value, unit, source_id, source_json_present)
        VALUES (0, 'orphan', 'weight', CURRENT_TIMESTAMP, 1, 'kg', 'missing-source', false);`))
        .rejects.toThrow(/[Cc]onstraint/);
    } finally {
      await closeEncryptedDuckDbDatabase(handle);
    }

    const reopened = await DuckDbRepository.open(root, databasePath, key, options);
    try {
      expect(await reopened.schemaVersions()).toEqual([1, 2, 3, 4, 5, 6]);
    } finally {
      await reopened.close();
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("migrates legacy Health Event kinds and removes obsolete events", async () => {
    const databasePath = join(root, "databases", "health-store-event-kinds-migration.duckdb-poc");
    const options = { httpfsExtensionPath };
    await createDuckDbSchema(root, databasePath, key, options, 3);

    const legacyHandle = await openEncryptedDuckDbDatabase(root, databasePath, key, options);
    try {
      await execSql(legacyHandle.connection, `INSERT INTO health_events
        (ordinal, id, kind, status, occurred_at, source)
        VALUES
          (0, 'legacy-medication', 'medication-administration', 'completed', '2026-07-01T00:00:00Z', 'manual-entry'),
          (1, 'legacy-allergy', 'allergy-reaction', 'completed', '2026-07-02T00:00:00Z', 'manual-entry'),
          (2, 'legacy-treatment', 'treatment', 'completed', '2026-07-03T00:00:00Z', 'manual-entry'),
          (3, 'legacy-dental', 'dental', 'completed', '2026-07-04T00:00:00Z', 'manual-entry'),
          (4, 'legacy-test', 'test', 'completed', '2026-07-05T00:00:00Z', 'manual-entry'),
          (5, 'legacy-injury', 'injury', 'completed', '2026-07-06T00:00:00Z', 'manual-entry');`);
      await execSql(legacyHandle.connection, `INSERT INTO medication_administrations
        (health_event_id, medication, dose, unit)
        VALUES ('legacy-medication', 'Test medication', 10, 'mg');`);
      await execSql(legacyHandle.connection, `INSERT INTO care_items
        (ordinal, id, kind, title, priority, status, completed_health_event_id, completed_at)
        VALUES (0, 'dental-care-item', 'dental', 'Dental visit', 'normal', 'completed',
          'legacy-dental', '2026-07-04T00:00:00Z');`);
    } finally {
      await closeEncryptedDuckDbDatabase(legacyHandle);
    }

    const migrated = await DuckDbRepository.open(root, databasePath, key, options);
    try {
      expect(await migrated.schemaVersions()).toEqual([1, 2, 3, 4, 5, 6]);
      expect((await migrated.listHealthEvents({ limit: 100 })).items).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "legacy-medication", kind: "medication" }),
        expect.objectContaining({ id: "legacy-allergy", kind: "allergy-intolerance" })
      ]));
      expect((await migrated.listHealthEvents({ limit: 100 })).items.map((event) => event.id))
        .not.toEqual(expect.arrayContaining([
          "legacy-treatment", "legacy-dental", "legacy-test", "legacy-injury"
        ]));
    } finally {
      await migrated.close();
    }

    const migratedHandle = await openEncryptedDuckDbDatabase(root, databasePath, key, options);
    try {
      expect(await querySql(migratedHandle.connection, `SELECT id, status, completed_health_event_id
        FROM care_items WHERE id = 'dental-care-item';`)).toEqual([{
        id: "dental-care-item",
        status: "completed",
        completed_health_event_id: null
      }]);
      expect(await querySql(migratedHandle.connection, `SELECT kind
        FROM care_items WHERE id = 'dental-care-item';`)).toEqual([{ kind: "visit" }]);
    } finally {
      await closeEncryptedDuckDbDatabase(migratedHandle);
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("adds resumable Health Connect tables to an existing version-1 profile", async () => {
    const databasePath = join(root, "databases", "health-store-health-connect-migration.duckdb-poc");
    const options = { httpfsExtensionPath };
    await createDuckDbSchema(root, databasePath, key, options, 1);

    const versionOneHandle = await openEncryptedDuckDbDatabase(root, databasePath, key, options);
    try {
      const tables = await querySql(versionOneHandle.connection, `SELECT table_name
        FROM information_schema.tables
        WHERE table_catalog = current_database() AND table_name = 'health_connect_sync_sessions';`);
      expect(tables).toEqual([]);
    } finally {
      await closeEncryptedDuckDbDatabase(versionOneHandle);
    }

    const migrated = await DuckDbRepository.open(root, databasePath, key, options);
    try {
      expect(await migrated.schemaVersions()).toEqual([1, 2, 3, 4, 5, 6]);
      await expect(migrated.startHealthConnectSyncSession("pairing-1", {
        sessionKey: "device-1:2026-07-01:2026-07-02",
        deviceLabel: "Test Phone",
        rangeStart: "2026-07-01T00:00:00.000Z",
        rangeEnd: "2026-07-02T00:00:00.000Z"
      })).resolves.toMatchObject({ protocolVersion: 1, processedBatchIds: [] });
    } finally {
      await migrated.close();
    }
  }, 30_000);

  it.skipIf(!httpfsExtensionPath)("rejects missing, malformed, and future schema metadata without changing database bytes", async () => {
    const options = { httpfsExtensionPath };
    const missingPath = join(root, "databases", "health-store-schema-missing.duckdb-poc");
    const missingHandle = await openEncryptedDuckDbDatabase(root, missingPath, key, options);
    await execSql(missingHandle.connection, "CREATE TABLE unrelated (id INTEGER);");
    await closeEncryptedDuckDbDatabase(missingHandle);
    const missingHash = hashFile(missingPath);
    await expect(DuckDbRepository.open(root, missingPath, key, options)).rejects.toThrow("metadata is missing");
    expect(hashFile(missingPath)).toBe(missingHash);

    const malformedPath = join(root, "databases", "health-store-schema-malformed.duckdb-poc");
    await createDuckDbSchema(root, malformedPath, key, options, 1);
    const malformedHandle = await openEncryptedDuckDbDatabase(root, malformedPath, key, options);
    await execSql(malformedHandle.connection, "DELETE FROM poc_metadata;");
    await execSql(malformedHandle.connection, "CHECKPOINT;");
    await closeEncryptedDuckDbDatabase(malformedHandle);
    const malformedHash = hashFile(malformedPath);
    await expect(DuckDbRepository.open(root, malformedPath, key, options)).rejects.toThrow("history is malformed");
    expect(hashFile(malformedPath)).toBe(malformedHash);

    const futurePath = join(root, "databases", "health-store-schema-future.duckdb-poc");
    await createDuckDbSchema(root, futurePath, key, options, 1);
    const futureHandle = await openEncryptedDuckDbDatabase(root, futurePath, key, options);
    await execSql(futureHandle.connection, "INSERT INTO poc_metadata VALUES (2, CURRENT_TIMESTAMP, 'skipped'); INSERT INTO poc_metadata VALUES (3, CURRENT_TIMESTAMP, 'skipped'); INSERT INTO poc_metadata VALUES (4, CURRENT_TIMESTAMP, 'skipped'); INSERT INTO poc_metadata VALUES (5, CURRENT_TIMESTAMP, 'skipped'); INSERT INTO poc_metadata VALUES (6, CURRENT_TIMESTAMP, 'skipped'); INSERT INTO poc_metadata VALUES (7, CURRENT_TIMESTAMP, 'future');");
    await execSql(futureHandle.connection, "CHECKPOINT;");
    await closeEncryptedDuckDbDatabase(futureHandle);
    const futureHash = hashFile(futurePath);
    await expect(DuckDbRepository.open(root, futurePath, key, options)).rejects.toThrow(SchemaVersionTooNewError);
    // The message is shown verbatim in the desktop startup dialog, so it has to tell the user what
    // to do rather than name an internal version check.
    await expect(DuckDbRepository.open(root, futurePath, key, options)).rejects.toThrow(/newer version of Vitana/);
    expect(hashFile(futurePath)).toBe(futureHash);
  }, 30_000);

  it("puts a pre-migration copy back and clears the stale write-ahead log", () => {
    const databasePath = join(root, "databases", "health-store-restore.duckdb-poc");
    const backupPath = `${databasePath}.pre-migration-test`;
    writeFileSync(databasePath, "half-migrated");
    writeFileSync(`${databasePath}.wal`, "stale");
    writeFileSync(backupPath, "original");

    restoreDatabaseBackup(backupPath, databasePath);

    expect(readFileSync(databasePath, "utf8")).toBe("original");
    expect(existsSync(`${databasePath}.wal`)).toBe(false);
    expect(existsSync(backupPath)).toBe(false);
  });
});

function execSql(connection: { exec(sql: string, callback: (error: Error | null) => void): unknown }, sql: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    connection.exec(sql, (error) => error ? reject(error) : resolvePromise());
  });
}

function querySql(
  connection: { all(sql: string, callback: (error: Error | null, rows?: unknown[]) => void): unknown },
  sql: string
): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolvePromise, reject) => {
    connection.all(sql, (error, rows) => error ? reject(error) : resolvePromise((rows ?? []) as Array<Record<string, unknown>>));
  });
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}