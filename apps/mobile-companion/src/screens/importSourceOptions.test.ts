import { describe, expect, it } from "vitest";
import { buildImportSourceOptions } from "./importSourceOptions";

describe("import source options", () => {
  it("includes Sync when the device has an active health source provider", () => {
    expect(buildImportSourceOptions({ label: "Health Connect" }, "android")).toEqual([
      {
        source: "sync",
        title: "Sync",
        detail: "Bring in recent health data from this Android device."
      },
      expect.objectContaining({ source: "scan" }),
      expect.objectContaining({ source: "manual" })
    ]);
  });

  it("omits Sync when no health source provider is available", () => {
    expect(buildImportSourceOptions(undefined, "ios").map((option) => option.source))
      .toEqual(["scan", "manual"]);
  });
});