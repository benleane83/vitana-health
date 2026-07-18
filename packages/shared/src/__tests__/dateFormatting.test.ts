import { describe, expect, it } from "vitest";
import { isUtcMidnightTimestamp } from "../dateFormatting.js";

describe("isUtcMidnightTimestamp", () => {
  it("identifies UTC-midnight values as date-only measurements", () => {
    expect(isUtcMidnightTimestamp("2026-07-08T00:00:00.000Z")).toBe(true);
    expect(isUtcMidnightTimestamp("2026-07-08")).toBe(true);
  });

  it("keeps timestamps with a time portion and invalid values distinct", () => {
    expect(isUtcMidnightTimestamp("2026-07-08T04:00:00.000Z")).toBe(false);
    expect(isUtcMidnightTimestamp("not-a-date")).toBe(false);
  });
});