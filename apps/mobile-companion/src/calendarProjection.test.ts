import { describe, expect, it } from "vitest";
import { calendarMonthFromEntries } from "./calendarProjection";

describe("calendar month projection", () => {
  it("assigns local dates before aggregating requested measurements", () => {
    const result = calendarMonthFromEntries(
      { month: "2026-07", timezone: "America/Los_Angeles", measurementCodes: ["steps", "weight"] },
      [
        { id: "steps-1", measurementCode: "steps", observedAt: "2026-08-01T01:00:00.000Z", value: 100, unit: "count", sourceLabel: "Watch" },
        { id: "steps-2", measurementCode: "steps", observedAt: "2026-08-01T02:00:00.000Z", value: 250, unit: "count", sourceLabel: "Watch" },
        { id: "weight-1", measurementCode: "weight", observedAt: "2026-07-31T20:00:00.000Z", value: 72.5, unit: "kg", sourceLabel: "Scale" },
        { id: "ignored", measurementCode: "heart_rate", observedAt: "2026-07-31T20:00:00.000Z", value: 65, unit: "bpm" }
      ]
    );

    expect(result.measurements).toEqual([
      expect.objectContaining({ date: "2026-07-31", measurementCode: "steps", value: 350, count: 2, min: 100, max: 250, sources: ["Watch"] }),
      expect.objectContaining({ date: "2026-07-31", measurementCode: "weight", value: 72.5, count: 1, sources: ["Scale"] })
    ]);
  });

  it("summarizes completed events only", () => {
    const result = calendarMonthFromEntries(
      { month: "2026-07", timezone: "UTC", measurementCodes: ["steps"] },
      [],
      [
        { id: "one", kind: "visit", status: "completed", occurredAt: "2026-07-10T09:00:00.000Z", source: "manual-entry" },
        { id: "two", kind: "immunization", status: "completed", occurredAt: "2026-07-10T12:00:00.000Z", source: "manual-entry" },
        { id: "three", kind: "other", status: "entered-in-error", occurredAt: "2026-07-10T14:00:00.000Z", source: "manual-entry" }
      ]
    );

    expect(result.events).toEqual([{ date: "2026-07-10", count: 2, kinds: ["immunization", "visit"] }]);
  });
});