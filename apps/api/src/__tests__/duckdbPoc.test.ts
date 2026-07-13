import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertPocRoot, createPocSchema, initializePocRoot, proveNativeEncryption } from "../poc/duckdbPoc.js";

let root: string;

beforeEach(() => {
  root = initializePocRoot(mkdtempSync(join(tmpdir(), "lfa-duckdb-poc-test-")));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("encrypted DuckDB PoC boundary", () => {
  it("requires a marker before using a PoC root", () => {
    expect(() => assertPocRoot(join(root, "missing"))).toThrow("unmarked DuckDB PoC root");
  });

  it("keeps schema creation inside the marked root", async () => {
    const databasePath = join(root, "databases", "profile.duckdb-poc");
    await expect(createPocSchema(root, join(tmpdir(), "outside.duckdb"), Buffer.alloc(32, 2).toString("base64"))).rejects.toThrow(
      "must remain beneath"
    );
    await expect(createPocSchema(root, databasePath, Buffer.alloc(32, 1).toString("base64"))).rejects.toThrow(
      "read-only crypto module"
    );
    expect(existsSync(databasePath)).toBe(false);
  });

  it("rejects writable encryption when httpfs is unavailable", async () => {
    await expect(proveNativeEncryption(root)).rejects.toThrow("read-only crypto module");
  });

  it.skipIf(!process.env.LFA_DUCKDB_HTTPFS_EXTENSION)(
    "passes all native-encryption gates with an explicit signed httpfs extension",
    async () => {
      const result = await proveNativeEncryption(root, {
        httpfsExtensionPath: process.env.LFA_DUCKDB_HTTPFS_EXTENSION
      });
      expect(result).toMatchObject({
        encrypted: true,
        correctKeyRead: true,
        missingKeyRejected: true,
        wrongKeyRejected: true,
        walCreated: true,
        tempSpillCreated: true,
        sensitiveValuesAbsent: true,
        rejectedKeysPreservedDatabase: true
      });
    },
    30_000
  );
});
