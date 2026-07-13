import { afterEach, describe, expect, it, vi } from "vitest";
import { callConfiguredModel } from "../modelClient.js";

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
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
});
