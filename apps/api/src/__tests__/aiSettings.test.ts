import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  configureAiCredentialProtector,
  getAiSettings,
  saveAiSettings,
  type AiCredentialProtector,
  type AiSettings
} from "../aiSettings.js";

const testSettings: AiSettings = {
  provider: "openai",
  endpoint: "https://example.test/v1/responses",
  apiKey: "test-api-key",
  model: "test-model",
  timeoutMs: 30000
};

let dataDirectory: string | undefined;
let originalDataDirectory: string | undefined;

afterEach(() => {
  configureAiCredentialProtector(undefined);
  if (originalDataDirectory === undefined) {
    delete process.env.VITANA_DATA_DIR;
  } else {
    process.env.VITANA_DATA_DIR = originalDataDirectory;
  }
  if (dataDirectory) rmSync(dataDirectory, { recursive: true, force: true });
  dataDirectory = undefined;
  originalDataDirectory = undefined;
});

describe("AI settings credential persistence", () => {
  it("wraps API keys when desktop credential protection is configured", () => {
    useTemporaryDataDirectory();
    configureAiCredentialProtector(testProtector());

    saveAiSettings(testSettings);

    const persisted = readFileSync(join(dataDirectory!, "ai-settings.json"), "utf8");
    expect(persisted).not.toContain(testSettings.apiKey!);
    expect(JSON.parse(persisted)).toMatchObject({
      credentialStorage: "electron-safe-storage-v1",
      wrappedApiKey: "d3JhcHBlZDp0ZXN0LWFwaS1rZXk="
    });
    expect(getAiSettings()).toEqual(testSettings);
  });

  it("migrates a legacy plaintext API key after opening it in the desktop", () => {
    useTemporaryDataDirectory();
    writeFileSync(join(dataDirectory!, "ai-settings.json"), JSON.stringify(testSettings), "utf8");
    configureAiCredentialProtector(testProtector());

    expect(getAiSettings()).toEqual(testSettings);

    const persisted = readFileSync(join(dataDirectory!, "ai-settings.json"), "utf8");
    expect(persisted).not.toContain(testSettings.apiKey!);
    expect(JSON.parse(persisted).wrappedApiKey).toBe("d3JhcHBlZDp0ZXN0LWFwaS1rZXk=");
  });

  it("retains plaintext settings compatibility for a standalone server", () => {
    useTemporaryDataDirectory();

    saveAiSettings(testSettings);

    const persisted = readFileSync(join(dataDirectory!, "ai-settings.json"), "utf8");
    expect(JSON.parse(persisted).apiKey).toBe(testSettings.apiKey);
    expect(getAiSettings()).toEqual(testSettings);
  });

  it("rejects a desktop-protected credential when the standalone server cannot unwrap it", () => {
    useTemporaryDataDirectory();
    configureAiCredentialProtector(testProtector());
    saveAiSettings(testSettings);
    configureAiCredentialProtector(undefined);

    expect(() => getAiSettings()).toThrow("cannot be opened by this standalone server");
  });
});

function useTemporaryDataDirectory(): void {
  originalDataDirectory = process.env.VITANA_DATA_DIR;
  dataDirectory = mkdtempSync(join(tmpdir(), "vitana-ai-settings-"));
  process.env.VITANA_DATA_DIR = dataDirectory;
}

function testProtector(): AiCredentialProtector {
  return {
    encryptString: (value) => Buffer.from(`wrapped:${value}`),
    decryptString: (value) => value.toString("utf8").replace(/^wrapped:/, "")
  };
}