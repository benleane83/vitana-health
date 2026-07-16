import type {
  HealthDataDetail,
  HealthDataDetailChartPoint,
  HealthDataSummary,
  HealthDataSummaryTypeRow,
  ManualObservationGroupTemplate,
  MeasurementType
} from "./types.js";

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
  sort: SummarySort
): HealthDataSummary {
  const query = search.trim().toLocaleLowerCase();
  return {
    ...summary,
    categories: summary.categories
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
  const chartPoints = [...current.chartPoints, ...nextPage.chartPoints]
    .filter((point, index, points) =>
      points.findIndex((candidate) => chartPointKey(candidate) === chartPointKey(point)) === index)
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.kind.localeCompare(right.kind));
  return {
    ...nextPage,
    entries: [...current.entries, ...nextPage.entries],
    chartPoints
  };
}

export function calculateChartDomain(points: readonly HealthDataDetailChartPoint[]): {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
} | undefined {
  if (points.length === 0) return undefined;
  const timestamps = points.map((point) => new Date(point.timestamp).getTime()).filter(Number.isFinite);
  const values = points.flatMap((point) => [
    point.value,
    point.referenceRange?.low,
    point.referenceRange?.high
  ]).filter((value): value is number => Number.isFinite(value));
  if (timestamps.length === 0 || values.length === 0) return undefined;
  const xMin = Math.min(...timestamps);
  const xMax = Math.max(...timestamps);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = rawMin === rawMax
    ? Math.max(Math.abs(rawMin) * 0.05, 1)
    : (rawMax - rawMin) * 0.05;
  return { xMin, xMax, yMin: rawMin - padding, yMax: rawMax + padding };
}

function chartPointKey(point: HealthDataDetailChartPoint): string {
  return `${point.kind}\u0000${point.timestamp}\u0000${point.value}\u0000${point.unit}`;
}
