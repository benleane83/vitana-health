import { describe, expect, it, vi } from "vitest";
import {
  ModelEndpointPolicyError,
  assertSafeCloudModelEndpoint,
  cloudModelKind,
  validateModelEndpoint
} from "../modelEndpointPolicy.js";

describe("model endpoint policy", () => {
  it.each([
    ["openrouter.ai", "openrouter"],
    ["api.openai.com", "openai"],
    ["api.anthropic.com", "anthropic"],
    ["fitness.services.ai.azure.com", "azure"],
    ["fitness.inference.ai.azure.com", "azure"],
    ["fitness.openai.azure.com", "azure"],
    ["fitness.cognitiveservices.azure.com", "azure"],
    ["bedrock-runtime.us-east-1.amazonaws.com", "bedrock"],
    ["bedrock-runtime.cn-north-1.amazonaws.com.cn", "bedrock"],
    ["bedrock-runtime-fips.us-gov-west-1.amazonaws.com", "bedrock"]
  ])("supports %s", (hostname, expectedKind) => {
    expect(cloudModelKind(hostname)).toBe(expectedKind);
  });

  it("rejects unsupported cloud origins and non-HTTPS cloud URLs", () => {
    expect(() => validateModelEndpoint("openai", "https://attacker.example/v1/chat/completions")).toThrow(
      ModelEndpointPolicyError
    );
    expect(() => validateModelEndpoint("openai", "http://api.openai.com/v1/responses")).toThrow(
      "must use HTTPS"
    );
    expect(() => validateModelEndpoint("openai", "https://api.openai.com:8443/v1/responses")).toThrow(
      "standard port"
    );
  });

  it("allows only loopback HTTP or HTTPS endpoints for Ollama", () => {
    expect(validateModelEndpoint("ollama", "http://127.0.0.1:11434/api/generate").hostname).toBe("127.0.0.1");
    expect(validateModelEndpoint("ollama", "http://localhost:11434/api/generate").hostname).toBe("localhost");
    expect(() => validateModelEndpoint("ollama", "http://192.168.1.20:11434/api/generate")).toThrow(
      "on this computer"
    );
  });

  it.each(["127.0.0.1", "10.0.0.4", "169.254.169.254", "192.168.1.4", "::1", "::ffff:a9fe:a9fe", "fe80::a9fe:a9fe", "fd00::1"])(
    "rejects a supported hostname resolving to %s",
    async (address) => {
      const resolve = vi.fn().mockResolvedValue([{ address, family: address.includes(":") ? 6 : 4 }]);
      await expect(assertSafeCloudModelEndpoint("https://api.openai.com/v1/responses", resolve)).rejects.toThrow(
        "local, private, link-local, or reserved"
      );
    }
  );

  it("accepts a supported hostname only when every resolved address is public", async () => {
    const resolve = vi.fn().mockResolvedValue([
      { address: "104.18.12.123", family: 4 },
      { address: "2606:4700::6812:c7b", family: 6 }
    ]);
    await expect(assertSafeCloudModelEndpoint("https://openrouter.ai/api/v1/chat/completions", resolve)).resolves.toBe(
      "openrouter"
    );
  });
});