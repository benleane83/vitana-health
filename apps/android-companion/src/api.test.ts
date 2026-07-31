import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@vitana/api-client";
import type { ConnectionDetails } from "./endpointStore";

const pinnedFetch = vi.fn();
vi.mock("./pinnedFetch", () => ({ DEFAULT_PINNED_REQUEST_TIMEOUT_MS: 15_000, pinnedFetch }));

const connection: ConnectionDetails = {
  url: "https://pc.local:4317/",
  deviceId: "device-1",
  token: "companion-token",
  publicKeyHash: "sha256/test",
  name: "Home PC",
  pairedAt: "2026-01-01",
  lastSyncAt: null,
  healthSourceCursors: {},
  healthSourceSessionKey: null,
  healthConnectSyncWindowDays: 30,
  healthSourceCategories: [],
  healthConnectDisclosureAcknowledged: false
};

describe("companion API adapter", () => {
  beforeEach(() => pinnedFetch.mockReset());

  it("adds the companion credential and preserves the public-key pin", async () => {
    pinnedFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, uptime: 1 }),
      text: async () => ""
    });
    const { createCompanionApi } = await import("./api");

    await createCompanionApi(connection).health();

    expect(pinnedFetch).toHaveBeenCalledWith(
      "https://pc.local:4317/api/health",
      "sha256/test",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ "x-companion-token": "companion-token" })
      })
    );
  });

  it("fetches and validates a bounded profile photo through the pinned transport", async () => {
    pinnedFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        contentType: "image/jpeg",
        contentBase64: "/9j/4P/Z",
        revision: "a".repeat(64),
        updatedAt: "2026-07-24T10:00:00.000Z"
      }),
      text: async () => ""
    });
    const { createCompanionApi } = await import("./api");

    await expect(createCompanionApi(connection).profilePhoto.get()).resolves.toMatchObject({
      contentType: "image/jpeg",
      revision: "a".repeat(64)
    });
    expect(pinnedFetch).toHaveBeenCalledWith(
      "https://pc.local:4317/api/profile/photo",
      "sha256/test",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ "x-companion-token": "companion-token" })
      })
    );
  });

  it("rejects malformed photo data returned by the PC", async () => {
    pinnedFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        contentType: "image/png",
        contentBase64: "invalid",
        revision: "bad",
        updatedAt: "today"
      }),
      text: async () => ""
    });
    const { createCompanionApi } = await import("./api");
    await expect(createCompanionApi(connection).profilePhoto.get()).rejects.toMatchObject({ name: "ZodError" });
  });
});

describe("connection state transitions", () => {
  it.each([
    [new ApiError("maintenance", 503, "MAINTENANCE_MODE"), "maintenance"],
    [new ApiError("expired", 401, "AUTH_REQUIRED"), "re-pair-required"],
    [new ApiError("denied", 403, "CAPABILITY_REQUIRED"), "re-pair-required"],
    [new Error("offline"), "unreachable"]
  ])("maps request failures to an explicit state", async (error, expected) => {
    const { connectionStateForError } = await import("./connectionState");
    expect(connectionStateForError(error)).toBe(expected);
  });

  it("uses user-facing labels instead of internal state names", async () => {
    const { connectionStateLabel } = await import("./connectionState");
    expect(connectionStateLabel("unreachable")).toBe("PC unavailable");
    expect(connectionStateLabel("re-pair-required")).toBe("Re-pair required");
  });
});
