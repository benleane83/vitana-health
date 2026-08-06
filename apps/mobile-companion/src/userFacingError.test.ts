import { ApiError } from "@vitana/api-client";
import { describe, expect, it } from "vitest";
import { userFacingError } from "./userFacingError";

describe("userFacingError", () => {
  it("maps authentication and server failures to actionable messages", () => {
    expect(userFacingError(new ApiError("internal auth detail", 401, "AUTH"), "fallback"))
      .toContain("Pair this phone");
    expect(userFacingError(new ApiError("<html>proxy failure</html>", 500, "HTTP_ERROR"), "fallback"))
      .toBe("Your paired PC could not complete the request. Try again.");
  });

  it("hides URLs and low-level runtime details", () => {
    expect(userFacingError(new Error("Request failed. URL: https://192.168.1.2/api"), "Try again."))
      .toBe("Try again.");
    expect(userFacingError(new Error("java.net.SocketException"), "Try again."))
      .toBe("Try again.");
  });

  it("removes the native module wrapper from actionable errors", () => {
    const error = new Error(
      "Call to function 'VitanaPinnedHttp.request' has been rejected.\n" +
      "→ Caused by: The request timed out. Check that your paired PC is awake and reachable, then try again."
    );

    expect(userFacingError(error, "Try again.")).toBe(
      "The request timed out. Check that your paired PC is awake and reachable, then try again."
    );
  });

  it("keeps deliberate validation guidance", () => {
    expect(userFacingError(new Error("Select at least one data category to sync."), "Try again."))
      .toBe("Select at least one data category to sync.");
  });
});
