import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
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
    const dataDir = mkdtempSync(join(tmpdir(), "lfa-security-test-"));
    temporaryDirectories.push(dataDir);
    process.env.LFA_DATA_DIR = dataDir;
    delete process.env.LFA_OWNER_TOKEN;
    delete process.env.LFA_TLS_CERT;
    delete process.env.LFA_TLS_KEY;

    const security = await configureRuntimeSecurity("127.0.0.1");
    expect(security.tlsCertPath).toBeNull();
    expect(security.publicKeyHash).toBeNull();
  });
});
