import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearPendingRevocation: vi.fn(),
  loadPendingRevocation: vi.fn(),
  pinnedFetch: vi.fn(),
  savePendingRevocation: vi.fn()
}));

vi.mock("./endpointStore", () => ({
  clearPendingRevocation: mocks.clearPendingRevocation,
  loadPendingRevocation: mocks.loadPendingRevocation,
  savePendingRevocation: mocks.savePendingRevocation
}));
vi.mock("./pinnedFetch", () => ({ pinnedFetch: mocks.pinnedFetch }));

import { queueConnectionRevocation, retryPendingRevocation } from "./pendingRevocation";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pinnedFetch.mockResolvedValue({ ok: true, status: 204 });
});

describe("pending connection revocation", () => {
  it("stores the credential securely before local connection data is removed", async () => {
    await queueConnectionRevocation({
      url: "https://desktop.test/",
      token: "token",
      publicKeyHash: "pin"
    });

    expect(mocks.savePendingRevocation).toHaveBeenCalledWith({
      url: "https://desktop.test/",
      token: "token",
      publicKeyHash: "pin"
    });
  });

  it("retries and clears a pending credential after revocation", async () => {
    mocks.loadPendingRevocation.mockResolvedValue({
      url: "https://desktop.test/",
      token: "token",
      publicKeyHash: "pin"
    });

    await retryPendingRevocation();

    expect(mocks.pinnedFetch).toHaveBeenCalledWith(
      "https://desktop.test/api/pairing/revoke-self",
      "pin",
      expect.objectContaining({ headers: { "x-companion-token": "token" } })
    );
    expect(mocks.clearPendingRevocation).toHaveBeenCalled();
  });

  it("retains a pending credential when the PC cannot revoke it", async () => {
    mocks.loadPendingRevocation.mockResolvedValue({
      url: "https://desktop.test",
      token: "token",
      publicKeyHash: "pin"
    });
    mocks.pinnedFetch.mockResolvedValue({ ok: false, status: 500 });

    await expect(retryPendingRevocation()).rejects.toThrow();
    expect(mocks.clearPendingRevocation).not.toHaveBeenCalled();
  });
});
