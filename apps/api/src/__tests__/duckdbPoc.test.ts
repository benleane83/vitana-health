import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

  it("creates the v2 schema only beneath a marked PoC root", async () => {
    const databasePath = join(root, "databases", "profile.duckdb-poc");
    await createPocSchema(root, databasePath, Buffer.alloc(32, 1).toString("base64"));
    expect(existsSync(databasePath)).toBe(true);
    expect(() => createPocSchema(root, join(tmpdir(), "outside.duckdb"), "key")).toThrow();
  });

  it("proves native AES-GCM encryption and wrong-key refusal", async () => {
    const result = await proveNativeEncryption(root);
    expect(result.correctKeyRead).toBe(true);
    expect(result.missingKeyRejected).toBe(true);
    expect(result.wrongKeyRejected).toBe(true);
    expect(result.encrypted).toBe(true);
    expect(readFileSync(result.databasePath).includes(Buffer.from("health-marker-"))).toBe(false);
  });
});
