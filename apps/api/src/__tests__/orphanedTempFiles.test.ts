import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sweepOrphanedTempFiles } from "../storage/orphanedTempFiles.js";

const hourAgoSeconds = Math.floor(Date.now() / 1000) - 3600;

function makeDirectory(files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "vitana-orphan-sweep-"));
  for (const file of files) {
    const path = join(root, file);
    writeFileSync(path, "stale");
    utimesSync(path, hourAgoSeconds, hourAgoSeconds);
  }
  return root;
}

describe("sweepOrphanedTempFiles", () => {
  it("removes temp files from every naming scheme once their process is gone", () => {
    const root = makeDirectory([
      "health-store-self.duckdb.tmp-4242-1783788274796",
      "profiles.json.tmp-4242-1783788274796-a1b2c3d4",
      "paired-devices.json.4242.a1b2c3d4e5f6.tmp",
      "health-store-self.duckdb.hydrating-4242-a1b2c3d4e5f6",
      "health-store-self.duckdb"
    ]);
    try {
      const removed = sweepOrphanedTempFiles([root], { isProcessAlive: () => false });

      expect(removed).toBe(4);
      expect(readdirSync(root)).toEqual(["health-store-self.duckdb"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("leaves temp files belonging to a live process and files still being written", () => {
    const root = makeDirectory(["a.duckdb.tmp-4242-1783788274796"]);
    const fresh = join(root, "b.duckdb.tmp-9999-1783788274796");
    writeFileSync(fresh, "in-flight");
    try {
      expect(sweepOrphanedTempFiles([root], { isProcessAlive: (pid) => pid === 4242 })).toBe(0);
      expect(readdirSync(root)).toHaveLength(2);

      // A dead PID is not enough on its own - a file young enough to still be mid-write is kept.
      expect(sweepOrphanedTempFiles([root], { isProcessAlive: () => false })).toBe(1);
      expect(readdirSync(root)).toEqual(["b.duckdb.tmp-9999-1783788274796"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores directories that do not exist instead of throwing", () => {
    expect(sweepOrphanedTempFiles([join(tmpdir(), "vitana-missing-directory-xyz")])).toBe(0);
  });
});
