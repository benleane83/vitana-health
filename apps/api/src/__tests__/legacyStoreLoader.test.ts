import { createCipheriv, scryptSync } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initializePocRoot } from "../poc/duckdbPoc.js";
import { createPocHealthStoreFixture } from "../poc/fixtureFactory.js";
import { loadLegacyStoreCopy } from "../poc/legacyStoreLoader.js";

const passphrase = "phase-2-read-only-loader-test-secret";
let root: string;

beforeEach(() => {
  root = initializePocRoot(mkdtempSync(join(tmpdir(), "lfa-legacy-loader-test-")));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("read-only legacy health-store loader", () => {
  it("loads an exact v2 snapshot including raw source content without changing the copy", () => {
    const fixture = createPocHealthStoreFixture();
    const inputPath = writeEncryptedCopy("health-store-profile-a.enc", fixture);
    const before = captureInput(inputPath);

    const result = loadLegacyStoreCopy(root, inputPath, passphrase);

    expect(result).toEqual({ data: fixture, migrated: false });
    expect(captureInput(inputPath)).toEqual(before);
  });

  it("migrates v1 only in memory and leaves the encrypted copy byte-for-byte unchanged", () => {
    const fixture = createPocHealthStoreFixture();
    const legacy = { ...fixture, schemaVersion: 1, observationGroups: undefined };
    const inputPath = writeEncryptedCopy("health-store-v1.enc", legacy);
    const before = captureInput(inputPath);

    const result = loadLegacyStoreCopy(root, inputPath, passphrase);

    expect(result.migrated).toBe(true);
    expect(result.data.schemaVersion).toBe(2);
    expect(result.data.observations).toEqual(fixture.observations);
    expect(captureInput(inputPath)).toEqual(before);
  });

  it("rejects a wrong key without changing the input directory or encrypted copy", () => {
    const inputPath = writeEncryptedCopy("health-store-wrong-key.enc", createPocHealthStoreFixture());
    const before = captureInput(inputPath);

    expect(() => loadLegacyStoreCopy(root, inputPath, "incorrect-passphrase")).toThrow();
    expect(captureInput(inputPath)).toEqual(before);
  });

  it("rejects corrupted ciphertext without changing the input directory or encrypted copy", () => {
    const inputPath = join(root, "input-copy", "health-store-corrupt.enc");
    const envelope = createEncryptedEnvelope(createPocHealthStoreFixture());
    envelope.payload = `${envelope.payload.slice(0, -4)}AAAA`;
    writeFileSync(inputPath, JSON.stringify(envelope), { mode: 0o400 });
    const before = captureInput(inputPath);

    expect(() => loadLegacyStoreCopy(root, inputPath, passphrase)).toThrow();
    expect(captureInput(inputPath)).toEqual(before);
  });

  it("refuses to read a store outside input-copy", () => {
    const outsidePath = join(root, "health-store-outside.enc");
    writeEncryptedEnvelope(outsidePath, createPocHealthStoreFixture());

    expect(() => loadLegacyStoreCopy(root, outsidePath, passphrase)).toThrow("beneath the marked PoC input-copy");
  });
});

function writeEncryptedCopy(name: string, data: unknown): string {
  const path = join(root, "input-copy", name);
  writeEncryptedEnvelope(path, data);
  return path;
}

function writeEncryptedEnvelope(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(createEncryptedEnvelope(data)), { mode: 0o400 });
}

function createEncryptedEnvelope(data: unknown): { version: 1; salt: string; iv: string; tag: string; payload: string } {
  const salt = Buffer.alloc(16, 1);
  const iv = Buffer.alloc(12, 2);
  const cipher = createCipheriv("aes-256-gcm", scryptSync(passphrase, salt, 32), iv);
  const payload = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
  return {
    version: 1,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    payload: payload.toString("base64")
  };
}

function captureInput(path: string): { bytes: Buffer; modifiedAt: number; names: string[] } {
  return {
    bytes: readFileSync(path),
    modifiedAt: statSync(path).mtimeMs,
    names: readdirSync(join(root, "input-copy")).sort()
  };
}

