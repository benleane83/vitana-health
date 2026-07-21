import { afterEach, describe, expect, it, vi } from "vitest";

const nativeModule = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("../modules/vitana-pinned-http/src/VitanaPinnedHttpModule", () => ({ default: nativeModule }));

import { LONG_RUNNING_PINNED_REQUEST_TIMEOUT_MS, pinnedFetch } from "./pinnedFetch";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("pinnedFetch", () => {
  it("forwards HTTPS requests through the native pinned client", async () => {
    nativeModule.request.mockResolvedValue({ status: 201, body: '{"ok":true}', headers: {} });

    const response = await pinnedFetch("https://desktop.test/api/profiles", "server-pin", {
      method: "POST",
      headers: { Authorization: "Bearer companion-token" },
      body: "{}"
    });

    expect(nativeModule.request).toHaveBeenCalledWith(
      "https://desktop.test/api/profiles",
      "POST",
      { authorization: "Bearer companion-token" },
      "{}",
      "server-pin",
      15_000
    );
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("rejects HTTPS before a request when the QR key pin is missing", async () => {
    await expect(pinnedFetch("https://desktop.test/api/profiles", null)).rejects.toThrow("did not include a server identity");
    expect(nativeModule.request).not.toHaveBeenCalled();
  });

  it("uses ordinary fetch only for explicitly non-HTTPS development endpoints", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await pinnedFetch("http://127.0.0.1:4317/api/health", null);

    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:4317/api/health", {});
    expect(nativeModule.request).not.toHaveBeenCalled();
  });

  it("stops waiting for a stalled request at the configured timeout", async () => {
    vi.useFakeTimers();
    nativeModule.request.mockImplementation(() => new Promise(() => undefined));

    try {
      const pending = pinnedFetch("https://desktop.test/api/health", "server-pin", { timeoutMs: 1_000 });
      const rejection = expect(pending).rejects.toThrow("Connection timed out after 1 second");
      await vi.advanceTimersByTimeAsync(1_000);
      await rejection;
      expect(nativeModule.request).toHaveBeenCalledWith(
        "https://desktop.test/api/health",
        "GET",
        {},
        null,
        "server-pin",
        1_000
      );
      expect(LONG_RUNNING_PINNED_REQUEST_TIMEOUT_MS).toBe(60_000);
    } finally {
      vi.useRealTimers();
    }
  });
});