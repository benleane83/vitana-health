import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RestoreJournal } from "../storage/restoreJournal.js";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("RestoreJournal", () => {
  it("recovers an interrupted swap and restores metadata", () => {
    tempDir = mkdtempSync(join(tmpdir(), "vitana-restore-journal-"));
    const livePath = join(tempDir, "health-store-self.duckdb");
    const stagedPath = `${livePath}.restore-test`;
    const rollbackPath = `${livePath}.pre-restore-test`;
    const metadataPath = join(tempDir, "storage-backend.json");
    writeFileSync(livePath, "old database");
    writeFileSync(metadataPath, "old metadata");

    const journal = new RestoreJournal(tempDir, "interrupted");
    journal.snapshotMetadataFile(metadataPath);
    journal.addEntry({
      profileId: "self",
      decision: "replace",
      originalDatabaseFile: livePath,
      newDatabaseFile: livePath,
      stagedDatabaseFile: stagedPath,
      rollbackDatabaseFile: rollbackPath,
      status: "hydrated"
    });
    writeFileSync(stagedPath, "new database");
    renameSync(livePath, rollbackPath);
    renameSync(stagedPath, livePath);
    writeFileSync(metadataPath, "new metadata");

    expect(RestoreJournal.recover(tempDir)).toBe(1);
    expect(readFileSync(livePath, "utf8")).toBe("old database");
    expect(readFileSync(metadataPath, "utf8")).toBe("old metadata");
    expect(existsSync(join(tempDir, "restore-journals", "interrupted.json"))).toBe(false);
  });

  it("recovers a crash landing between the two renames, with no live database on disk", () => {
    tempDir = mkdtempSync(join(tmpdir(), "vitana-restore-journal-"));
    const livePath = join(tempDir, "health-store-self.duckdb");
    const stagedPath = `${livePath}.restore-midswap`;
    const rollbackPath = `${livePath}.pre-restore-midswap`;
    const metadataPath = join(tempDir, "storage-backend.json");
    writeFileSync(livePath, "old database");
    writeFileSync(metadataPath, "old metadata");

    const journal = new RestoreJournal(tempDir, "midswap");
    journal.snapshotMetadataFile(metadataPath);
    journal.addEntry({
      profileId: "self",
      decision: "replace",
      originalDatabaseFile: livePath,
      newDatabaseFile: livePath,
      stagedDatabaseFile: stagedPath,
      rollbackDatabaseFile: rollbackPath,
      status: "hydrated"
    });
    writeFileSync(stagedPath, "new database");
    // The crash window: the old database has been moved aside but the staged one has not been
    // moved into place, so there is no live database at all.
    renameSync(livePath, rollbackPath);
    expect(existsSync(livePath)).toBe(false);

    expect(RestoreJournal.recover(tempDir)).toBe(1);
    expect(readFileSync(livePath, "utf8")).toBe("old database");
    expect(readFileSync(metadataPath, "utf8")).toBe("old metadata");
    expect(existsSync(stagedPath)).toBe(false);
    expect(existsSync(rollbackPath)).toBe(false);
    expect(existsSync(join(tempDir, "restore-journals", "midswap.json"))).toBe(false);
  });
});
