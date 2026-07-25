import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DuckDbRepository } from "../storage/duckdbRepository.js";
import { initializeDuckDbRoot } from "../storage/duckdbRuntime.js";
import { createDuckDbHealthStoreFixture } from "./support/duckdbFixture.js";

const httpfsExtensionPath = findPreparedExtension();
const key = Buffer.alloc(32, 19).toString("base64");
let root: string;

beforeEach(() => {
  root = initializeDuckDbRoot(mkdtempSync(join(tmpdir(), "vitana-companion-replica-")));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("encrypted DuckDB companion replica", () => {
  it.skipIf(!httpfsExtensionPath)("materializes a stable paginated snapshot then converges concurrent updates and tombstones", async () => {
    const fixture = createDuckDbHealthStoreFixture();
    const repository = await DuckDbRepository.hydrate(
      root,
      join(root, "databases", "replica.duckdb-poc"),
      key,
      fixture,
      { httpfsExtensionPath }
    );
    try {
      const snapshotHighWater = await repository.getReplicaHighWaterMark();
      const snapshotId = await repository.startReplicaSnapshot("pairing-1");
      const firstPage = await repository.replicaSnapshotPage("pairing-1", snapshotId, 0, 2);
      expect(firstPage?.changes).toHaveLength(2);

      const original = fixture.observations[0]!;
      await repository.updateObservation(original.id, {
        measurementCode: original.measurementCode,
        observedAt: original.observedAt,
        value: original.value + 5,
        unit: original.unit,
        note: "Updated during snapshot"
      });

      const snapshotChanges = [...(firstPage?.changes ?? [])];
      let offset = firstPage?.nextOffset;
      while (offset !== undefined) {
        const next = await repository.replicaSnapshotPage("pairing-1", snapshotId, offset, 2);
        snapshotChanges.push(...(next?.changes ?? []));
        offset = next?.nextOffset;
      }
      const snapshotObservation = snapshotChanges.find((change) =>
        change.entityType === "observation" && change.entityId === original.id);
      expect(snapshotObservation?.payload?.value).toBe(original.value);

      const updatePage = await repository.replicaDeltaPage(
        snapshotHighWater.sequence,
        undefined,
        100
      );
      expect(updatePage.changes).toEqual(expect.arrayContaining([
        expect.objectContaining({
          entityType: "observation",
          entityId: original.id,
          operation: "upsert",
          payload: expect.objectContaining({ value: original.value + 5 })
        })
      ]));

      await repository.deleteObservation(original.id);
      const deletePage = await repository.replicaDeltaPage(updatePage.highWaterMark.sequence, undefined, 100);
      expect(deletePage.changes).toEqual(expect.arrayContaining([
        expect.objectContaining({
          entityType: "observation",
          entityId: original.id,
          operation: "tombstone"
        })
      ]));
      expect(deletePage.changes.find((change) => change.entityId === original.id)?.payload).toBeUndefined();
    } finally {
      await repository.close();
    }
  });

  it.skipIf(!httpfsExtensionPath)("rolls canonical changes and sync revisions back atomically", async () => {
    const fixture = createDuckDbHealthStoreFixture();
    let failCommit = false;
    const repository = await DuckDbRepository.hydrate(
      root,
      join(root, "databases", "replica-rollback.duckdb-poc"),
      key,
      fixture,
      {
        httpfsExtensionPath,
        testHooks: {
          beforeTransactionCommit: async () => {
            if (failCommit) throw new Error("injected commit failure");
          }
        }
      }
    );
    try {
      const before = await repository.getReplicaHighWaterMark();
      const original = fixture.observations[0]!;
      failCommit = true;
      await expect(repository.updateObservation(original.id, {
        measurementCode: original.measurementCode,
        observedAt: original.observedAt,
        value: original.value + 10,
        unit: original.unit
      })).rejects.toThrow("injected commit failure");
      failCommit = false;

      expect(await repository.getReplicaHighWaterMark()).toEqual(before);
      expect((await repository.snapshot()).observations.find((entry) => entry.id === original.id)?.value)
        .toBe(original.value);
    } finally {
      await repository.close();
    }
  });
});

function findPreparedExtension(): string | undefined {
  const candidates = [
    process.env.DUCKDB_EXTENSION_PATH,
    resolve("data", "duckdb-poc", "extensions", "httpfs.duckdb_extension")
  ];
  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
}
