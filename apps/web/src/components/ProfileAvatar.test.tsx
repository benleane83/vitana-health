// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api.js";
import { ProfileAvatar } from "./ProfileAvatar.js";

describe("ProfileAvatar", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads photos for specific profiles without switching the active profile", async () => {
    const getPhoto = vi.spyOn(api.profilePhoto, "get").mockImplementation(async (profileId) => ({
      contentType: "image/jpeg",
      contentBase64: profileId === "alex" ? "YWxleA==" : "c2Ft",
      revision: `revision-${profileId}`,
      updatedAt: "2026-08-09T10:00:00.000Z"
    }));
    const { container } = render(
      <>
        <ProfileAvatar displayName="Alex" profileId="alex" revision="revision-alex" />
        <ProfileAvatar displayName="Sam" profileId="sam" revision="revision-sam" />
      </>
    );

    await waitFor(() => expect(container.querySelectorAll("img")).toHaveLength(2));

    expect(getPhoto).toHaveBeenCalledWith("alex");
    expect(getPhoto).toHaveBeenCalledWith("sam");
    expect([...container.querySelectorAll("img")].map((image) => image.src)).toEqual([
      "data:image/jpeg;base64,YWxleA==",
      "data:image/jpeg;base64,c2Ft"
    ]);
  });
});