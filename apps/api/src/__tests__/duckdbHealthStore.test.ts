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
    expect(first).toBe(deriveProfileDatabaseKey("desktop-passphrase", "self"));
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
      expect(store.snapshot({ includeRaw: true })).toEqual(fixture);
      expect(store.snapshot().sourceImports[0]?.rawContent).toBeUndefined();

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
      expect(reopened.snapshot().insights[0]?.id).toBe("adapter-insight");
      expect(reopened.snapshot().observations.some((entry) => entry.id === "observation-z")).toBe(false);
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