import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initializeDuckDbRoot } from "../storage/duckdbRuntime.js";
import { createDuckDbHealthStoreFixture } from "./support/duckdbFixture.js";
import { DuckDbHealthStore, deriveProfileDatabaseKey } from "../storage/duckdbHealthStore.js";

const httpfsExtensionPath = findPreparedExtension();
let root: string;

beforeEach(() => {
  root = initializeDuckDbRoot(mkdtempSync(join(tmpdir(), "lfa-duckdb-health-store-test-")));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("DuckDbHealthStore", () => {
  it("derives stable profile-isolated 256-bit database keys", () => {
    const first = deriveProfileDatabaseKey("desktop-passphrase", "self");
    const legacyDuckDbKey = createHash("sha256")
      .update("local-fitness-advisor:duckdb-profile-key:v1\0", "utf8")
      .update("self", "utf8")
      .update("\0", "utf8")
      .update("desktop-passphrase", "utf8")
      .digest("base64");
    expect(first).toBe(deriveProfileDatabaseKey("desktop-passphrase", "self"));
    expect(first).toBe(legacyDuckDbKey);
    expect(first).not.toBe(deriveProfileDatabaseKey("desktop-passphrase", "other"));
    expect(Buffer.from(first, "base64")).toHaveLength(32);
  });

  it.skipIf(!httpfsExtensionPath)("serializes mutations, maintains cached snapshots, and reopens encrypted state", async () => {
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
      expect(await store.readSnapshot({ includeRaw: true })).toEqual(fixture);
      expect((await store.readSnapshot()).sourceImports[0]?.rawContent).toBeUndefined();

      const importResult = await store.mergeImport({
        sourceImport: {
          ...fixture.sourceImports[0],
          id: "adapter-import",
          fileName: "adapter.csv",
          checksum: "adapter-checksum"
        },
        dataSource: {
          ...fixture.dataSources[0],
          id: "adapter-source",
          importId: "adapter-import"
        },
        observations: [{
          ...fixture.observations[0],
          id: "adapter-observation",
          sourceId: "adapter-source"
        }],
        observationGroups: [],
        timeSeriesSamples: [],
        activitySessions: []
      });
      expect(importResult.counts).toMatchObject({ imports: 2, observations: 3 });
      expect((await store.readSnapshot()).observations.some((entry) => entry.id === "adapter-observation")).toBe(true);
      expect((await store.readSnapshot()).auditEvents[0]).toEqual(importResult.auditEvent);

      await Promise.all([
        store.addInsight({
          id: "adapter-insight",
          createdAt: "2026-07-13T00:00:00.000Z",
          title: "Adapter",
          body: "Serialized mutation",
          evidence: [],
          confidence: "medium",
          model: "deterministic",
          safetyNotice: "Test"
        }),
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
      expect((await reopened.readSnapshot()).insights[0]?.id).toBe("adapter-insight");
      expect((await reopened.readSnapshot()).observations.some((entry) => entry.id === "observation-z")).toBe(false);
    } finally {
      await reopened.close();
    }
  }, 30_000);
});

function findPreparedExtension(): string | undefined {
  return [
    process.env.LFA_DUCKDB_HTTPFS_EXTENSION,
    resolve(process.cwd(), "apps", "desktop", "build", "duckdb-extensions", "httpfs.duckdb_extension"),
    resolve(process.cwd(), "..", "desktop", "build", "duckdb-extensions", "httpfs.duckdb_extension")
  ].find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
}