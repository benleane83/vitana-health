import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { careItemKindCodes, healthEventKindCodes } from "@vitana/shared";
import { initializeDuckDbRoot } from "../storage/duckdbRuntime.js";
import { createDuckDbHealthStoreFixture } from "./support/duckdbFixture.js";
import { DuckDbHealthStore } from "../storage/duckdbHealthStore.js";
import { createTestProfileFixture } from "../dev/testProfileFixture.js";
import { findPreparedExtension } from "./support/duckdbExtension.js";

const httpfsExtensionPath = findPreparedExtension();
let root: string;

beforeEach(() => {
  root = initializeDuckDbRoot(mkdtempSync(join(tmpdir(), "vitana-duckdb-health-store-test-")));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("DuckDbHealthStore lifecycle", () => {
  it.skipIf(!httpfsExtensionPath)("serializes mutations and reopens encrypted state", async () => {
    const fixture = createDuckDbHealthStoreFixture();
    const databasePath = join(root, "databases", "health-store-self.duckdb");
    const options = {
      root,
      databasePath,
      profileId: fixture.profile.id,
      passphrase: "desktop-passphrase",
      securityMode: "os-secure-storage" as const,
      duckdb: { httpfsExtensionPath }
    };
    const store = await DuckDbHealthStore.hydrate(options, fixture);
    try {
      expect(await store.exportData()).toMatchObject({
        profile: fixture.profile,
        sourceImports: fixture.sourceImports
      });
      expect(await store.clinicianReportSourceImports()).toEqual([{
        fileName: fixture.sourceImports[0].fileName,
        sourceKind: fixture.sourceImports[0].sourceKind,
        importedAt: fixture.sourceImports[0].importedAt,
        status: fixture.sourceImports[0].status,
        rowCount: fixture.sourceImports[0].rowCount
      }]);
      const importResult = await store.mergeImport({
        sourceImport: { ...fixture.sourceImports[0], id: "adapter-import", fileName: "adapter.csv", checksum: "adapter-checksum" },
        dataSource: { ...fixture.dataSources[0], id: "adapter-source", importId: "adapter-import" },
        observations: [{ ...fixture.observations[0], id: "adapter-observation", sourceId: "adapter-source" }],
        observationGroups: [], timeSeriesSamples: [], measurementAggregates: [], activitySessions: []
      });
      expect(importResult.counts).toMatchObject({ imports: 2, observations: 3 });
      await Promise.all([
        store.addInsight({ id: "adapter-insight", createdAt: "2026-07-13T00:00:00.000Z", title: "Adapter", body: "Serialized mutation", evidence: [], confidence: "medium", model: "deterministic", safetyNotice: "Test" }),
        store.deleteObservation("observation-z")
      ]);
      const exported = await store.exportData();
      expect(exported.insights[0]?.id).toBe("adapter-insight");
      expect(exported.observations.some((entry) => entry.id === "observation-z")).toBe(false);
      expect(exported.auditEvents[0]?.eventType).toBe("export-created");
    } finally {
      await store.close();
    }

    const reopened = await DuckDbHealthStore.open(options);
    try {
      expect((await reopened.appBootstrap()).latestInsight?.id).toBe("adapter-insight");
      expect((await reopened.storageCounts()).observations).toBe(2);
    } finally {
      await reopened.close();
    }
  });

  it.skipIf(!httpfsExtensionPath)("hydrates and reopens the comprehensive synthetic profile", async () => {
    const fixture = createTestProfileFixture();
    const databasePath = join(root, "databases", "health-store-vitana-test-profile.duckdb");
    const options = {
      root,
      databasePath,
      profileId: fixture.profile.id,
      passphrase: "test-profile-passphrase",
      securityMode: "generated-local-key" as const,
      duckdb: { httpfsExtensionPath }
    };
    const expectedCounts = {
      observations: fixture.observations.length,
      samples: fixture.timeSeriesSamples.length,
      activities: fixture.activitySessions.length,
      healthEvents: fixture.healthEvents?.length,
      careItems: fixture.careItems?.length
    };

    const hydrated = await DuckDbHealthStore.hydrate(options, fixture);
    try {
      expect(await hydrated.storageCounts()).toMatchObject(expectedCounts);
      const exported = await hydrated.exportData();
      expect({
        ...exported,
        auditEvents: exported.auditEvents.filter((event) => event.eventType !== "export-created")
      }).toEqual(fixture);
    } finally {
      await hydrated.close();
    }

    const reopened = await DuckDbHealthStore.open(options);
    try {
      expect(await reopened.storageCounts()).toMatchObject(expectedCounts);
      expect((await reopened.measurementDetail("heart_rate", { offset: 0, limit: 10 })).entries).toHaveLength(10);
      expect((await reopened.measurementChartSeries("steps", { range: "3m", mode: "auto" })).points.length).toBeGreaterThan(80);
      expect((await reopened.listCareItems({ limit: 20 })).items).toHaveLength(careItemKindCodes.length);
      expect((await reopened.listHealthEvents({ limit: 20 })).items).toHaveLength(healthEventKindCodes.length);
      expect((await reopened.summary()).totals.types).toBe(fixture.measurementTypes.length);
    } finally {
      await reopened.close();
    }
  });
});