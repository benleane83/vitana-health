import { describe, expect, it } from "vitest";
import type { HealthDataSummary } from "@vitana/shared";
import {
  dashboardCategoryCounts,
  dashboardMetrics,
  formatDashboardMetricValue,
  formatLabReference,
  formatLabValue,
  formatTrendSummary,
  sparklineGeometry
} from "./dashboardMetrics";

describe("dashboardMetrics", () => {
  it("shows all pinned metrics followed by four unpinned metrics", () => {
    const metrics = [
      { code: "p1", isPinned: true },
      { code: "p2", isPinned: true },
      { code: "p3", isPinned: true },
      { code: "u1", isPinned: false },
      { code: "u2", isPinned: false },
      { code: "u3", isPinned: false },
      { code: "u4", isPinned: false },
      { code: "u5", isPinned: false }
    ];

    expect(dashboardMetrics(metrics).map((metric) => metric.code)).toEqual([
      "p1", "p2", "p3", "u1", "u2", "u3", "u4"
    ]);
  });

  it("formats dashboard metric values to at most one decimal place", () => {
    expect(formatDashboardMetricValue(72)).toBe("72");
    expect(formatDashboardMetricValue(72.56)).toBe("72.6");
    expect(formatDashboardMetricValue(72.5)).toBe("72.5");
    expect(formatDashboardMetricValue(72.04)).toBe("72");
    expect(formatDashboardMetricValue(Number.NaN)).toBe("—");
  });

  it("maps profile summaries to the shared dashboard categories", () => {
    const summary: HealthDataSummary = {
      generatedAt: "2026-08-29T00:00:00.000Z",
      totals: { observations: 7, samples: 0, activities: 2, total: 9, types: 3 },
      categories: [
        {
          key: "activity",
          label: "Activity",
          counts: { observations: 0, samples: 0, activities: 2, total: 2, types: 1 },
          rows: []
        },
        {
          key: "lab",
          label: "Lab",
          counts: { observations: 7, samples: 0, activities: 0, total: 7, types: 2 },
          rows: []
        }
      ]
    };

    expect(dashboardCategoryCounts(summary).map(({ key, label, count }) => ({ key, label, count }))).toEqual([
      { key: "activity", label: "Activities", count: 2 },
      { key: "body", label: "Body", count: 0 },
      { key: "lab", label: "Lab Results", count: 7 },
      { key: "sleep", label: "Sleep", count: 0 }
    ]);
  });

  it("formats trend and lab review copy consistently with desktop", () => {
    expect(formatTrendSummary("Weight", "Weight is down over the latest 2 reading(s)."))
      .toBe("is down over the latest 2 reading(s).");
    expect(formatTrendSummary("Weight", "A custom summary.")).toBe("A custom summary.");
    expect(formatLabValue(12.345)).toBe("12.35");
    expect(formatLabValue(12.3)).toBe("12.3");
    expect(formatLabValue(Number.NaN)).toBe("—");
    expect(formatLabReference("-4.5-10.0")).toBe("4.5-10.0");
  });

  it("builds sparkline geometry for changing, flat, and sparse data", () => {
    expect(sparklineGeometry([{ value: 10 }, { value: 20 }], 100, 40)).toEqual({
      path: "M 4.00 36.00 L 96.00 4.00",
      count: 2,
      min: 10,
      max: 20,
      lastPoint: { x: 96, y: 4 }
    });
    expect(sparklineGeometry([{ value: 5 }, { value: 5 }], 100, 40)?.path)
      .toBe("M 4.00 20.00 L 96.00 20.00");
    expect(sparklineGeometry([{ value: Number.NaN }, { value: 7 }], 100, 40)).toEqual({
      path: "M 4.00 20.00",
      count: 1,
      min: 7,
      max: 7,
      lastPoint: { x: 4, y: 20 }
    });
    expect(sparklineGeometry([], 100, 40)).toBeUndefined();
  });
});