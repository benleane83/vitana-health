import { describe, expect, it } from "vitest";
import { shouldCancelHealthSourceSync } from "./healthSourceSyncCoordinator";

describe("Health source sync app state handling", () => {
  it("allows the Health Connect permission activity to temporarily background the app", () => {
    expect(shouldCancelHealthSourceSync("inactive", "permissions")).toBe(false);
    expect(shouldCancelHealthSourceSync("background", "permissions")).toBe(false);
  });

  it("still cancels reads and uploads when the app leaves the foreground", () => {
    expect(shouldCancelHealthSourceSync("background", "reading")).toBe(true);
    expect(shouldCancelHealthSourceSync("inactive", "uploading")).toBe(true);
    expect(shouldCancelHealthSourceSync("active", "reading")).toBe(false);
  });
});