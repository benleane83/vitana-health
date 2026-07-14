import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveAiSettings } from "../aiSettings.js";
import { callConfiguredModel } from "../modelClient.js";

const originalEnvironment = { ...process.env };
let dataDirectory: string | undefined;

afterEach(() => {
  process.env = { ...originalEnvironment };
  if (dataDirectory) rmSync(dataDirectory, { recursive: true, force: true });
  dataDirectory = undefined;
  vi.unstubAllGlobals();
});

describe("callConfiguredModel", () => {
  it("does not send requests to cloud providers without consent", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.OPENAI_RESPONSES_ENDPOINT = "https://example.test/v1/responses";
    process.env.OPENAI_API_KEY = "test-api-key";
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const result = await callConfiguredModel("private health evidence", { allowCloud: false });

    expect(result).toMatchObject({
      ok: false,
      provider: "openai",
      error: "Cloud model processing requires profile consent"
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses a saved OpenAI-compatible provider and API key", async () => {
    delete process.env.LLM_PROVIDER;
    delete process.env.OPENAI_RESPONSES_ENDPOINT;
    delete process.env.OPENAI_API_KEY;
    dataDirectory = mkdtempSync(join(tmpdir(), "lfa-model-client-test-"));
    process.env.LFA_DATA_DIR = dataDirectory;
    saveAiSettings({
      provider: "openai",
      endpoint: "https://openrouter.test/api/v1/chat/completions",
      apiKey: "saved-openrouter-key",
      model: "openrouter/free",
      timeoutMs: 30000
    });
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "local model ok" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetch);

    const result = await callConfiguredModel("Reply with exactly: local model ok");

    expect(result).toMatchObject({ ok: true, provider: "openai", text: "local model ok" });
    expect(fetch).toHaveBeenCalledWith(
      "https://openrouter.test/api/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer saved-openrouter-key" }),
        body: JSON.stringify({
          model: "openrouter/free",
          messages: [{ role: "user", content: "Reply with exactly: local model ok" }]
        })
      })
    );
  });
});
