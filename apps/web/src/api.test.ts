// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api.js";

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("API client response handling", () => {
  it("throws a structured ApiError from the public error envelope", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "Cloud model consent is required.",
      code: "CLOUD_CONSENT_REQUIRED",
      correlationId: "request-123"
    }), {
      status: 403,
      headers: { "content-type": "application/json" }
    })));

    await expect(api.health()).rejects.toEqual(expect.objectContaining({
      name: "ApiError",
      message: "Cloud model consent is required.",
      status: 403,
      code: "CLOUD_CONSENT_REQUIRED",
      correlationId: "request-123"
    }));
  });

  it("retains the correlation header for a non-JSON failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Service unavailable", {
      status: 503,
      headers: { "x-correlation-id": "request-456" }
    })));

    await expect(api.health()).rejects.toEqual(expect.objectContaining({
      message: "Service unavailable",
      status: 503,
      code: "HTTP_ERROR",
      correlationId: "request-456"
    }));
  });

  it("uses the correlation header when a structured error omits it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "Validation failed.",
      code: "VALIDATION_ERROR"
    }), {
      status: 400,
      headers: { "content-type": "application/json", "x-correlation-id": "request-789" }
    })));

    await expect(api.health()).rejects.toEqual(expect.objectContaining({
      code: "VALIDATION_ERROR",
      correlationId: "request-789"
    }));
  });

  it("rejects a successful response that violates its shared schema", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      uptime: "not-a-number"
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })));

    await expect(api.health()).rejects.toMatchObject({ name: "ZodError" });
  });
});
