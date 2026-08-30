import { describe, expect, it } from "vitest";
import type { ObservationGroup } from "@vitana/shared";
import { paginateObservationGroups } from "./observationGroupList";

const groups: ObservationGroup[] = [
  { id: "undated", kind: "custom", label: "Undated" },
  { id: "same-b", kind: "lab_panel", label: "Same B", collectedAt: "2026-08-20T12:00:00.000Z" },
  { id: "fallback-end", kind: "sleep_session", label: "Sleep", endAt: "2026-08-21T07:00:00.000Z" },
  { id: "same-a", kind: "lab_panel", label: "Same A", startAt: "2026-08-20T12:00:00.000Z" }
];

const observations = [
  { observationGroupId: "same-a" },
  { observationGroupId: "same-a" },
  { observationGroupId: "fallback-end" },
  { observationGroupId: "missing" },
  {}
];

describe("paginateObservationGroups", () => {
  it("uses date fallbacks, counts measurements, and sorts dated groups newest-first", () => {
    const result = paginateObservationGroups(groups, observations);

    expect(result.items).toEqual([
      expect.objectContaining({ id: "fallback-end", date: "2026-08-21T07:00:00.000Z", measurementCount: 1 }),
      expect.objectContaining({ id: "same-a", measurementCount: 2 }),
      expect.objectContaining({ id: "same-b", measurementCount: 0 }),
      expect.objectContaining({ id: "undated", date: undefined, measurementCount: 0 })
    ]);
    expect(result).toMatchObject({ total: 4, offset: 0, limit: 50, hasMore: false });
  });

  it("applies inclusive type and date filters and excludes undated groups", () => {
    const result = paginateObservationGroups(groups, observations, {
      kinds: ["lab_panel"],
      dateFrom: "2026-08-20",
      dateTo: "2026-08-20"
    });

    expect(result.items.map((item) => item.id)).toEqual(["same-a", "same-b"]);
  });

  it("returns deterministic pages with bounded limits", () => {
    expect(paginateObservationGroups(groups, observations, { limit: 1, offset: 1 })).toMatchObject({
      items: [expect.objectContaining({ id: "same-a" })],
      total: 4,
      offset: 1,
      limit: 1,
      hasMore: true
    });
    expect(paginateObservationGroups(groups, observations, { limit: 500 }).limit).toBe(100);
  });
});
