import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { certificatePublicKeyHash, configureRuntimeSecurity } from "../security.js";

const originalEnvironment = { ...process.env };
const temporaryDirectories: string[] = [];

afterEach(() => {
  process.env = { ...originalEnvironment };
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("LAN runtime security", () => {
  it("persists generated credentials and a pinned TLS identity", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "lfa-security-test-"));
    temporaryDirectories.push(dataDir);
    process.env.LFA_DATA_DIR = dataDir;
    delete process.env.LFA_OWNER_TOKEN;
    delete process.env.LFA_TLS_CERT;
    delete process.env.LFA_TLS_KEY;

    const first = await configureRuntimeSecurity("0.0.0.0");
    delete process.env.LFA_OWNER_TOKEN;
    delete process.env.LFA_TLS_CERT;
    delete process.env.LFA_TLS_KEY;
    const second = await configureRuntimeSecurity("0.0.0.0");

    expect(first.ownerToken).toHaveLength(43);
    expect(second.ownerToken).toBe(first.ownerToken);
    expect(second.publicKeyHash).toBe(first.publicKeyHash);
    expect(first.tlsCertPath).toBeTruthy();
    expect(certificatePublicKeyHash(readFileSync(first.tlsCertPath!, "utf8"))).toBe(first.publicKeyHash);
  });
});