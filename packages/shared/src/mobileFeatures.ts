import type {
  HealthDataDetail,
  HealthDataDetailChartPoint,
  HealthDataSummary,
  HealthDataSummaryTypeRow,
  ManualObservationGroupTemplate,
  MeasurementType
} from "./types.js";
import type { ProfileDataCategory } from "./profileDataCategories.js";

export type SummarySort = "name" | "count" | "recency";

export const manualGroupDefaults = [
  { label: "Activity", category: "activity", measurementCode: "steps" },
  { label: "Body", category: "body", measurementCode: "weight" },
  { label: "Lab", category: "lab", measurementCode: "glucose" }
] as const;

export function normalizeGroupLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function filterManualGroupTemplates(
  templates: readonly ManualObservationGroupTemplate[]
): ManualObservationGroupTemplate[] {
  const defaultLabels = new Set(manualGroupDefaults.map((group) => normalizeGroupLabel(group.label)));
  return templates
    .filter((group) => !defaultLabels.has(group.normalizedLabel))
    .map((group) => ({
      ...group,
      measurements: [...group.measurements].sort((left, right) => left.marker.localeCompare(right.marker))
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function findKnownMeasurement(
  input: string,
  knownMeasurements: readonly MeasurementType[]
): MeasurementType | undefined {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return undefined;
  return knownMeasurements.find((measurement) =>
    measurement.code.toLowerCase() === normalized ||
    measurement.display.toLowerCase() === normalized ||
    measurement.aliases.some((alias) => alias.trim().toLowerCase() === normalized));
}

export function compareSummaryRows(
  left: HealthDataSummaryTypeRow,
  right: HealthDataSummaryTypeRow,
  sort: SummarySort
): number {
  if (sort === "name") return left.displayName.localeCompare(right.displayName);
  if (sort === "count") {
    return right.counts.total - left.counts.total || left.displayName.localeCompare(right.displayName);
  }
  return (right.lastMeasuredAt ?? "").localeCompare(left.lastMeasuredAt ?? "") ||
    left.displayName.localeCompare(right.displayName);
}

export function filterAndSortSummary(
  summary: HealthDataSummary,
  search: string,
  sort: SummarySort,
  categoryFilter?: ProfileDataCategory
): HealthDataSummary {
  const query = search.trim().toLocaleLowerCase();
  return {
    ...summary,
    categories: summary.categories
      .filter((category) => !categoryFilter || category.key === categoryFilter)
      .map((category) => ({
        ...category,
        rows: category.rows
          .filter((row) => !query ||
            row.displayName.toLocaleLowerCase().includes(query) ||
            row.code.toLocaleLowerCase().includes(query))
          .sort((left, right) => compareSummaryRows(left, right, sort))
      }))
      .filter((category) => category.rows.length > 0)
  };
}

export function mergeHealthDataDetail(
  current: HealthDataDetail,
  nextPage: HealthDataDetail
): HealthDataDetail {
  // A Map keyed by the point identity, rather than `findIndex` inside `filter`. The old form was
  // O(n^2) over the *accumulated* array and allocated a fresh key string per comparison, so every
  // "load more" press made the next one quadratically slower.
  const byKey = new Map<string, HealthDataDetailChartPoint>();
  for (const point of current.chartPoints) byKey.set(chartPointKey(point), point);
  for (const point of nextPage.chartPoints) {
    const key = chartPointKey(point);
    if (!byKey.has(key)) byKey.set(key, point);
  }
  const chartPoints = [...byKey.values()]
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.kind.localeCompare(right.kind));
  return {
    ...nextPage,
    entries: [...current.entries, ...nextPage.entries],
    chartPoints
  };
}

/**
 * Minimum and maximum of a finite-number sequence.
 *
 * `Math.min(...values)` pushes every element onto the call stack and throws `RangeError` somewhere
 * around 100k arguments, which is reachable once a user has years of accumulated history. This
 * walks the sequence instead, and skips non-finite entries so a bad row cannot poison the extent.
 */
export function finiteExtent(values: Iterable<number | undefined>): { min: number; max: number } | undefined {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let seen = false;
  for (const value of values) {
    if (value === undefined || !Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
    seen = true;
  }
  return seen ? { min, max } : undefined;
}

export function calculateChartDomain(points: readonly HealthDataDetailChartPoint[]): {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
} | undefined {
  if (points.length === 0) return undefined;
  const time = finiteExtent(points.map((point) => new Date(point.timestamp).getTime()));
  const value = finiteExtent(points.flatMap((point) => [
    point.value,
    point.referenceRange?.low,
    point.referenceRange?.high
  ]));
  if (!time || !value) return undefined;
  const padding = value.min === value.max
    ? Math.max(Math.abs(value.min) * 0.05, 1)
    : (value.max - value.min) * 0.05;
  return { xMin: time.min, xMax: time.max, yMin: value.min - padding, yMax: value.max + padding };
}

function chartPointKey(point: HealthDataDetailChartPoint): string {
  return `${point.kind}\u0000${point.timestamp}\u0000${point.value}\u0000${point.unit}`;
}
