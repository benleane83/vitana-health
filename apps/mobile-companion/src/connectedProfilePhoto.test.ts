import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@vitana/api-client";
import { refreshConnectedProfilePhoto } from "./connectedProfilePhoto";

const photo = {
  contentBase64: "AAAA",
  contentType: "image/jpeg",
  revision: "revision-2",
  updatedAt: "2026-08-09T08:00:00.000Z"
};

describe("refreshConnectedProfilePhoto", () => {
  it("caches a live photo without requiring replica metadata", async () => {
    const cache = vi.fn(() => "file:///profile-photo.jpg");

    await expect(refreshConnectedProfilePhoto(async () => photo, cache)).resolves.toEqual({
      revision: photo.revision,
      updatedAt: photo.updatedAt,
      uri: "file:///profile-photo.jpg"
    });
    expect(cache).toHaveBeenCalledWith(photo);
  });

  it("clears a cached photo when the PC reports it was removed", async () => {
    const previous = { revision: "revision-1", updatedAt: "2026-08-08T08:00:00.000Z", uri: "file:///old.jpg" };
    await expect(refreshConnectedProfilePhoto(
      async () => { throw new ApiError("Not found", 404, "PROFILE_PHOTO_NOT_FOUND"); },
      vi.fn(),
      previous
    )).resolves.toBeUndefined();
  });

  it("keeps the cached photo when a refresh fails transiently", async () => {
    const previous = { revision: "revision-1", updatedAt: "2026-08-08T08:00:00.000Z", uri: "file:///old.jpg" };
    await expect(refreshConnectedProfilePhoto(
      async () => { throw new Error("PC offline"); },
      vi.fn(),
      previous
    )).resolves.toBe(previous);
  });
});