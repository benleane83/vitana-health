import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
});
