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
import { calculateBiologicalAge, computeAnalytics, defaultMeasurementTypes } from "@local-fitness-advisor/shared";
import {
  closeEncryptedDuckDbDatabase,
  createDuckDbSchema,
  initializeDuckDbRoot,
  openEncryptedDuckDbDatabase
} from "../storage/duckdbRuntime.js";
import { createDuckDbHealthStoreFixture } from "./support/duckdbFixture.js";
import { DuckDbRepository, digestHealthStoreData } from "../storage/duckdbRepository.js";
import { buildClinicianReport } from "../clinicianReport.js";

const httpfsExtensionPath = findPreparedExtension();
const key = Buffer.alloc(32, 7).toString("base64");
let root: string;

beforeEach(() => {
  root = initializeDuckDbRoot(mkdtempSync(join(tmpdir(), "lfa-duckdb-repository-test-")));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("DuckDbRepository fidelity", () => {
  it.skipIf(!httpfsExtensionPath)("returns bounded startup data without materializing full health history", async () => {
    const databasePath = join(root, "databases", "health-store-bootstrap.duckdb-poc");
    const fixture = createDuckDbHealthStoreFixture();
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
      expect(analytics).toEqual(computeAnalytics(fixture));
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
    const fixtureWithGlucose = {
      ...fixture,
      observations: [...fixture.observations, glucoseObservation, bmiObservation]
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
          normalLow: 18.5,
          normalHigh: 24.9,
          referenceRanges: [{ low: 18.5, high: 24.9, unit: "kg/m2" }]
        })
      ]));
      const summary = await repository.summary();
      expect(summary.categories.flatMap((category) => category.rows)).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "glucose", category: "lab" })
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
      expect(detail.measurement).toMatchObject({ code: "weight", displayName: "Weight", counts: { total: 3 } });
      expect(detail.entries.map((entry) => entry.id)).toEqual(["sample-1", "observation-a", "observation-z"]);
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
          sourceImport: { attempted: 1, accepted: 1, duplicates: 0, evicted: 0 },
          dataSource: { attempted: 1, accepted: 1, duplicates: 0, evicted: 0 },
          observations: { attempted: 2, accepted: 1, duplicates: 1, evicted: 0 },
          observationGroups: { attempted: 1, accepted: 1, duplicates: 0, evicted: 0 },
          timeSeriesSamples: { attempted: 1, accepted: 1, duplicates: 0, evicted: 0 },
          activitySessions: { attempted: 1, accepted: 1, duplicates: 0, evicted: 0 }
        },
        auditEvent: { eventType: "import-processed" }
      });
      expect(repeatedImportResult.counts).toEqual(firstImportResult.counts);
      expect(repeatedImportResult.outcome).toEqual({
        sourceImport: { attempted: 1, accepted: 0, duplicates: 1, evicted: 0 },
        dataSource: { attempted: 1, accepted: 0, duplicates: 1, evicted: 0 },
        observations: { attempted: 2, accepted: 0, duplicates: 2, evicted: 0 },
        observationGroups: { attempted: 1, accepted: 0, duplicates: 1, evicted: 0 },
        timeSeriesSamples: { attempted: 1, accepted: 0, duplicates: 1, evicted: 0 },
        activitySessions: { attempted: 1, accepted: 0, duplicates: 1, evicted: 0 }
      });
      expect(firstImportResult.auditEvent.detail).toContain("observations: 1 accepted, 1 duplicate(s), 0 evicted");
      expect(repeatedImportResult.auditEvent.detail).toContain("observations: 0 accepted, 2 duplicate(s), 0 evicted");
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
        observations: [], observationGroups: [], timeSeriesSamples: samples, activitySessions: []
      });
      expect(first.outcome.timeSeriesSamples).toEqual({
        attempted: sampleCount, accepted: sampleCount, duplicates: 0, evicted: 0
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
        activitySessions: []
      });
      expect(second.outcome.timeSeriesSamples).toEqual({ attempted: 1, accepted: 1, duplicates: 0, evicted: 0 });
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

  it.skipIf(!httpfsExtensionPath)("upgrades a version-1 encrypted schema transactionally and idempotently on open", async () => {
    const databasePath = join(root, "databases", "health-store-schema-v1.duckdb-poc");
    const options = { httpfsExtensionPath };
    await createDuckDbSchema(root, databasePath, key, options, 1);

    const upgraded = await DuckDbRepository.open(root, databasePath, key, options);
    try {
      expect(await upgraded.schemaVersions()).toEqual([1, 2, 3, 4]);
      expect(await upgraded.dailyMetrics()).toEqual([]);
      expect(await upgraded.weeklyMetrics()).toEqual([]);
    } finally {
      await upgraded.close();
    }

    const upgradedHandle = await openEncryptedDuckDbDatabase(root, databasePath, key, options);
    try {
      const columns = await querySql(upgradedHandle.connection, `SELECT column_name
        FROM information_schema.columns
        WHERE table_catalog = current_database() AND table_name = 'profile'
        ORDER BY column_name;`);
      expect(columns.map((row) => row.column_name)).toContain("birth_date");
      expect(columns.map((row) => row.column_name)).not.toContain("birth_year");
    } finally {
      await closeEncryptedDuckDbDatabase(upgradedHandle);
    }

    const reopened = await DuckDbRepository.open(root, databasePath, key, options);
    try {
      expect(await reopened.schemaVersions()).toEqual([1, 2, 3, 4]);
    } finally {
      await reopened.close();
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
    await execSql(futureHandle.connection, "INSERT INTO poc_metadata VALUES (2, CURRENT_TIMESTAMP, 'synthetic');");
    await execSql(futureHandle.connection, "INSERT INTO poc_metadata VALUES (3, CURRENT_TIMESTAMP, 'synthetic');");
    await execSql(futureHandle.connection, "INSERT INTO poc_metadata VALUES (4, CURRENT_TIMESTAMP, 'synthetic');");
    await execSql(futureHandle.connection, "INSERT INTO poc_metadata VALUES (5, CURRENT_TIMESTAMP, 'future');");
    await execSql(futureHandle.connection, "CHECKPOINT;");
    await closeEncryptedDuckDbDatabase(futureHandle);
    const futureHash = hashFile(futurePath);
    await expect(DuckDbRepository.open(root, futurePath, key, options)).rejects.toThrow("newer than supported");
    expect(hashFile(futurePath)).toBe(futureHash);
  }, 30_000);
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

function findPreparedExtension(): string | undefined {
  return [
    process.env.LFA_DUCKDB_HTTPFS_EXTENSION,
    resolve(process.cwd(), "apps", "desktop", "build", "duckdb-extensions", "httpfs.duckdb_extension"),
    resolve(process.cwd(), "..", "desktop", "build", "duckdb-extensions", "httpfs.duckdb_extension")
  ].find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}