import { describe, expect, it } from "vitest";
import {
  calendarDateToUtcMidnight,
  isUtcMidnightTimestamp,
  localDateFromCalendarDate,
  observationCalendarDate,
  usesDateOnlyObservation
} from "../dateFormatting.js";

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

describe("observation date-only helpers", () => {
  it("only uses date-only entry for latest aggregations", () => {
    expect(usesDateOnlyObservation("latest")).toBe(true);
    expect(usesDateOnlyObservation("average")).toBe(false);
    expect(usesDateOnlyObservation(undefined)).toBe(false);
  });

  it("serializes valid calendar dates as UTC midnight", () => {
    expect(calendarDateToUtcMidnight("2026-07-08")).toBe("2026-07-08T00:00:00.000Z");
    expect(calendarDateToUtcMidnight("2026-02-30")).toBeUndefined();
    expect(calendarDateToUtcMidnight("08/07/2026")).toBeUndefined();
  });

  it("preserves the UTC calendar day for existing date-only timestamps", () => {
    expect(observationCalendarDate("2026-07-08T00:00:00.000Z")).toBe("2026-07-08");
  });

  it("creates picker dates from local calendar components", () => {
    const date = localDateFromCalendarDate("2026-07-08");
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(6);
    expect(date?.getDate()).toBe(8);
  });
});