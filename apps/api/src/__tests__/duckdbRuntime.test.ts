import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertDuckDbRoot, createDuckDbSchema, initializeDuckDbRoot } from "../storage/duckdbRuntime.js";

let root: string;

beforeEach(() => {
  root = initializeDuckDbRoot(mkdtempSync(join(tmpdir(), "lfa-duckdb-runtime-test-")));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("encrypted DuckDB runtime boundary", () => {
  it("requires a marker before using a storage root", () => {
    expect(() => assertDuckDbRoot(join(root, "missing"))).toThrow("unmarked encrypted DuckDB root");
  });

  it("keeps schema creation inside the marked root", async () => {
    const databasePath = join(root, "databases", "profile.duckdb");
    await expect(createDuckDbSchema(root, join(tmpdir(), "outside.duckdb"), Buffer.alloc(32, 2).toString("base64"))).rejects.toThrow(
      "must remain beneath"
    );
    await expect(createDuckDbSchema(root, databasePath, Buffer.alloc(32, 1).toString("base64"))).rejects.toThrow(
      "read-only crypto module"
    );
    expect(existsSync(databasePath)).toBe(false);
  });
});
