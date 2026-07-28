import { describe, expect, it } from "vitest";
import { dashboardMetrics } from "./dashboardMetrics";

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
});