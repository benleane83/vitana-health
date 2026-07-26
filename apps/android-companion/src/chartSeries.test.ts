import { describe, expect, it } from "vitest";
import type { HealthDataDetail } from "@vitana/shared";
import { chartSeriesFromDetail } from "./chartSeries";

function detail(aggregation: HealthDataDetail["measurement"]["aggregation"]): HealthDataDetail {
  return {
    generatedAt: "2026-07-26T00:00:00.000Z",
    measurement: {
      code: "steps",
      displayName: "Steps",
      category: "activity",
      aggregation,
      counts: { observations: 3, samples: 0, activities: 0, total: 3 },
      lastMeasuredAt: "2026-07-20T12:00:00.000Z"
    },
    referenceRange: { source: "none" },
    entries: [],
    chartPoints: [
      { kind: "observation", timestamp: "2025-01-01T12:00:00.000Z", value: 100, unit: "count" },
      { kind: "observation", timestamp: "2026-07-20T08:00:00.000Z", value: 200, unit: "count" },
      { kind: "observation", timestamp: "2026-07-20T12:00:00.000Z", value: 300, unit: "count" }
    ],
    counts: { observations: 3, samples: 0, activities: 0, total: 3 },
    deletion: { observationEntries: 3, deletableEntries: 3 },
    pagination: { limit: 50, loaded: 3, total: 3, hasMore: false }
  };
}

describe("chartSeriesFromDetail", () => {
  it("filters readings to the selected range", () => {
    const series = chartSeriesFromDetail(
      detail("latest"),
      { range: "1y", mode: "auto" },
      new Date("2026-07-26T00:00:00.000Z")
    );

    expect(series.points.map((point) => point.value)).toEqual([200, 300]);
    expect(series.granularity).toBe("raw");
  });

  it("switches between adaptive daily totals and individual readings", () => {
    const source = detail("sum");
    const adaptive = chartSeriesFromDetail(source, { range: "all", mode: "auto" });
    const readings = chartSeriesFromDetail(source, { range: "all", mode: "raw" });

    expect(adaptive.points).toHaveLength(2);
    expect(adaptive.points[1]).toMatchObject({
      timestamp: "2026-07-20T00:00:00.000Z",
      value: 500,
      count: 2,
      minValue: 200,
      maxValue: 300
    });
    expect(readings.points.map((point) => point.value)).toEqual([100, 200, 300]);
  });
});
