import { describe, expect, it } from "vitest";
import { dashboardMetrics, formatDashboardMetricValue } from "./dashboardMetrics";

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
});