import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pinnedFetch: vi.fn()
}));

vi.mock("../pinnedFetch", () => ({
  DEFAULT_PINNED_REQUEST_TIMEOUT_MS: 15_000,
  pinnedFetch: mocks.pinnedFetch
}));

import { createReplicaNetwork } from "./replicaClient";

const connection = {
  url: "https://desktop.test",
  deviceId: "device-1",
  token: "token",
  publicKeyHash: "hash",
  name: "Desktop",
  pairedAt: "2026-07-27T14:00:00.000Z",
  lastSyncAt: null,
  serverInstanceId: null,
  profileId: null,
  pairingId: null,
  healthConnectSyncCursor: null,
  healthConnectSyncWindowDays: 30,
  healthConnectCategories: [],
  healthConnectDisclosureAcknowledged: false
};

describe("replica network", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the supplied timeout and retries an interrupted pinned GET", async () => {
    mocks.pinnedFetch
      .mockRejectedValueOnce(new Error("The connection to your paired PC was interrupted."))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ protocolVersion: 2 })
      });

    await expect(createReplicaNetwork(connection, 60_000).get("/api/companion/sync/handshake"))
      .resolves.toEqual({ protocolVersion: 2 });

    expect(mocks.pinnedFetch).toHaveBeenCalledTimes(2);
    expect(mocks.pinnedFetch).toHaveBeenLastCalledWith(
      "https://desktop.test/api/companion/sync/handshake",
      "hash",
      expect.objectContaining({ timeoutMs: 60_000 })
    );
  });
});