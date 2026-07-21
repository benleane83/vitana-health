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
  healthConnectSyncCursor: null,
  healthConnectSyncWindowDays: 30,
  healthConnectCategories: [],
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
});
