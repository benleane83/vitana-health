import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureRuntimeSecurity } from "../security.js";

const originalEnvironment = { ...process.env };
const temporaryDirectories: string[] = [];

afterEach(() => {
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

  it("preserves generated TLS bytes while migrating retired filenames", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vitana-security-test-"));
    temporaryDirectories.push(dataDir);
    process.env.VITANA_DATA_DIR = dataDir;
    delete process.env.VITANA_OWNER_TOKEN;
    delete process.env.VITANA_TLS_CERT;
    delete process.env.VITANA_TLS_KEY;

    const generated = await configureRuntimeSecurity("0.0.0.0");
    const certificateBytes = readFileSync(generated.tlsCertPath!);
    const keyBytes = readFileSync(generated.tlsKeyPath!);
    const tlsDir = join(dataDir, "tls");
    const retiredStem = ["local", "fitness", "advisor"].join("-");
    const retiredCertificate = join(tlsDir, `${retiredStem}.crt`);
    const retiredKey = join(tlsDir, `${retiredStem}.key`);
    renameSync(generated.tlsCertPath!, retiredCertificate);
    renameSync(generated.tlsKeyPath!, retiredKey);
    delete process.env.VITANA_TLS_CERT;
    delete process.env.VITANA_TLS_KEY;

    const migrated = await configureRuntimeSecurity("0.0.0.0");
    expect(readFileSync(migrated.tlsCertPath!)).toEqual(certificateBytes);
    expect(readFileSync(migrated.tlsKeyPath!)).toEqual(keyBytes);
    expect(migrated.publicKeyHash).toBe(generated.publicKeyHash);
    expect(existsSync(retiredCertificate)).toBe(false);
    expect(existsSync(retiredKey)).toBe(false);
  });
});
