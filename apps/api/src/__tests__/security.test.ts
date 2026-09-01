import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureOwnerTokenProtector, configureRuntimeSecurity } from "../security.js";

const originalEnvironment = { ...process.env };
const temporaryDirectories: string[] = [];

afterEach(() => {
  configureOwnerTokenProtector(undefined);
  process.env = { ...originalEnvironment };
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("runtime security", () => {
  it("does not create TLS files for a loopback-only development server", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vitana-security-test-"));
    temporaryDirectories.push(dataDir);
    process.env.VITANA_DATA_DIR = dataDir;
    delete process.env.VITANA_OWNER_TOKEN;
    delete process.env.VITANA_TLS_CERT;
    delete process.env.VITANA_TLS_KEY;

    const security = await configureRuntimeSecurity("127.0.0.1");
    expect(security.tlsCertPath).toBeNull();
    expect(security.publicKeyHash).toBeNull();
  });

  it("reuses the generated TLS material across restarts", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vitana-security-test-"));
    temporaryDirectories.push(dataDir);
    process.env.VITANA_DATA_DIR = dataDir;
    delete process.env.VITANA_OWNER_TOKEN;
    delete process.env.VITANA_TLS_CERT;
    delete process.env.VITANA_TLS_KEY;

    const generated = await configureRuntimeSecurity("0.0.0.0");
    const certificateBytes = readFileSync(generated.tlsCertPath!);
    const keyBytes = readFileSync(generated.tlsKeyPath!);
    delete process.env.VITANA_TLS_CERT;
    delete process.env.VITANA_TLS_KEY;

    // A second boot must not mint a new certificate: the pinned public-key hash the companion
    // trusts is derived from these bytes, so regenerating them would silently break pairing.
    const restarted = await configureRuntimeSecurity("0.0.0.0");
    expect(readFileSync(restarted.tlsCertPath!)).toEqual(certificateBytes);
    expect(readFileSync(restarted.tlsKeyPath!)).toEqual(keyBytes);
    expect(restarted.publicKeyHash).toBe(generated.publicKeyHash);
  });

  it("wraps a generated owner token with the desktop credential protector", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vitana-security-test-"));
    temporaryDirectories.push(dataDir);
    process.env.VITANA_DATA_DIR = dataDir;
    delete process.env.VITANA_OWNER_TOKEN;
    configureOwnerTokenProtector({
      encryptString: (value) => Buffer.from(`wrapped:${value}`),
      decryptString: (value) => value.toString("utf8").replace(/^wrapped:/, "")
    });

    const generated = await configureRuntimeSecurity("127.0.0.1");
    const persisted = JSON.parse(readFileSync(join(dataDir, "security.json"), "utf8"));
    expect(persisted).toEqual({
      credentialStorage: "electron-safe-storage-v1",
      wrappedOwnerToken: Buffer.from(`wrapped:${generated.ownerToken}`).toString("base64")
    });

    delete process.env.VITANA_OWNER_TOKEN;
    expect((await configureRuntimeSecurity("127.0.0.1")).ownerToken).toBe(generated.ownerToken);
  });

  it("migrates a legacy plaintext owner token when the desktop protector is available", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vitana-security-test-"));
    temporaryDirectories.push(dataDir);
    const legacyOwnerToken = "legacy-owner-token-that-is-long-enough";
    writeFileSync(join(dataDir, "security.json"), JSON.stringify({ ownerToken: legacyOwnerToken }));
    process.env.VITANA_DATA_DIR = dataDir;
    delete process.env.VITANA_OWNER_TOKEN;
    configureOwnerTokenProtector({
      encryptString: (value) => Buffer.from(`wrapped:${value}`),
      decryptString: (value) => value.toString("utf8").replace(/^wrapped:/, "")
    });

    expect((await configureRuntimeSecurity("127.0.0.1")).ownerToken).toBe(legacyOwnerToken);
    const persisted = readFileSync(join(dataDir, "security.json"), "utf8");
    expect(persisted).not.toContain(legacyOwnerToken);
    expect(JSON.parse(persisted).wrappedOwnerToken).toBeDefined();
  });

  it("fails closed when a standalone server encounters a desktop-wrapped token", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vitana-security-test-"));
    temporaryDirectories.push(dataDir);
    writeFileSync(join(dataDir, "security.json"), JSON.stringify({
      credentialStorage: "electron-safe-storage-v1",
      wrappedOwnerToken: Buffer.from("wrapped:desktop-owner-token-that-is-long-enough").toString("base64")
    }));
    process.env.VITANA_DATA_DIR = dataDir;
    delete process.env.VITANA_OWNER_TOKEN;

    await expect(configureRuntimeSecurity("127.0.0.1"))
      .rejects.toThrow("desktop-protected credential");
  });
});
