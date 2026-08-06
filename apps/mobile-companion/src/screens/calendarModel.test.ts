import { describe, expect, it } from "vitest";
import { buildMonthCells, heatBuckets } from "./calendarModel";

describe("mobile calendar model", () => {
  it("builds complete Sunday-first weeks without shrinking the grid", () => {
    const cells = buildMonthCells("2026-08", 0);

    expect(cells).toHaveLength(42);
    expect(cells[0]).toMatchObject({ date: "2026-07-26", inMonth: false });
    expect(cells[6]).toMatchObject({ date: "2026-08-01", day: 1, inMonth: true });
  });

  it("assigns stable relative heat levels", () => {
    const buckets = heatBuckets([
      { date: "2026-08-01", measurementCode: "steps", value: 100, unit: "count", count: 1, min: 100, max: 100, aggregation: "sum", sources: [] },
      { date: "2026-08-02", measurementCode: "steps", value: 300, unit: "count", count: 1, min: 300, max: 300, aggregation: "sum", sources: [] },
      { date: "2026-08-03", measurementCode: "steps", value: 500, unit: "count", count: 1, min: 500, max: 500, aggregation: "sum", sources: [] }
    ]);

    expect([...buckets.values()]).toEqual([1, 3, 5]);
  });
});