// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { heatBuckets, buildMonthCells } from "../pages/CalendarPage.js";
import { localDayRange } from "../features/track/CalendarRoute.js";

describe("calendar page helpers", () => {
  it("builds stable five and six week month grids", () => {
    const fiveWeek = buildMonthCells("2026-02", 0);
    const sixWeek = buildMonthCells("2026-08", 1);

    expect(fiveWeek).toHaveLength(35);
    expect(fiveWeek.filter((cell) => cell.inMonth)).toHaveLength(28);
    expect(sixWeek).toHaveLength(42);
    expect(sixWeek.filter((cell) => cell.inMonth)).toHaveLength(31);
  });

  it("assigns adaptive monthly buckets without inventing missing values", () => {
    const point = (date: string, value: number) => ({
      date,
      value,
      measurementCode: "steps",
      unit: "count",
      count: 1,
      min: value,
      max: value,
      aggregation: "sum" as const,
      sources: ["Health Connect"]
    });
    const buckets = heatBuckets([
      point("2026-08-01", 10),
      point("2026-08-02", 10),
      point("2026-08-03", 30)
    ]);

    expect(buckets.get("2026-08-01")).toBe(1);
    expect(buckets.get("2026-08-02")).toBe(1);
    expect(buckets.get("2026-08-03")).toBe(5);
    expect(buckets.has("2026-08-04")).toBe(false);
  });

  it("creates DST-safe inclusive local day ranges", () => {
    expect(localDayRange("2026-03-08", "America/New_York")).toEqual({
      start: "2026-03-08T05:00:00.000Z",
      end: "2026-03-09T03:59:59.999Z"
    });
    expect(localDayRange("2026-11-01", "America/New_York")).toEqual({
      start: "2026-11-01T04:00:00.000Z",
      end: "2026-11-02T04:59:59.999Z"
    });
  });
});
