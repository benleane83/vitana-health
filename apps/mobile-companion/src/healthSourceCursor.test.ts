import { describe, expect, it } from "vitest";
import { earliestHealthSourceCursor } from "./healthSourceCursor";

describe("earliestHealthSourceCursor", () => {
  it("returns the earliest cursor stored for a selected category", () => {
    expect(earliestHealthSourceCursor(
      { Steps: "2026-07-20T00:00:00.000Z", SleepSession: "2026-07-18T00:00:00.000Z" },
      ["Steps", "SleepSession"]
    )).toBe("2026-07-18T00:00:00.000Z");
  });

  it("keeps existing sync history when another selected category has no cursor", () => {
    expect(earliestHealthSourceCursor(
      { Steps: "2026-07-20T00:00:00.000Z" },
      ["Steps", "SleepSession"]
    )).toBe("2026-07-20T00:00:00.000Z");
  });

  it("returns null when no selected category has a cursor", () => {
    expect(earliestHealthSourceCursor({}, ["Steps", "SleepSession"])).toBeNull();
  });
});