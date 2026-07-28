import { describe, expect, it, vi } from "vitest";
import { retryPinnedRequest } from "./retryPinnedRequest";

describe("retryPinnedRequest", () => {
  it("retries an interrupted pinned request without changing the operation", async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new Error("The connection to your paired PC was interrupted."))
      .mockResolvedValueOnce({ sessionId: "session-1" });
    const sleep = vi.fn(async () => undefined);

    await expect(retryPinnedRequest(request, { sleep })).resolves.toEqual({ sessionId: "session-1" });

    expect(request).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("does not retry an HTTP or validation failure", async () => {
    const failure = new Error("The migration manifest changed.");
    const request = vi.fn().mockRejectedValue(failure);
    const sleep = vi.fn(async () => undefined);

    await expect(retryPinnedRequest(request, { sleep })).rejects.toBe(failure);
    expect(request).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("returns the final network failure after three attempts", async () => {
    const failure = new Error("Connection timed out after 60 seconds.");
    const request = vi.fn().mockRejectedValue(failure);
    const sleep = vi.fn(async () => undefined);

    await expect(retryPinnedRequest(request, { sleep })).rejects.toBe(failure);
    expect(request).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 1000);
    expect(sleep).toHaveBeenNthCalledWith(2, 2000);
  });
});