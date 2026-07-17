import { describe, expect, it } from "vitest";
import { createDemoDataSource } from "./demoDataSource";

describe("demo data source", () => {
  it("returns coherent dashboard, summary, and detail data", async () => {
    const source = createDemoDataSource(new Date("2026-07-17T12:00:00.000Z"));
    const [bootstrap, analytics, summary] = await Promise.all([
      source.bootstrap(),
      source.analytics(),
      source.summary()
    ]);

    expect(bootstrap.profile.displayName).toBe("Demo Profile");
    expect(analytics.latestMetrics.length).toBeGreaterThan(3);
    expect(summary.totals.types).toBe(analytics.latestMetrics.length);
    expect(summary.totals.samples).toBe(analytics.counts.samples);
    expect(summary.totals.observations).toBe(analytics.counts.observations);
    for (const metric of analytics.latestMetrics) {
      const detail = await source.healthDataDetail(metric.code);
      expect(detail.measurement.displayName).toBe(metric.label);
      expect(detail.entries[0].value).toBe(metric.value);
      expect(detail.chartPoints.length).toBe(detail.entries.length);
    }
  });

  it("paginates deterministically and rejects unknown metrics", async () => {
    const source = createDemoDataSource(new Date("2026-07-17T12:00:00.000Z"));
    const first = await source.healthDataDetail("steps", { limit: 2, offset: 0 });
    const second = await source.healthDataDetail("steps", { limit: 2, offset: 2 });

    expect(first.entries).toHaveLength(2);
    expect(first.pagination.hasMore).toBe(true);
    expect(second.entries).toHaveLength(2);
    expect(second.entries[0].id).not.toBe(first.entries[0].id);
    await expect(source.healthDataDetail("unknown")).rejects.toThrow("not available in demo mode");
  });
});