import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveAiSettings } from "../aiSettings.js";
import { callConfiguredModel } from "../modelClient.js";

vi.mock("../modelEndpointPolicy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../modelEndpointPolicy.js")>();
  return {
    ...actual,
    assertSafeCloudModelEndpoint: vi.fn(async (endpoint: string) => actual.cloudModelKind(new URL(endpoint).hostname))
  };
});

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
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
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
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        redirect: "manual",
        headers: expect.objectContaining({ authorization: "Bearer saved-openrouter-key" }),
        body: JSON.stringify({
          model: "openrouter/free",
          messages: [{ role: "user", content: "Reply with exactly: local model ok" }]
        })
      })
    );
  });

  it("uses the native Anthropic Messages API contract", async () => {
    dataDirectory = mkdtempSync(join(tmpdir(), "lfa-model-client-test-"));
    process.env.LFA_DATA_DIR = dataDirectory;
    saveAiSettings({
      provider: "openai",
      endpoint: "https://api.anthropic.com/v1/messages",
      apiKey: "anthropic-key",
      model: "claude-sonnet-4-5",
      timeoutMs: 30000
    });
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: "text", text: "local model ok" }] }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetch);

    const result = await callConfiguredModel("Reply with exactly: local model ok");

    expect(result).toMatchObject({ ok: true, text: "local model ok" });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        redirect: "manual",
        headers: expect.objectContaining({ "x-api-key": "anthropic-key", "anthropic-version": "2023-06-01" }),
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 256,
          messages: [{ role: "user", content: "Reply with exactly: local model ok" }]
        })
      })
    );
  });

  it.each([
    ["Azure AI Foundry", "https://fitness.services.ai.azure.com/openai/v1/chat/completions", "api-key"],
    ["AWS Bedrock", "https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1/chat/completions", "authorization"]
  ])("uses the supported %s OpenAI-compatible endpoint", async (_name, endpoint, credentialHeader) => {
    dataDirectory = mkdtempSync(join(tmpdir(), "lfa-model-client-test-"));
    process.env.LFA_DATA_DIR = dataDirectory;
    saveAiSettings({ provider: "openai", endpoint, apiKey: "provider-key", model: "test-model", timeoutMs: 30000 });
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "local model ok" } }] }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetch);

    expect(await callConfiguredModel("test prompt")).toMatchObject({ ok: true, text: "local model ok" });
    const headers = fetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers[credentialHeader]).toContain("provider-key");
  });

  it("does not follow model endpoint redirects with credentials", async () => {
    dataDirectory = mkdtempSync(join(tmpdir(), "lfa-model-client-test-"));
    process.env.LFA_DATA_DIR = dataDirectory;
    saveAiSettings({
      provider: "openai",
      endpoint: "https://api.openai.com/v1/responses",
      apiKey: "saved-key",
      model: "gpt-5.4-mini",
      timeoutMs: 30000
    });
    const fetch = vi.fn().mockResolvedValue(
      new Response("", { status: 302, headers: { location: "https://attacker.example/collect" } })
    );
    vi.stubGlobal("fetch", fetch);

    const result = await callConfiguredModel("test prompt");

    expect(result).toMatchObject({ ok: false, status: 302 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({ redirect: "manual" })
    );
  });
});
