// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { centeredSquareCrop, normalizeProfilePhoto } from "./profilePhoto.js";
import { profileInitials } from "./components/ProfileAvatar.js";

afterEach(() => vi.unstubAllGlobals());

describe("profile photo crop geometry", () => {
  it.each([
    [600, 900, { sourceX: 0, sourceY: 150, sourceSize: 600 }],
    [900, 600, { sourceX: 150, sourceY: 0, sourceSize: 600 }],
    [600, 600, { sourceX: 0, sourceY: 0, sourceSize: 600 }]
  ])("centers a %sx%s source", (width, height, expected) => {
    expect(centeredSquareCrop(width, height)).toEqual(expected);
  });

  describe("profile avatar fallback", () => {
    it.each([
      ["Ada Lovelace", "AL"],
      ["  prince  ", "P"],
      ["", "?"]
    ])("creates deterministic initials for %j", (name, expected) => {
      expect(profileInitials(name)).toBe(expected);
    });
  });

  it("rejects invalid dimensions", () => {
    expect(() => centeredSquareCrop(0, 20)).toThrow("dimensions");
  });

  it("rejects unsupported and conservatively oversized sources before decoding", async () => {
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);
    await expect(normalizeProfilePhoto(new File(["text"], "photo.gif", { type: "image/gif" })))
      .rejects.toThrow("JPEG, PNG, or WebP");
    await expect(normalizeProfilePhoto(new File([new Uint8Array(10 * 1024 * 1024 + 1)], "photo.jpg", {
      type: "image/jpeg"
    }))).rejects.toThrow("smaller than 10 MB");
    expect(decode).not.toHaveBeenCalled();
  });

  it("rejects corrupt supported images", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("decode failed")));
    await expect(normalizeProfilePhoto(new File(["corrupt"], "photo.webp", { type: "image/webp" })))
      .rejects.toThrow("decode failed");
  });
});
