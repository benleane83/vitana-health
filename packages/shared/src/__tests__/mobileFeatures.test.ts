import { describe, expect, it } from "vitest";
import {
  calculateChartDomain,
  compareSummaryRows,
  filterAndSortSummary,
  filterManualGroupTemplates,
  findKnownMeasurement,
  finiteExtent,
  mergeHealthDataDetail
} from "../mobileFeatures.js";
import { defaultMeasurementTypes } from "../registry.js";
import type { HealthDataDetail, HealthDataSummary, HealthDataSummaryTypeRow } from "../types.js";

const row = (code: string, displayName: string, total: number, lastMeasuredAt?: string): HealthDataSummaryTypeRow => ({
  code,
  displayName,
  category: "body",
  counts: { observations: total, samples: 0, activities: 0, total },
  lastMeasuredAt
});

describe("mobile feature models", () => {
  it("filters default templates and sorts saved templates and measurements", () => {
    const templates = filterManualGroupTemplates([
      { label: "Activity", normalizedLabel: "activity", measurements: [] },
      {
        label: "Vitals",
        normalizedLabel: "vitals",
        measurements: [
          { marker: "Weight", measurementCode: "weight", unit: "kg" },
          { marker: "Blood pressure", measurementCode: "blood_pressure", unit: "mmHg" }
        ]
      }
    ]);

    expect(templates.map((template) => template.label)).toEqual(["Vitals"]);
    expect(templates[0].measurements.map((measurement) => measurement.marker)).toEqual(["Blood pressure", "Weight"]);
  });

  it("matches measurements by code, display name, and alias", () => {
    expect(findKnownMeasurement("weight", defaultMeasurementTypes)?.code).toBe("weight");
    expect(findKnownMeasurement("Body Weight", defaultMeasurementTypes)?.code).toBe("weight");
    expect(findKnownMeasurement("body_weight", defaultMeasurementTypes)?.code).toBe("weight");
  });

  it("filters and sorts summary rows without mutating the source", () => {
    const weight = row("weight", "Weight", 2, "2026-01-01");
    const bodyFat = row("body_fat_percentage", "Body fat", 4, "2026-02-01");
    const summary: HealthDataSummary = {
      generatedAt: "2026-03-01",
      totals: { observations: 6, samples: 0, activities: 0, total: 6, types: 2 },
      categories: [{
        key: "body",
        label: "Body",
        counts: { observations: 6, samples: 0, activities: 0, total: 6, types: 2 },
        rows: [weight, bodyFat]
      }]
    };

    expect(filterAndSortSummary(summary, "fat", "name").categories[0].rows).toEqual([bodyFat]);
    expect([...summary.categories[0].rows].sort((a, b) => compareSummaryRows(a, b, "count"))).toEqual([bodyFat, weight]);
    expect(summary.categories[0].rows).toEqual([weight, bodyFat]);
  });

  it("pads flat chart domains and includes reference ranges", () => {
    expect(calculateChartDomain([{
      kind: "observation",
      timestamp: "2026-01-01T00:00:00.000Z",
      value: 5,
      unit: "mmol/L",
      referenceRange: { low: 4, high: 6, unit: "mmol/L" }
    }])).toEqual({
      xMin: Date.parse("2026-01-01T00:00:00.000Z"),
      xMax: Date.parse("2026-01-01T00:00:00.000Z"),
      yMin: 3.9,
      yMax: 6.1
    });
    expect(calculateChartDomain([])).toBeUndefined();
  });

  it("merges pagination while de-duplicating and ordering chart points", () => {
    const detail = {
      measurement: { code: "weight", displayName: "Weight", category: "body", canonicalUnit: "kg" },
      latest: undefined,
      entries: [],
      chartPoints: [],
      sourceCounts: { observations: 0, samples: 0, activities: 0 },
      pagination: { limit: 1, offset: 0, loaded: 0, total: 0, hasMore: false },
      deletion: { observationEntries: 0, canDeleteAll: false }
    } as HealthDataDetail;
    const point = { kind: "observation", timestamp: "2026-01-01", value: 70, unit: "kg" } as const;
    const merged = mergeHealthDataDetail(
      { ...detail, chartPoints: [point] },
      { ...detail, chartPoints: [point], pagination: { ...detail.pagination, loaded: 1 } }
    );
    expect(merged.chartPoints).toEqual([point]);
    expect(merged.pagination.loaded).toBe(1);
  });

  it("merges large pages in linear time rather than quadratic", () => {
    const detail = {
      measurement: { code: "weight", displayName: "Weight", category: "body", canonicalUnit: "kg" },
      latest: undefined,
      entries: [],
      chartPoints: [],
      sourceCounts: { observations: 0, samples: 0, activities: 0 },
      pagination: { limit: 1, offset: 0, loaded: 0, total: 0, hasMore: false },
      deletion: { observationEntries: 0, canDeleteAll: false }
    } as HealthDataDetail;

    // Only the identity-key builder reads `value`; the sort comparator reads timestamp and kind.
    // Counting reads therefore counts key builds exactly, with no wall-clock flakiness.
    let valueReads = 0;
    const page = (start: number, count: number) => Array.from({ length: count }, (_, index) => ({
      kind: "observation" as const,
      timestamp: new Date(Date.UTC(2020, 0, 1) + (start + index) * 86_400_000).toISOString(),
      get value() { valueReads += 1; return 70 + index; },
      unit: "kg"
    }));

    const size = 2_000;
    const merged = mergeHealthDataDetail(
      { ...detail, chartPoints: page(0, size) },
      { ...detail, chartPoints: page(size, size) }
    );

    expect(merged.chartPoints).toHaveLength(size * 2);
    // The old filter/findIndex form built a key per comparison: ~(2n)^2 reads. One per point now.
    expect(valueReads).toBe(size * 2);
  });

  it("computes extents without spreading every value onto the call stack", () => {
    const values = Array.from({ length: 200_000 }, (_, index) => index);
    expect(finiteExtent(values)).toEqual({ min: 0, max: 199_999 });
    expect(finiteExtent([1, Number.NaN, undefined, -3])).toEqual({ min: -3, max: 1 });
    expect(finiteExtent([])).toBeUndefined();
    expect(finiteExtent([Number.NaN])).toBeUndefined();
  });
});
